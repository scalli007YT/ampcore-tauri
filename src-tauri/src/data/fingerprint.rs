//! Deterministic amp/channel fingerprints — the groundwork for matching a live
//! amp to a Project `AmpAssignment` (offline↔online) and for verifying that a
//! channel's speaker processing is what it is supposed to be.
//!
//! One canonical path serves both sides: a project `AmpChannel` and a live
//! FC=27 `ChannelConfig` are each reduced to the same borrowed `ChannelInput`,
//! canonicalized, and hashed from a hand-written byte encoding. Nothing is
//! persisted; fingerprints are recomputed on demand.
//!
//! Two hashes:
//! - **`speakerHash`** (per output channel): CRC-16/XModem, 4 hex chars, over
//!   output-side speaker processing only — output EQ (HP, parametric bands,
//!   LP), RMS + peak limiter, output delay, polarity, power mode. Short enough
//!   to embed in the 16-byte output name as `Name_XXXX`, the same convention
//!   (and CRC variant, not byte layout) as the prior web app's
//!   `speaker-sync-hash.ts`.
//! - **`ampHash`**: FNV-1a 64, 16 hex chars, over the amp's identity (model,
//!   channel count, firmware family) plus every live-readable channel field:
//!   the speaker hashes, input EQ, source, matrix, input delay, trim, volume,
//!   noise-gate on/off, input names — and the amp's bridge pairs.
//!
//! Deliberately excluded from both: mutes (operational), output names (they
//! will carry the speaker hash themselves), `ohms` and noise-gate threshold
//! (no live readback), `gain_in`, FIR bypass and per-source trims/delays (no
//! project field), MAC/IP (identity for a later matching step, not config).
//!
//! **What the JSON shows vs. what is hashed.** The JSON shows what the amp
//! actually stores, in natural units, including a bypassed band's or a
//! disabled limiter's values. Every number is already rounded to its fixed
//! step (0.1 Hz, 0.01 dB, 0.001 Q, 0.01 ms, 0.01 V, 1 ms) after a cast through
//! `f32` — the precision the wire stores (see `write_v118.rs`) — so an offline
//! `f64` and its online `f32` readback display, and hash, identically. The
//! hash then ignores what doesn't affect the sound: a bypassed band/slot's
//! settings, a disabled limiter stage's settings, an inactive crosspoint's
//! gain, and a gain/Q the filter type doesn't use (shown as `null`).
//!
//! **Not tied to one model.** Nothing assumes a channel count, band count or
//! matrix size: those come from the data or the catalog topology (crosspoints
//! beyond `matrix_input_count` are ignored — the CVR parser always reads 4,
//! even on 2-channel amps). Enums hash by fingerprint-owned tags, not by any
//! protocol's wire codes. The firmware family is the live driver's own
//! `DiscoveredDevice.firmware_family` label online, and the same protocol's
//! bucketing of the planned version offline.
//!
//! Nothing is guessed: an input that can't be read (live power mode, source,
//! unreported bridge pair, unresolved model) makes the affected hash `None`
//! and adds a reason to `missing`.

use serde::Serialize;
use specta::Type;

use super::amp_model::{AmpModelCatalogEntry, AmpProtocol};
use super::capability::{CrossoverFilterType, EqFilterType, PowerMode, SourceKind};
use super::device_link::{match_catalog_model, DeviceModelLink};
use super::project::{
    AmpAssignment, AmpChannel, ChannelEq, ChannelSource, CrossoverSlot, EqBand, Limiter, MatrixCrosspoint, Project,
};
use crate::live::cvr::bridge::DeviceBridgeSnapshot;
use crate::live::cvr::channel_config::{ChannelConfig, ChannelConfigSnapshot};
use crate::live::cvr::protocol::detect_firmware_family;
use crate::live::state::DiscoveredDevice;

/// First byte of every hash input. Bump whenever the canonicalization rules,
/// field set or byte encoding change, so fingerprints from different rule
/// sets can never falsely match.
///
/// 2: natural-unit JSON, bypassed values skipped in the hash instead of
/// zeroed, fingerprint-owned filter tags, matrix clipped to topology, bridge
/// state per pair at amp level.
pub const FINGERPRINT_VERSION: u8 = 2;

/// `_XXXX` — separator plus 4 hex chars appended to an output name.
pub const HASH_SUFFIX_LEN: usize = 5;

/// Rounding steps, as steps per unit.
const FREQ_STEPS: f64 = 10.0; // 0.1 Hz
const GAIN_STEPS: f64 = 100.0; // 0.01 dB
const Q_STEPS: f64 = 1000.0; // 0.001
const DELAY_STEPS: f64 = 100.0; // 0.01 ms
const VOLT_STEPS: f64 = 100.0; // 0.01 V
const WHOLE_STEPS: f64 = 1.0; // limiter ms / release multiplier (u16/u8 on the wire)

/// Byte written for an absent optional value.
const NONE_TAG: u8 = 0xFF;

const SECTION_IDENTITY: u8 = b'I';
const SECTION_SPEAKER: u8 = b'S';
const SECTION_CHANNEL: u8 = b'C';
const SECTION_EQ: u8 = b'E';
const SECTION_LIMITER: u8 = b'L';
const SECTION_BRIDGE: u8 = b'B';

// ---------------------------------------------------------------------------
// Output types
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum FingerprintSource {
    Offline,
    Online,
}

/// Where a fingerprint came from. Flat rather than an internally tagged enum:
/// `kind` says which of the optional ids are set.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct FingerprintOrigin {
    pub kind: FingerprintSource,
    pub project_id: Option<String>,
    pub assignment_id: Option<String>,
    pub device_id: Option<String>,
    pub mac: Option<String>,
    pub label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AmpIdentity {
    /// Catalog model name, e.g. "DSP-2004" — the hashed identity.
    pub model: Option<String>,
    /// Informational only; not hashed.
    pub amp_model_id: Option<String>,
    pub channel_count: u32,
    /// Protocol firmware bucket, e.g. "1.1.8"/"1.1.9" for CVR.
    pub firmware_family: Option<String>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CrossoverCanonical {
    pub filter_type: CrossoverFilterType,
    pub freq_hz: f64,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EqBandCanonical {
    pub filter_type: EqFilterType,
    pub freq_hz: f64,
    /// `None` when the filter type has no gain.
    pub gain_db: Option<f64>,
    /// `None` when the filter type has no Q.
    pub q: Option<f64>,
    pub active: bool,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct EqCanonical {
    pub hp: CrossoverCanonical,
    pub bands: Vec<EqBandCanonical>,
    pub lp: CrossoverCanonical,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct RmsLimiterCanonical {
    pub enabled: bool,
    pub threshold_vrms: f64,
    pub attack_ms: f64,
    pub release_multiplier: f64,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct PeakLimiterCanonical {
    pub enabled: bool,
    pub threshold_vp: f64,
    pub hold_ms: f64,
    pub release_ms: f64,
}

/// The values `speakerHash` is computed from.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerCanonical {
    pub output_eq: EqCanonical,
    pub rms_limiter: RmsLimiterCanonical,
    pub peak_limiter: PeakLimiterCanonical,
    pub delay_out_ms: f64,
    pub phase_inverted: bool,
    /// `None` only for a live channel whose power-mode byte is unmapped.
    pub power_mode: Option<PowerMode>,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CrosspointCanonical {
    pub source_index: u32,
    pub gain_db: f64,
    pub active: bool,
}

/// The per-channel fields `ampHash` covers beyond the speaker hash.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChannelAmpCanonical {
    pub input_eq: EqCanonical,
    /// `None` = no source picked (a project channel). An unreadable live
    /// source is reported in `missing` instead.
    pub source: Option<ChannelSource>,
    /// Only the model's matrix inputs (`0..matrix_input_count`).
    pub matrix_crosspoints: Vec<CrosspointCanonical>,
    pub delay_in_ms: f64,
    pub output_trim_db: f64,
    pub output_volume_db: f64,
    pub noise_gate_enabled: bool,
    /// Trimmed; empty when unnamed or still the default "In{n}" label.
    pub input_name: String,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChannelFingerprint {
    pub channel_index: u32,
    /// Output letter, "A", "B", …
    pub label: String,
    pub speaker_hash: Option<String>,
    pub output_name: Option<String>,
    /// `XXXX` from an output name ending in `_XXXX`, if present.
    pub embedded_hash: Option<String>,
    /// Set only when both `embedded_hash` and `speaker_hash` exist.
    pub embedded_hash_matches: Option<bool>,
    pub speaker: SpeakerCanonical,
    pub amp_fields: ChannelAmpCanonical,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AmpFingerprint {
    pub fingerprint_version: u32,
    pub origin: FingerprintOrigin,
    pub identity: AmpIdentity,
    /// `None` whenever `missing` is non-empty.
    pub amp_hash: Option<String>,
    pub channels: Vec<ChannelFingerprint>,
    /// One entry per bridgeable pair (A/B, C/D, …); a trailing unpaired
    /// channel has none. `None` = not reported yet (also listed in `missing`).
    pub bridged_pairs: Vec<Option<bool>>,
    /// Human-readable reasons a hash could not be computed.
    pub missing: Vec<String>,
}

// ---------------------------------------------------------------------------
// Shared input — both sources reduce to this
// ---------------------------------------------------------------------------

struct ChannelInput<'a> {
    channel_index: u32,
    source: Option<ChannelSource>,
    /// `false` when a live source byte didn't map — distinct from a project
    /// channel that simply has no source picked.
    source_readable: bool,
    matrix_crosspoints: &'a [MatrixCrosspoint],
    delay_in_ms: f64,
    output_trim_db: f64,
    output_volume_db: f64,
    delay_out_ms: f64,
    input_eq: &'a ChannelEq,
    output_eq: &'a ChannelEq,
    limiter: &'a Limiter,
    noise_gate_enabled: bool,
    output_phase_inverted: bool,
    input_name: Option<&'a str>,
    output_name: Option<&'a str>,
    power_mode: Option<PowerMode>,
    /// Bridge reading for this channel's pair; `None` = not reported. Only
    /// read from pair leaders, in `build`.
    bridged: Option<bool>,
}

impl<'a> ChannelInput<'a> {
    fn from_project(channel: &'a AmpChannel) -> Self {
        Self {
            channel_index: channel.channel_index,
            source: channel.source,
            source_readable: true,
            matrix_crosspoints: &channel.matrix_crosspoints,
            delay_in_ms: channel.delay_in_ms,
            output_trim_db: channel.output_trim_db,
            output_volume_db: channel.output_volume_db,
            delay_out_ms: channel.delay_out_ms,
            input_eq: &channel.input_eq,
            output_eq: &channel.output_eq,
            limiter: &channel.limiter,
            noise_gate_enabled: channel.noise_gate_enabled,
            output_phase_inverted: channel.output_phase_inverted,
            input_name: channel.input_name.as_deref(),
            output_name: channel.output_name.as_deref(),
            power_mode: Some(channel.power_mode),
            bridged: Some(channel.output_bridged),
        }
    }

    fn from_live(config: &'a ChannelConfig, bridged: Option<bool>) -> Self {
        Self {
            channel_index: config.channel_index,
            source: config.source,
            source_readable: config.source.is_some(),
            matrix_crosspoints: &config.matrix_crosspoints,
            delay_in_ms: config.delay_in_ms as f64,
            output_trim_db: config.output_trim_db as f64,
            output_volume_db: config.output_volume_db as f64,
            delay_out_ms: config.delay_out_ms as f64,
            input_eq: &config.input_eq,
            output_eq: &config.output_eq,
            limiter: &config.limiter,
            noise_gate_enabled: config.noise_gate_enabled,
            output_phase_inverted: config.output_phase_inverted,
            input_name: config.input_name.as_deref(),
            output_name: config.output_name.as_deref(),
            power_mode: config.power_mode,
            bridged,
        }
    }
}

// ---------------------------------------------------------------------------
// Entry points
// ---------------------------------------------------------------------------

pub fn fingerprint_project_amp(
    project: &Project,
    assignment: &AmpAssignment,
    models: &[AmpModelCatalogEntry],
) -> AmpFingerprint {
    let mut missing = Vec::new();

    let model = assignment.amp_model_id.as_deref().and_then(|id| models.iter().find(|m| m.id == id));
    let firmware_family = model.and_then(|m| planned_firmware_family(m, assignment.firmware_version.as_deref()));
    match model {
        None => missing.push("No amp model assigned".to_string()),
        Some(_) if firmware_family.is_none() => {
            missing.push("Firmware version not set or not recognized".to_string())
        }
        Some(_) => {}
    }

    let mut channels: Vec<&AmpChannel> = assignment.channels.iter().collect();
    channels.sort_by_key(|c| c.channel_index);

    let channel_count = model.map(|m| m.channel_count).unwrap_or(channels.len() as u32);
    let matrix_input_count = model.map(|m| m.topology.matrix_input_count).unwrap_or(channel_count);
    let identity = AmpIdentity {
        model: model.map(|m| m.model.clone()),
        amp_model_id: model.map(|m| m.id.clone()),
        channel_count,
        firmware_family,
    };
    let origin = FingerprintOrigin {
        kind: FingerprintSource::Offline,
        project_id: Some(project.id.clone()),
        assignment_id: Some(assignment.id.clone()),
        device_id: None,
        mac: assignment.mac.clone(),
        label: assignment.label.clone(),
    };
    let inputs = channels.into_iter().map(ChannelInput::from_project).collect();
    build(origin, identity, matrix_input_count, inputs, missing)
}

pub fn fingerprint_live_device(
    device: &DiscoveredDevice,
    snapshot: &ChannelConfigSnapshot,
    bridge: Option<&DeviceBridgeSnapshot>,
    models: &[AmpModelCatalogEntry],
    links: &[DeviceModelLink],
) -> AmpFingerprint {
    let mut missing = Vec::new();

    // A saved link (manual pick or earlier auto-match) wins over re-matching.
    let model = links
        .iter()
        .find(|l| l.mac == device.mac)
        .and_then(|l| models.iter().find(|m| m.id == l.amp_model_id))
        .or_else(|| {
            match_catalog_model(
                models,
                &device.firmware_version,
                device.digital_input_channels,
                device.output_channels,
            )
        });
    if model.is_none() {
        missing.push("Amp model not resolved for this device".to_string());
    }
    // The driver's own bucket — the exact label the rest of the live side uses.
    let firmware_family = device.firmware_family.clone();
    if firmware_family.is_none() {
        missing.push(format!("Firmware version \"{}\" not recognized", device.firmware_version));
    }

    let channel_count = device.output_channels;
    let matrix_input_count = model.map(|m| m.topology.matrix_input_count).unwrap_or(channel_count);
    let mut configs: Vec<&ChannelConfig> =
        snapshot.channels.iter().filter(|c| c.channel_index < channel_count).collect();
    configs.sort_by_key(|c| c.channel_index);

    let identity = AmpIdentity {
        model: model.map(|m| m.model.clone()),
        amp_model_id: model.map(|m| m.id.clone()),
        channel_count,
        firmware_family,
    };
    let origin = FingerprintOrigin {
        kind: FingerprintSource::Online,
        project_id: None,
        assignment_id: None,
        device_id: Some(device.id.clone()),
        mac: Some(device.mac.clone()),
        label: Some(device.name.clone()).filter(|n| !n.trim().is_empty()),
    };
    let inputs = configs
        .into_iter()
        .map(|c| {
            let pair = (c.channel_index / 2) as usize;
            let bridged = bridge.and_then(|b| b.bridged.get(pair).copied().flatten());
            ChannelInput::from_live(c, bridged)
        })
        .collect();
    build(origin, identity, matrix_input_count, inputs, missing)
}

fn build(
    origin: FingerprintOrigin,
    identity: AmpIdentity,
    matrix_input_count: u32,
    inputs: Vec<ChannelInput>,
    mut missing: Vec<String>,
) -> AmpFingerprint {
    let count = identity.channel_count;
    for index in 0..count {
        if !inputs.iter().any(|i| i.channel_index == index) {
            missing.push(format!("Out{}: channel data not available", output_letter(index)));
        }
    }

    let mut amp = HashInput::new();
    encode_identity(&mut amp, &identity);

    let mut channels = Vec::with_capacity(inputs.len());
    for input in &inputs {
        let label = output_letter(input.channel_index);

        let speaker = canonical_speaker(input);
        let speaker_hash = if speaker.power_mode.is_some() {
            let mut h = HashInput::new();
            encode_speaker(&mut h, &speaker);
            Some(crc16_xmodem(&h.0))
        } else {
            missing.push(format!("Out{label}: power mode not readable"));
            None
        };

        if !input.source_readable {
            missing.push(format!("In{}: source selection not readable", input.channel_index + 1));
        }

        let amp_fields = canonical_amp_fields(input, matrix_input_count);
        if let Some(hash) = speaker_hash {
            encode_channel_amp(&mut amp, input.channel_index, hash, &amp_fields);
        }

        let output_name = input.output_name.map(str::trim).filter(|n| !n.is_empty()).map(String::from);
        let embedded_hash = output_name.as_deref().and_then(|n| split_hash_suffix(n).1);
        let speaker_hash = speaker_hash.map(|h| format!("{h:04X}"));
        let embedded_hash_matches = match (&embedded_hash, &speaker_hash) {
            (Some(embedded), Some(current)) => Some(embedded == current),
            _ => None,
        };

        channels.push(ChannelFingerprint {
            channel_index: input.channel_index,
            label: label.to_string(),
            speaker_hash,
            output_name,
            embedded_hash,
            embedded_hash_matches,
            speaker,
            amp_fields,
        });
    }

    // Bridging joins a channel with the next one (A/B, C/D, …); only the
    // pair leader carries the flag.
    let mut bridged_pairs = Vec::new();
    for leader in (0..count).step_by(2).filter(|leader| leader + 1 < count) {
        let leader_input = inputs.iter().find(|i| i.channel_index == leader);
        let reading = leader_input.and_then(|i| i.bridged);
        if leader_input.is_some() && reading.is_none() {
            missing.push(format!(
                "Out{}/{}: bridge state not reported yet",
                output_letter(leader),
                output_letter(leader + 1)
            ));
        }
        bridged_pairs.push(reading);
    }
    encode_bridge_pairs(&mut amp, &bridged_pairs);

    let amp_hash = missing.is_empty().then(|| format!("{:016X}", fnv1a_64(&amp.0)));

    AmpFingerprint {
        fingerprint_version: FINGERPRINT_VERSION as u32,
        origin,
        identity,
        amp_hash,
        channels,
        bridged_pairs,
        missing,
    }
}

// ---------------------------------------------------------------------------
// Canonicalization
// ---------------------------------------------------------------------------

/// Casts through `f32` first — the precision the wire actually stores — then
/// rounds to the nearest step, so an offline `f64` and its live `f32` readback
/// land on the same value.
fn round_to_step(value: f64, steps_per_unit: f64) -> f64 {
    let wire = value as f32 as f64;
    if !wire.is_finite() {
        return 0.0;
    }
    (wire * steps_per_unit).round() / steps_per_unit
}

/// A value already produced by `round_to_step`, as its integer step count —
/// what the hash actually encodes, so it never depends on float formatting.
fn steps(value: f64, steps_per_unit: f64) -> i32 {
    (value * steps_per_unit).round() as i32
}

fn canonical_crossover(slot: &CrossoverSlot) -> CrossoverCanonical {
    CrossoverCanonical {
        filter_type: slot.filter_type,
        freq_hz: round_to_step(slot.freq_hz, FREQ_STEPS),
        active: slot.active,
    }
}

fn canonical_band(band: &EqBand) -> EqBandCanonical {
    let caps = band.filter_type.capabilities();
    EqBandCanonical {
        filter_type: band.filter_type,
        freq_hz: round_to_step(band.freq_hz, FREQ_STEPS),
        gain_db: caps.supports_gain.then(|| round_to_step(band.gain_db, GAIN_STEPS)),
        q: caps.supports_q.then(|| round_to_step(band.q, Q_STEPS)),
        active: band.active,
    }
}

fn canonical_eq(eq: &ChannelEq) -> EqCanonical {
    EqCanonical {
        hp: canonical_crossover(&eq.hp),
        bands: eq.bands.iter().map(canonical_band).collect(),
        lp: canonical_crossover(&eq.lp),
    }
}

fn canonical_speaker(input: &ChannelInput) -> SpeakerCanonical {
    let rms = &input.limiter.rms;
    let peak = &input.limiter.peak;
    SpeakerCanonical {
        output_eq: canonical_eq(input.output_eq),
        rms_limiter: RmsLimiterCanonical {
            enabled: rms.enabled,
            threshold_vrms: round_to_step(rms.threshold_vrms, VOLT_STEPS),
            attack_ms: round_to_step(rms.attack_ms, WHOLE_STEPS),
            release_multiplier: round_to_step(rms.release_multiplier, WHOLE_STEPS),
        },
        peak_limiter: PeakLimiterCanonical {
            enabled: peak.enabled,
            threshold_vp: round_to_step(peak.threshold_vp, VOLT_STEPS),
            hold_ms: round_to_step(peak.hold_ms, WHOLE_STEPS),
            release_ms: round_to_step(peak.release_ms, WHOLE_STEPS),
        },
        delay_out_ms: round_to_step(input.delay_out_ms, DELAY_STEPS),
        phase_inverted: input.output_phase_inverted,
        power_mode: input.power_mode,
    }
}

fn canonical_amp_fields(input: &ChannelInput, matrix_input_count: u32) -> ChannelAmpCanonical {
    let mut matrix_crosspoints: Vec<CrosspointCanonical> = input
        .matrix_crosspoints
        .iter()
        .filter(|cp| cp.source_index < matrix_input_count)
        .map(|cp| CrosspointCanonical {
            source_index: cp.source_index,
            gain_db: round_to_step(cp.gain_db, GAIN_STEPS),
            active: cp.active,
        })
        .collect();
    matrix_crosspoints.sort_by_key(|cp| cp.source_index);

    ChannelAmpCanonical {
        input_eq: canonical_eq(input.input_eq),
        source: input.source,
        matrix_crosspoints,
        delay_in_ms: round_to_step(input.delay_in_ms, DELAY_STEPS),
        output_trim_db: round_to_step(input.output_trim_db, GAIN_STEPS),
        output_volume_db: round_to_step(input.output_volume_db, GAIN_STEPS),
        noise_gate_enabled: input.noise_gate_enabled,
        input_name: canonical_input_name(input.channel_index, input.input_name),
    }
}

/// An unnamed project input is displayed as the default "In{n}" label, while
/// the device stores and reports that same default as a literal name (a real
/// DSP-2004 reads back "In1".."In4"). Both canonicalize to "" so the default
/// never reads as a mismatch.
fn canonical_input_name(channel_index: u32, name: Option<&str>) -> String {
    let name = name.map(str::trim).unwrap_or("");
    if name.eq_ignore_ascii_case(&format!("In{}", channel_index + 1)) {
        String::new()
    } else {
        name.to_string()
    }
}

/// Offline counterpart of `DiscoveredDevice.firmware_family`: buckets a
/// planned version string exactly as that protocol's live driver buckets the
/// device's, so both sides produce the same label.
fn planned_firmware_family(model: &AmpModelCatalogEntry, version: Option<&str>) -> Option<String> {
    match model.protocol {
        AmpProtocol::CvrUdp => detect_firmware_family(version?).label().map(String::from),
    }
}

fn output_letter(channel_index: u32) -> char {
    char::from(b'A' + (channel_index % 26) as u8)
}

// Fingerprint-owned enum tags — explicit, never declaration order, and
// independent of any protocol's wire codes.

fn power_mode_tag(mode: PowerMode) -> u8 {
    match mode {
        PowerMode::LowOhm => 0,
        PowerMode::V70 => 1,
        PowerMode::V100 => 2,
    }
}

fn source_kind_tag(kind: SourceKind) -> u8 {
    match kind {
        SourceKind::Analog => 0,
        SourceKind::Dante => 1,
        SourceKind::Aes3 => 2,
        SourceKind::Backup => 3,
    }
}

fn eq_filter_tag(filter_type: EqFilterType) -> u8 {
    match filter_type {
        EqFilterType::Peaking => 0,
        EqFilterType::LowShelf => 1,
        EqFilterType::HighShelf => 2,
        EqFilterType::AllPass1st => 3,
        EqFilterType::AllPass2nd => 4,
        EqFilterType::GeneralLow => 5,
        EqFilterType::GeneralHigh => 6,
        EqFilterType::ButterworthLow => 7,
        EqFilterType::ButterworthHigh => 8,
        EqFilterType::BesselLow => 9,
        EqFilterType::BesselHigh => 10,
    }
}

fn crossover_filter_tag(filter_type: CrossoverFilterType) -> u8 {
    match filter_type {
        CrossoverFilterType::Butterworth12 => 0,
        CrossoverFilterType::Bessel12 => 1,
        CrossoverFilterType::LinkwitzRiley12 => 2,
        CrossoverFilterType::Butterworth18 => 3,
        CrossoverFilterType::Butterworth24 => 4,
        CrossoverFilterType::Bessel24 => 5,
        CrossoverFilterType::LinkwitzRiley24 => 6,
        CrossoverFilterType::Butterworth36 => 7,
        CrossoverFilterType::Butterworth48 => 8,
        CrossoverFilterType::Bessel48 => 9,
        CrossoverFilterType::LinkwitzRiley48 => 10,
    }
}

// ---------------------------------------------------------------------------
// Byte encoding — fixed field order, independent of serde. Settings that
// don't affect the sound are skipped, not encoded.
// ---------------------------------------------------------------------------

struct HashInput(Vec<u8>);

impl HashInput {
    fn new() -> Self {
        Self(vec![FINGERPRINT_VERSION])
    }
    fn u8(&mut self, v: u8) {
        self.0.push(v);
    }
    fn bool(&mut self, v: bool) {
        self.0.push(v as u8);
    }
    fn u16(&mut self, v: u16) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn u32(&mut self, v: u32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn i32(&mut self, v: i32) {
        self.0.extend_from_slice(&v.to_le_bytes());
    }
    fn str(&mut self, s: &str) {
        self.u32(s.len() as u32);
        self.0.extend_from_slice(s.as_bytes());
    }
    fn opt_tag(&mut self, v: Option<u8>) {
        self.u8(v.unwrap_or(NONE_TAG));
    }
    fn opt_i32(&mut self, v: Option<i32>) {
        match v {
            Some(v) => {
                self.u8(1);
                self.i32(v);
            }
            None => self.u8(0),
        }
    }
}

fn encode_crossover(h: &mut HashInput, slot: &CrossoverCanonical) {
    h.bool(slot.active);
    if slot.active {
        h.u8(crossover_filter_tag(slot.filter_type));
        h.i32(steps(slot.freq_hz, FREQ_STEPS));
    }
}

fn encode_eq(h: &mut HashInput, eq: &EqCanonical) {
    h.u8(SECTION_EQ);
    encode_crossover(h, &eq.hp);
    h.u32(eq.bands.len() as u32);
    for band in &eq.bands {
        h.bool(band.active);
        if band.active {
            h.u8(eq_filter_tag(band.filter_type));
            h.i32(steps(band.freq_hz, FREQ_STEPS));
            h.opt_i32(band.gain_db.map(|g| steps(g, GAIN_STEPS)));
            h.opt_i32(band.q.map(|q| steps(q, Q_STEPS)));
        }
    }
    encode_crossover(h, &eq.lp);
}

fn encode_speaker(h: &mut HashInput, speaker: &SpeakerCanonical) {
    h.u8(SECTION_SPEAKER);
    encode_eq(h, &speaker.output_eq);
    h.u8(SECTION_LIMITER);
    let rms = &speaker.rms_limiter;
    h.bool(rms.enabled);
    if rms.enabled {
        h.i32(steps(rms.threshold_vrms, VOLT_STEPS));
        h.i32(steps(rms.attack_ms, WHOLE_STEPS));
        h.i32(steps(rms.release_multiplier, WHOLE_STEPS));
    }
    let peak = &speaker.peak_limiter;
    h.bool(peak.enabled);
    if peak.enabled {
        h.i32(steps(peak.threshold_vp, VOLT_STEPS));
        h.i32(steps(peak.hold_ms, WHOLE_STEPS));
        h.i32(steps(peak.release_ms, WHOLE_STEPS));
    }
    h.i32(steps(speaker.delay_out_ms, DELAY_STEPS));
    h.bool(speaker.phase_inverted);
    h.opt_tag(speaker.power_mode.map(power_mode_tag));
}

fn encode_identity(h: &mut HashInput, identity: &AmpIdentity) {
    h.u8(SECTION_IDENTITY);
    h.str(identity.model.as_deref().unwrap_or(""));
    h.u32(identity.channel_count);
    h.str(identity.firmware_family.as_deref().unwrap_or(""));
}

fn encode_channel_amp(h: &mut HashInput, channel_index: u32, speaker_hash: u16, fields: &ChannelAmpCanonical) {
    h.u8(SECTION_CHANNEL);
    h.u32(channel_index);
    h.u16(speaker_hash);
    encode_eq(h, &fields.input_eq);
    match fields.source {
        Some(source) => {
            h.u8(source_kind_tag(source.kind));
            h.u32(source.index);
        }
        None => h.u8(NONE_TAG),
    }
    h.u32(fields.matrix_crosspoints.len() as u32);
    for cp in &fields.matrix_crosspoints {
        h.u32(cp.source_index);
        h.bool(cp.active);
        if cp.active {
            h.i32(steps(cp.gain_db, GAIN_STEPS));
        }
    }
    h.i32(steps(fields.delay_in_ms, DELAY_STEPS));
    h.i32(steps(fields.output_trim_db, GAIN_STEPS));
    h.i32(steps(fields.output_volume_db, GAIN_STEPS));
    h.bool(fields.noise_gate_enabled);
    h.str(&fields.input_name);
}

fn encode_bridge_pairs(h: &mut HashInput, pairs: &[Option<bool>]) {
    h.u8(SECTION_BRIDGE);
    h.u32(pairs.len() as u32);
    for pair in pairs {
        h.opt_tag(pair.map(u8::from));
    }
}

// ---------------------------------------------------------------------------
// Hash functions
// ---------------------------------------------------------------------------

/// CRC-16/XModem (poly 0x1021, init 0) — same variant as the prior web app.
fn crc16_xmodem(data: &[u8]) -> u16 {
    let mut crc: u16 = 0;
    for &byte in data {
        crc ^= (byte as u16) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 { (crc << 1) ^ 0x1021 } else { crc << 1 };
        }
    }
    crc
}

fn fnv1a_64(data: &[u8]) -> u64 {
    let mut hash: u64 = 0xcbf2_9ce4_8422_2325;
    for &byte in data {
        hash ^= byte as u64;
        hash = hash.wrapping_mul(0x0000_0100_0000_01b3);
    }
    hash
}

// ---------------------------------------------------------------------------
// Output-name hash suffix
// ---------------------------------------------------------------------------

/// Splits `"Name_A91C"` into `("Name", Some("A91C"))`; a name without a
/// valid `_XXXX` suffix comes back whole with `None`.
pub fn split_hash_suffix(name: &str) -> (&str, Option<String>) {
    let bytes = name.as_bytes();
    if bytes.len() >= HASH_SUFFIX_LEN {
        let at = bytes.len() - HASH_SUFFIX_LEN;
        if bytes[at] == b'_' && bytes[at + 1..].iter().all(u8::is_ascii_hexdigit) {
            return (&name[..at], Some(name[at + 1..].to_ascii_uppercase()));
        }
    }
    (name, None)
}

/// Builds `"<base>_<hash>"`, truncating the base so the whole name fits
/// `name_max_len` bytes (`AmpParamRanges.channel_name_max_length`). Non-ASCII
/// characters are dropped — the device name field is ASCII only.
#[allow(dead_code)] // used once the name-write step of the online/offline phase lands
pub fn embed_hash_in_name(base: &str, hash: &str, name_max_len: usize) -> String {
    let base_max = name_max_len.saturating_sub(HASH_SUFFIX_LEN);
    let base: String = base.trim().chars().filter(|c| c.is_ascii()).take(base_max).collect();
    format!("{base}_{hash}")
}

#[cfg(test)]
mod tests {
    use super::super::project::{PeakLimiter, RmsLimiter};
    use super::*;

    fn eq(gain_db: f64, q: f64) -> ChannelEq {
        let hp = CrossoverSlot { filter_type: CrossoverFilterType::LinkwitzRiley24, freq_hz: 80.0, active: true };
        let band = EqBand { filter_type: EqFilterType::Peaking, freq_hz: 1234.5, gain_db, q, active: true };
        ChannelEq { hp, bands: vec![band; 8], lp: CrossoverSlot { freq_hz: 20000.0, active: false, ..hp } }
    }

    fn limiter() -> Limiter {
        Limiter {
            rms: RmsLimiter { enabled: true, threshold_vrms: 63.3, attack_ms: 5.0, release_multiplier: 4.0 },
            peak: PeakLimiter { enabled: false, threshold_vp: 140.0, hold_ms: 10.0, release_ms: 50.0 },
        }
    }

    fn input<'a>(eq: &'a ChannelEq, limiter: &'a Limiter, delay_out_ms: f64) -> ChannelInput<'a> {
        ChannelInput {
            channel_index: 0,
            source: None,
            source_readable: true,
            matrix_crosspoints: &[],
            delay_in_ms: 0.0,
            output_trim_db: 0.0,
            output_volume_db: 0.0,
            delay_out_ms,
            input_eq: eq,
            output_eq: eq,
            limiter,
            noise_gate_enabled: false,
            output_phase_inverted: false,
            input_name: None,
            output_name: None,
            power_mode: Some(PowerMode::LowOhm),
            bridged: None,
        }
    }

    fn speaker_hash(input: &ChannelInput) -> u16 {
        let mut h = HashInput::new();
        encode_speaker(&mut h, &canonical_speaker(input));
        crc16_xmodem(&h.0)
    }

    fn amp_hash(inputs: Vec<ChannelInput>, matrix_input_count: u32) -> Option<String> {
        let origin = FingerprintOrigin {
            kind: FingerprintSource::Offline,
            project_id: None,
            assignment_id: None,
            device_id: None,
            mac: None,
            label: None,
        };
        let identity = AmpIdentity {
            model: Some("DSP-1002".to_string()),
            amp_model_id: None,
            channel_count: inputs.len() as u32,
            firmware_family: Some("1.1.8".to_string()),
        };
        build(origin, identity, matrix_input_count, inputs, Vec::new()).amp_hash
    }

    #[test]
    fn crc16_xmodem_check_value() {
        assert_eq!(crc16_xmodem(b"123456789"), 0x31C3);
    }

    #[test]
    fn fnv1a_64_offset_basis() {
        assert_eq!(fnv1a_64(b""), 0xCBF2_9CE4_8422_2325);
    }

    #[test]
    fn offline_f64_matches_online_f32_readback() {
        let limiter = limiter();
        let offline = eq(0.1, 1.41);
        let online = eq(0.1f32 as f64, 1.41f32 as f64);
        assert_eq!(
            speaker_hash(&input(&offline, &limiter, 2.35)),
            speaker_hash(&input(&online, &limiter, 2.35f32 as f64))
        );
        // And both display as the clean value, not the f32 noise.
        assert_eq!(canonical_band(&online.bands[0]).gain_db, Some(0.1));
        assert_eq!(canonical_band(&online.bands[0]).q, Some(1.41));
    }

    #[test]
    fn real_changes_change_the_hash() {
        let limiter = limiter();
        let a = eq(0.1, 1.41);
        let b = eq(0.2, 1.41);
        assert_ne!(speaker_hash(&input(&a, &limiter, 0.0)), speaker_hash(&input(&b, &limiter, 0.0)));
    }

    #[test]
    fn inactive_and_unused_values_are_ignored() {
        let limiter = limiter();
        let mut a = eq(3.0, 1.0);
        let mut b = eq(3.0, 1.0);
        // Leftover values on an inactive band and LP slot.
        a.bands[2].active = false;
        b.bands[2] = EqBand { gain_db: -12.0, freq_hz: 50.0, active: false, ..b.bands[2] };
        b.lp.freq_hz = 15000.0;
        // Gain/Q an all-pass filter doesn't use.
        a.bands[3].filter_type = EqFilterType::AllPass1st;
        b.bands[3] = EqBand { filter_type: EqFilterType::AllPass1st, gain_db: 9.0, q: 4.0, ..b.bands[3] };
        // A disabled peak limiter's parameters.
        let mut other_limiter = limiter;
        other_limiter.peak.threshold_vp = 300.0;
        assert_eq!(speaker_hash(&input(&a, &limiter, 0.0)), speaker_hash(&input(&b, &other_limiter, 0.0)));
    }

    #[test]
    fn bypassed_values_stay_visible_and_unused_ones_are_null() {
        let band = EqBand { filter_type: EqFilterType::Peaking, freq_hz: 56.0, gain_db: 9.0, q: 1.8, active: false };
        let shown = canonical_band(&band);
        assert_eq!((shown.freq_hz, shown.gain_db, shown.q, shown.active), (56.0, Some(9.0), Some(1.8), false));

        let all_pass = canonical_band(&EqBand { filter_type: EqFilterType::AllPass1st, active: true, ..band });
        assert_eq!((all_pass.gain_db, all_pass.q), (None, None));
    }

    #[test]
    fn crosspoints_beyond_topology_are_ignored() {
        // The CVR parser reads 4 crosspoints even on a 2-channel amp, whose
        // project only has 2.
        let limiter = limiter();
        let eq = eq(0.0, 1.0);
        let planned = [
            MatrixCrosspoint { source_index: 0, gain_db: 0.0, active: true },
            MatrixCrosspoint { source_index: 1, gain_db: -3.0, active: true },
        ];
        let read_back = [
            planned[0].clone(),
            planned[1].clone(),
            MatrixCrosspoint { source_index: 2, gain_db: 6.0, active: true },
            MatrixCrosspoint { source_index: 3, gain_db: -80.0, active: false },
        ];
        let project = ChannelInput { matrix_crosspoints: &planned, ..input(&eq, &limiter, 0.0) };
        let live = ChannelInput { matrix_crosspoints: &read_back, ..input(&eq, &limiter, 0.0) };
        let project_hash = amp_hash(vec![project], 2);
        assert!(project_hash.is_some());
        assert_eq!(project_hash, amp_hash(vec![live], 2));
    }

    #[test]
    fn default_input_label_equals_unnamed() {
        assert_eq!(canonical_input_name(0, Some("In1")), canonical_input_name(0, None));
        assert_eq!(canonical_input_name(3, Some(" in4 ")), "");
        assert_eq!(canonical_input_name(0, Some("In2")), "In2");
        assert_eq!(canonical_input_name(1, Some("Kick")), "Kick");
    }

    #[test]
    fn name_suffix_round_trip() {
        let name = embed_hash_in_name("  Top Left Speaker ", "A91C", 16);
        assert_eq!(name, "Top Left Sp_A91C");
        assert_eq!(name.len(), 16);
        assert_eq!(split_hash_suffix(&name), ("Top Left Sp", Some("A91C".to_string())));
        assert_eq!(split_hash_suffix("Sub_a91c").1.as_deref(), Some("A91C"));
        assert_eq!(split_hash_suffix("Sub_XYZ1"), ("Sub_XYZ1", None));
        assert_eq!(split_hash_suffix("Sub"), ("Sub", None));
    }
}
