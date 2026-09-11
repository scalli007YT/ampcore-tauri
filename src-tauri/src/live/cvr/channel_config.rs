//! Shared channel-config adapter surface — the struct every firmware-specific
//! FC=27 (SYNC_DATA) adapter parses a reassembled response into, plus the
//! single dispatch point that picks which adapter handles a device based on
//! its `firmware_family` (same pattern as `telemetry.rs`).
//!
//! Deliberately separate from `AmpChannel` (`data/project.rs`): that struct
//! carries planning-only fields (`id`, `ohms`) with no live-wire equivalent — the same separation already
//! established between `Telemetry` and `AmpChannel`.

use serde::Serialize;
use specta::Type;

use crate::data::capability::PowerMode;
use crate::data::project::{ChannelEq, ChannelSource, Limiter, MatrixCrosspoint};

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChannelConfig {
    pub channel_index: u32,
    pub gain_in: i32,
    pub delay_in_ms: f32,
    /// Sourced from the trailer's `muteIn` block, NOT any channel-body byte
    /// — see `channel_config_v118.rs`.
    pub input_muted: bool,
    pub matrix_crosspoints: Vec<MatrixCrosspoint>,
    pub input_eq: ChannelEq,
    pub output_eq: ChannelEq,
    pub output_trim_db: f32,
    pub output_volume_db: f32,
    pub output_muted: bool,
    pub delay_out_ms: f32,
    pub output_phase_inverted: bool,
    pub noise_gate_enabled: bool,
    pub limiter: Limiter,
    pub fir_bypassed: bool,
    /// `None` when the raw byte doesn't match a confirmed mapping — no
    /// mapping table for this exists anywhere in this codebase yet, so an
    /// unconfirmed guess is never substituted (see `channel_config_v118.rs`).
    pub power_mode: Option<PowerMode>,
    /// `None` when the raw source-selector byte doesn't match a confirmed
    /// mapping — same honesty rule as `power_mode`.
    pub source: Option<ChannelSource>,
    pub input_name: Option<String>,
    pub output_name: Option<String>,
    pub analog_trim_db: f32,
    pub analog_delay_ms: f32,
    pub dante_trim_db: f32,
    pub dante_delay_ms: f32,
    pub aes3_trim_db: f32,
    pub aes3_delay_ms: f32,
}

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct ChannelConfigSnapshot {
    pub channels: Vec<ChannelConfig>,
    /// `None` when the payload shape doesn't match the variant this parser
    /// implements — a known gap, not a guess (see `channel_config_v118.rs`).
    pub backup_priority: Option<Vec<Vec<u8>>>,
    /// `None` for payload shapes this parser doesn't special-case (e.g. the
    /// reference's 2-channel `DP_1` layout) — known gap, not a guess.
    pub rotary_locked: Option<bool>,
    pub received_at: f64,
}

/// Routes a reassembled FC=27 response body to the adapter for
/// `firmware_family`. A family this dispatch doesn't recognize (`None`/
/// unknown) gets no channel config at all — no generic fallback parser,
/// since guessing wrong would silently produce plausible-looking garbage
/// instead of an honest gap. `body` is the pure per-channel-data region:
/// the reassembled frame with StructHeader and checksum already stripped,
/// channel 0 starting at offset 0 (the driver does this slicing before
/// calling in — see `driver.rs`).
pub fn parse_channel_config(firmware_family: Option<&str>, body: &[u8]) -> Option<ChannelConfigSnapshot> {
    match firmware_family {
        Some("1.1.8") => super::channel_config_v118::parse_channel_config(body),
        Some("1.1.9") => super::channel_config_v119::parse_channel_config(body),
        _ => None,
    }
}
