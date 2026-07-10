use serde::{Deserialize, Serialize};
use specta::Type;

use super::super::amp_model::{AmpDspTopology, AmpModelCatalogEntry};
use super::{AmpCapability, ParamRange, PowerMode, SourceKind};

/// Fixed EQ structure on every CVR channel, both directions (input/output):
/// band 0 = HP crossover, bands 1-8 = parametric, band 9 = LP crossover.
/// Ported from the old app's fixed 10-band layout.
const EQ_BANDS_PER_CHANNEL: u32 = 10;

/// V_num threshold for extended EQ.
pub const VNUM_EXTENDED_EQ: u32 = 116;
/// V_num threshold for the "Phonic" variant.
pub const VNUM_PHONIC_VARIANT: u32 = 117;
/// V_num threshold for speaker management + FIR filters (current baseline).
pub const VNUM_118: u32 = 118;
/// V_num threshold for noise gate thresholds, extended delay, split trim/volume.
pub const VNUM_119: u32 = 119;

/// Numeric firmware "generation" (vNum) and the feature deltas it gates —
/// ported 1:1 from the old app's `lib/amp-version.ts`. Computed fresh from a
/// firmware version string every time; never persisted independently.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct CvrFirmwareCapability {
    pub v_num: Option<u32>,
    pub extended_eq: bool,
    pub phonic_variant: bool,
    pub speaker_management: bool,
    pub fir_filters: bool,
    pub noise_gate_threshold: bool,
    pub extended_delay: bool,
    pub split_trim_volume: bool,
}

impl CvrFirmwareCapability {
    pub fn from_version(version_string: Option<&str>) -> Self {
        let v_num = version_string.and_then(extract_vnum);
        let at_least = |min: u32| v_num.map(|v| v >= min).unwrap_or(false);
        Self {
            v_num,
            extended_eq: at_least(VNUM_EXTENDED_EQ),
            phonic_variant: at_least(VNUM_PHONIC_VARIANT),
            speaker_management: at_least(VNUM_118),
            fir_filters: at_least(VNUM_118),
            noise_gate_threshold: at_least(VNUM_119),
            extended_delay: at_least(VNUM_119),
            split_trim_volume: at_least(VNUM_119),
        }
    }
}

/// Extracts a numeric firmware "generation" (vNum) from a version string.
/// Handles two input shapes:
///   - a user-picked dotted string from offline planning, e.g. "1.1.9" -> 119
///     (single-digit major.minor.patch components — the only shape
///     `firmwareOptions.ts` produces today).
///   - the raw wire/machine-name string a live device reports, e.g.
///     "42404B06-006118-DSP-2004" -> 118 (last 3 digits of the first 6+-digit
///     run). Ported from the old app's `extractVNum` so the future live
///     driver can reuse this exact function once it starts passing real
///     device strings — do not duplicate this parsing there.
pub fn extract_vnum(version_string: &str) -> Option<u32> {
    parse_dotted(version_string).or_else(|| parse_wire_run(version_string))
}

fn parse_dotted(s: &str) -> Option<u32> {
    let parts: Vec<&str> = s.trim().split('.').collect();
    if parts.len() != 3 {
        return None;
    }
    let mut digits = String::with_capacity(3);
    for part in parts {
        if part.len() != 1 || !part.chars().all(|c| c.is_ascii_digit()) {
            return None;
        }
        digits.push_str(part);
    }
    digits.parse().ok()
}

/// Finds runs of 6+ consecutive digits (the zero-padded version block —
/// shorter runs are model/serial numbers, e.g. "42404" in
/// "42404B06-006118-DSP-2004") and returns the last 3 digits of the first
/// such run, if it forms a plausible version number (100..=999).
fn parse_wire_run(s: &str) -> Option<u32> {
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && bytes[i].is_ascii_digit() {
                i += 1;
            }
            if i - start >= 6 {
                if let Ok(n) = s[i - 3..i].parse::<u32>() {
                    if (100..=999).contains(&n) {
                        return Some(n);
                    }
                }
            }
        } else {
            i += 1;
        }
    }
    None
}

/// Global CVR DSP parameter ranges/units — ported 1:1 from the old app's
/// `lib/constants.ts`.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AmpParamRanges {
    pub matrix_gain_db: ParamRange,
    pub output_trim_db: ParamRange,
    pub output_volume_db: ParamRange,
    pub delay_in_ms: ParamRange,
    pub delay_out_ms: ParamRange,
    pub crossover_freq_hz: ParamRange,
    pub eq_band_gain_db: ParamRange,
    pub eq_band_q: ParamRange,
    pub preset_slots: ParamRange,
}

/// Constant across the whole CVR product line today (the old app didn't vary
/// these per model/firmware either). Returned per-resolve rather than
/// exported as raw constants so a future per-model or per-vNum override
/// doesn't change `AmpCapability`'s shape.
pub fn cvr_param_ranges() -> AmpParamRanges {
    AmpParamRanges {
        matrix_gain_db: ParamRange { min: -80.0, max: 18.0 },
        output_trim_db: ParamRange { min: -18.0, max: 18.0 },
        output_volume_db: ParamRange { min: -80.0, max: 18.0 },
        delay_in_ms: ParamRange { min: 0.0, max: 100.0 },
        delay_out_ms: ParamRange { min: 0.0, max: 20.0 },
        crossover_freq_hz: ParamRange { min: 20.0, max: 20000.0 },
        eq_band_gain_db: ParamRange { min: -18.0, max: 18.0 },
        eq_band_q: ParamRange { min: 0.1, max: 32.0 },
        preset_slots: ParamRange { min: 1.0, max: 40.0 },
    }
}

/// Per-model rated RMS voltage — ported from the old app's `lib/amp-model.ts`.
/// Proxy for electrical/gain limits; `None` for anything outside this 12-SKU
/// product line (e.g. user-defined models). Dante variants share their base
/// model's electrical rating, so the trailing "D" is stripped before lookup.
fn rated_rms_voltage(model: &str) -> Option<f64> {
    let base = model.strip_suffix('D').unwrap_or(model);
    match base {
        "DSP-654" => Some(72.1),
        "DSP-802" => Some(80.0),
        "DSP-1002" => Some(89.4),
        "DSP-1004" => Some(89.4),
        "DSP-1502" => Some(109.5),
        "DSP-2002" => Some(126.5),
        "DSP-1504" => Some(109.5),
        "DSP-2004" => Some(126.5),
        "DSP-3002" => Some(154.9),
        "DSP-3004" => Some(154.9),
        "DSP-3302" => Some(162.5),
        "DSP-4302" => Some(185.5),
        _ => None,
    }
}

/// Builds the real per-model `AmpDspTopology` for a builtin CVR catalog entry
/// — called by `store.rs` at seed time, the single source of truth for
/// builtin topology data (avoids a third copy of this table alongside
/// `BUILTIN_AMP_MODELS` and the frontend's `ampSpecSheets.ts`).
///
/// Matrix input count is always `channel_count`, regardless of Dante — analog
/// vs. Dante is a per-channel Source Selection choice (`AmpChannel.source`),
/// not a doubling of the matrix's input columns. AES3/backup source
/// availability has no offline equivalent in this catalog yet (the old app
/// derived it from a live "line mode" digit) — deliberately not fabricated
/// here.
pub fn builtin_topology(model: &str, channel_count: u32, is_dante: bool) -> AmpDspTopology {
    AmpDspTopology {
        matrix_input_count: channel_count,
        matrix_output_count: channel_count,
        eq_bands_per_channel: EQ_BANDS_PER_CHANNEL,
        available_sources: if is_dante {
            vec![SourceKind::Analog, SourceKind::Dante]
        } else {
            vec![SourceKind::Analog]
        },
        power_modes: vec![PowerMode::LowOhm, PowerMode::V70, PowerMode::V100],
        rated_rms_voltage: rated_rms_voltage(model),
    }
}

pub fn resolve(model: &AmpModelCatalogEntry, firmware_version: Option<&str>) -> AmpCapability {
    AmpCapability {
        topology: model.topology.clone(),
        firmware: CvrFirmwareCapability::from_version(firmware_version),
        param_ranges: cvr_param_ranges(),
    }
}
