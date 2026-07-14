//! CVR firmware 1.1.8 FC=27 (SYNC_DATA) response -> per-channel DSP config.
//! Ground-truthed against the reference implementation's
//! `lib/parse-channel-data.ts`, which itself documents these offsets as
//! "empirically confirmed by diffing live snapshots with known [device]
//! states" — this is real, not guessed, data.
//!
//! Unlike that reference (and unlike this app's own earlier heartbeat
//! telemetry work before this file), channel/trailer geometry here is
//! derived from the device's *real known* `firmware_family` (1.1.8's fixed
//! trailer size — see `TRAILER_SIZE_V118`), not from guessing the layout by
//! testing which length-modulo-515 arithmetic happens to divide evenly — see
//! `channel_config.rs`'s module doc for why that guess-based approach is
//! being deliberately avoided. Note the trailer size itself was corrected
//! from the reference's documented value based on real hardware traffic —
//! see `TRAILER_SIZE_V118`'s doc.
//!
//! `prmsW`/`ppeakW` (wattage computed from limiter thresholds × load
//! impedance) are not parsed here — the reference computes them downstream,
//! dependent on data (configured load impedance) this parser doesn't have.

use crate::data::capability::{CrossoverFilterType, EqFilterType, PowerMode, SourceKind};
use crate::data::common::now_millis;
use crate::data::project::{ChannelEq, ChannelSource, CrossoverSlot, EqBand, Limiter, MatrixCrosspoint, PeakLimiter, RmsLimiter};

use super::channel_config::{ChannelConfig, ChannelConfigSnapshot};

/// 172, NOT the reference implementation's documented 192 — this value is
/// corrected from direct measurement against real hardware (a 1.1.8
/// `DSP-2004`), not carried over from the reference. Its FC=27 replies
/// consistently assemble to exactly `4*515 + 172 + 13 (StructHeader+
/// checksum) = 2245` bytes, an exact division with no remainder — the
/// reference's 192 does not divide evenly against this device's real
/// traffic at all. The trailer's *internal* field offsets below
/// (muteIn@132, analog-matrix@136, rotary-lock@33, backup-priority@140/176)
/// are still only as verified as the reference documented them — this fix
/// corrects the trailer's total *size* (and therefore channel-count
/// derivation), not necessarily every byte's meaning within it. Worth
/// testing those specifically (e.g. toggle a real channel's mute and confirm
/// the parsed `inputMuted` flips) now that geometry derivation succeeds.
pub const TRAILER_SIZE_V118: usize = 172;
pub const BYTES_PER_CHANNEL: usize = 515;

fn f32_le(body: &[u8], abs: usize) -> f32 {
    body.get(abs..abs + 4).map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]])).unwrap_or(0.0)
}

fn u16_le(body: &[u8], abs: usize) -> u16 {
    body.get(abs..abs + 2).map(|b| u16::from_le_bytes([b[0], b[1]])).unwrap_or(0)
}

fn u8_at(body: &[u8], abs: usize) -> u8 {
    body.get(abs).copied().unwrap_or(0)
}

fn i8_at(body: &[u8], abs: usize) -> i8 {
    u8_at(body, abs) as i8
}

/// 16-byte ASCII, NUL-terminated. `None` for an empty/all-NUL field, rather
/// than the reference's synthetic `"Ch{n}{field}"` fallback label — an
/// absent name should read as absent, not as fabricated placeholder text.
fn ascii_16(body: &[u8], abs: usize) -> Option<String> {
    let bytes = body.get(abs..abs + 16)?;
    let end = bytes.iter().position(|&b| b == 0).unwrap_or(bytes.len());
    if end == 0 {
        return None;
    }
    let s = String::from_utf8_lossy(&bytes[..end]).trim().to_string();
    if s.is_empty() { None } else { Some(s) }
}

/// Confirmed 1:1 against the reference's `EQ_FILTER_TYPE_NAMES` — numeric
/// code equals `EqFilterType`'s declaration-order index exactly (0=Peaking
/// .. 10=BesselHigh). Any code outside 0..=10 falls back to `Peaking` with a
/// `// FLAG` — the struct field isn't `Option`, so an unmapped code can't
/// cleanly express "unknown" the way `power_mode`/`source` do.
fn eq_filter_type(code: u8) -> EqFilterType {
    match code {
        0 => EqFilterType::Peaking,
        1 => EqFilterType::LowShelf,
        2 => EqFilterType::HighShelf,
        3 => EqFilterType::AllPass1st,
        4 => EqFilterType::AllPass2nd,
        5 => EqFilterType::GeneralLow,
        6 => EqFilterType::GeneralHigh,
        7 => EqFilterType::ButterworthLow,
        8 => EqFilterType::ButterworthHigh,
        9 => EqFilterType::BesselLow,
        10 => EqFilterType::BesselHigh,
        _ => EqFilterType::Peaking, // FLAG: unmapped code, defaulted rather than panicking
    }
}

/// Confirmed 1:1 against the reference's `HPLP_FILTER_TYPE_NAMES` (its own
/// comment: "indices match the C# HPorLP_InttoString array") — numeric code
/// equals `CrossoverFilterType`'s declaration-order index exactly
/// (0=Butterworth12 .. 10=LinkwitzRiley48).
fn crossover_filter_type(code: u8) -> CrossoverFilterType {
    match code {
        0 => CrossoverFilterType::Butterworth12,
        1 => CrossoverFilterType::Bessel12,
        2 => CrossoverFilterType::LinkwitzRiley12,
        3 => CrossoverFilterType::Butterworth18,
        4 => CrossoverFilterType::Butterworth24,
        5 => CrossoverFilterType::Bessel24,
        6 => CrossoverFilterType::LinkwitzRiley24,
        7 => CrossoverFilterType::Butterworth36,
        8 => CrossoverFilterType::Butterworth48,
        9 => CrossoverFilterType::Bessel48,
        10 => CrossoverFilterType::LinkwitzRiley48,
        _ => CrossoverFilterType::Butterworth12, // FLAG: unmapped code
    }
}

/// Confirmed 1:1 against the reference's `POWER_MODE_NAMES` (0=Low-Ω,
/// 1=70V, 2=100V) — matches `PowerMode`'s declaration order exactly. `None`
/// for any other byte value — genuinely unmapped, not defaulted.
fn power_mode(code: u8) -> Option<PowerMode> {
    match code {
        0 => Some(PowerMode::LowOhm),
        1 => Some(PowerMode::V70),
        2 => Some(PowerMode::V100),
        _ => None,
    }
}

/// Confirmed base mapping against the reference's `clampSourceCode`/
/// `sourceNameFromCode` (0=Analog, 1=Dante, 2=Aes3, >=3=Backup — matches
/// `SourceKind`'s declaration order exactly for the common case). One
/// unresolved edge case the reference itself only handles with model
/// capability data we don't have here: on an amp with AES3 but no Dante,
/// code 1 actually means Aes3, not Dante. Without a catalog-model link this
/// phase (see `channel_config.rs`'s module doc), that distinction can't be
/// made — this always maps code 1 to `Dante`, which is correct for
/// Dante-equipped amps and wrong only for the analog+AES3-no-Dante case.
///
/// `index`: for Analog, the trailer's per-channel analog-matrix source
/// index (patchable, not fixed to `channel_index`). For Dante/Aes3, this
/// app's own established convention is a fixed 1:1 pairing (Dante/AES3
/// channel N feeds digital input N — see `data/project.rs`'s
/// `SourceChannelCount` doc), so `index = channel_index`. For Backup, there
/// is no established index semantics in this app's model yet — `0` is a
/// placeholder, not a meaningful position.
fn source(raw_code: u8, channel_index: u32, analog_matrix_index: u8) -> ChannelSource {
    if raw_code >= 3 {
        return ChannelSource { kind: SourceKind::Backup, index: 0 };
    }
    match raw_code {
        0 => ChannelSource { kind: SourceKind::Analog, index: analog_matrix_index as u32 },
        1 => ChannelSource { kind: SourceKind::Dante, index: channel_index },
        _ => ChannelSource { kind: SourceKind::Aes3, index: channel_index },
    }
}

struct EqBlockResult {
    hp: CrossoverSlot,
    bands: Vec<EqBand>,
    lp: CrossoverSlot,
}

/// 10 bands x 14-byte stride: type(u8,1) + gain(f32LE,4) + freq(f32LE,4) +
/// q(f32LE,4) + bypass(u8,1) = 14 bytes. Bypass is C# sbyte-convention
/// sign-encoded into the type byte (`raw_type >= 128` => bypassed, real type
/// = `255 - raw_type`) OR the trailing byte — either condition means
/// bypassed. Band 0 = HP crossover slot, band 9 = LP crossover slot (their
/// own type vocabulary); bands 1..=8 = parametric EQ bands.
fn parse_eq_block(body: &[u8], block_offset: usize) -> EqBlockResult {
    const STRIDE: usize = 14;
    let mut hp = None;
    let mut lp = None;
    let mut bands = Vec::with_capacity(8);

    for band_index in 0..10usize {
        let off = block_offset + band_index * STRIDE;
        let raw_type = u8_at(body, off);
        let bypass_encoded = raw_type >= 128;
        let real_type = if bypass_encoded { 255 - raw_type } else { raw_type };
        let bypass = bypass_encoded || u8_at(body, off + 13) != 0;
        let gain = f32_le(body, off + 1);
        let freq = f32_le(body, off + 5);
        let q = f32_le(body, off + 9);
        let active = !bypass;

        if band_index == 0 {
            hp = Some(CrossoverSlot { filter_type: crossover_filter_type(real_type), freq_hz: freq as f64, active });
        } else if band_index == 9 {
            lp = Some(CrossoverSlot { filter_type: crossover_filter_type(real_type), freq_hz: freq as f64, active });
        } else {
            bands.push(EqBand {
                filter_type: eq_filter_type(real_type),
                freq_hz: freq as f64,
                gain_db: gain as f64,
                q: q as f64,
                active,
            });
        }
    }

    EqBlockResult { hp: hp.unwrap(), bands, lp: lp.unwrap() }
}

fn parse_channel(body: &[u8], channel_index: u32, trailer_base: usize) -> ChannelConfig {
    let base = channel_index as usize * BYTES_PER_CHANNEL;
    let at = |rel: usize| base + rel;

    let input_eq_raw = parse_eq_block(body, at(121));
    let output_eq_raw = parse_eq_block(body, at(262));

    let matrix_crosspoints = (0..4u32)
        .map(|k| {
            let off = at(60 + k as usize * 5);
            MatrixCrosspoint { source_index: k, gain_db: f32_le(body, off) as f64, active: u8_at(body, off + 4) != 0 }
        })
        .collect();

    // Trailer fields — source of truth for input_muted and the analog
    // matrix source index (NOT any channel-body byte).
    let input_muted = u8_at(body, trailer_base + 132 + channel_index as usize) == 0; // wire-inverted
    let analog_matrix_index = u8_at(body, trailer_base + 136 + channel_index as usize);

    let raw_source_code = u8_at(body, at(85));

    ChannelConfig {
        channel_index,
        gain_in: i8_at(body, at(117)) as i32,
        delay_in_ms: f32_le(body, at(86)),
        input_muted,
        matrix_crosspoints,
        input_eq: ChannelEq { hp: input_eq_raw.hp, bands: input_eq_raw.bands, lp: input_eq_raw.lp },
        output_eq: ChannelEq { hp: output_eq_raw.hp, bands: output_eq_raw.bands, lp: output_eq_raw.lp },
        output_trim_db: f32_le(body, at(80)),
        output_volume_db: f32_le(body, at(405)),
        output_muted: u8_at(body, at(84)) == 0, // inverted: 0=muted
        delay_out_ms: f32_le(body, at(90)),
        output_phase_inverted: u8_at(body, at(94)) != 0,
        noise_gate_enabled: u8_at(body, at(409)) == 0, // inverted: 0=enabled
        limiter: Limiter {
            rms: RmsLimiter {
                // active-low: offset 102 is correct (not 100 — a previously
                // fixed reference-side bug); device sets byte 102=1 during
                // bypass.
                enabled: u8_at(body, at(102)) == 0,
                threshold_vrms: f32_le(body, at(98)) as f64,
                attack_ms: u16_le(body, at(95)) as f64,
                release_multiplier: u8_at(body, at(97)) as f64,
            },
            peak: PeakLimiter {
                enabled: u8_at(body, at(116)) == 0, // active-low
                threshold_vp: f32_le(body, at(112)) as f64,
                hold_ms: u16_le(body, at(108)) as f64,
                release_ms: u16_le(body, at(110)) as f64,
            },
        },
        fir_bypassed: u8_at(body, at(404)) != 0, // inverted: 0=enabled
        power_mode: power_mode(u8_at(body, at(403))),
        source: Some(source(raw_source_code, channel_index, analog_matrix_index)),
        input_name: ascii_16(body, at(414)),
        output_name: ascii_16(body, at(430)),
        analog_trim_db: f32_le(body, at(36)),
        analog_delay_ms: f32_le(body, at(40)),
        dante_trim_db: f32_le(body, at(44)),
        dante_delay_ms: f32_le(body, at(48)),
        aes3_trim_db: f32_le(body, at(52)),
        aes3_delay_ms: f32_le(body, at(56)),
    }
}

/// `body` = the pure per-channel-data region (StructHeader/checksum already
/// stripped by the caller — see `channel_config.rs`'s dispatcher doc).
/// Returns `None` on any geometry failure: too short, remainder doesn't
/// divide evenly by 515, or channel count outside 1..=4 — a real parse
/// failure surfaced as an honest gap, never a silent best-effort fallback
/// (contrast the reference's `detectPayloadLayout`, which falls back to
/// `floor(len/515)` and assumes the 118 trailer on any unrecognized shape).
pub fn parse_channel_config(body: &[u8]) -> Option<ChannelConfigSnapshot> {
    if body.len() < TRAILER_SIZE_V118 {
        return None;
    }
    let remainder = body.len() - TRAILER_SIZE_V118;
    if remainder % BYTES_PER_CHANNEL != 0 {
        return None;
    }
    let channel_count = remainder / BYTES_PER_CHANNEL;
    if !(1..=4).contains(&channel_count) {
        return None;
    }
    let trailer_base = channel_count * BYTES_PER_CHANNEL;

    let channels = (0..channel_count as u32).map(|c| parse_channel(body, c, trailer_base)).collect();

    // Backup priority order lives in one of two trailer layouts depending on
    // which secondary source families the amp has (Dante+AES3 vs. a single
    // secondary source) — data this parser doesn't have without a catalog-
    // model link. Known gap: `None` rather than guessing which variant
    // applies.
    let backup_priority = None;

    // Rotary lock: the standard trailerBase+33 byte, strict 0/1 decode,
    // covers the 4-channel case this parser targets. The reference's
    // alternate 2-channel "DP_1" `bufferLen-486` layout is a known gap here.
    let rotary_lock_byte = u8_at(body, trailer_base + 33);
    let rotary_locked = match rotary_lock_byte {
        0 => Some(false),
        1 => Some(true),
        _ => None,
    };

    Some(ChannelConfigSnapshot { channels, backup_priority, rotary_locked, received_at: now_millis() })
}
