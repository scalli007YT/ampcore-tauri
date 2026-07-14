//! Shared telemetry adapter surface — the `Telemetry` struct every
//! firmware-specific adapter parses a heartbeat reply into, plus the single
//! dispatch point that picks which adapter handles a given device based on
//! its `firmware_family` (detected once at discovery time from the BASIC_INFO
//! reply, see `protocol.rs`'s `detect_firmware_family`).
//!
//! Each firmware family gets its own file (`telemetry_v118.rs`,
//! `telemetry_v119.rs`) rather than one parser branching internally on
//! version, so a firmware's wire format can diverge — or get corrected once
//! real hardware is available to verify against — without touching another
//! firmware's already-ground-truthed code path.

use serde::Serialize;
use specta::Type;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Telemetry {
    /// 5 readings: [0-3] = per-channel, [4] = PSU.
    pub temperatures: Vec<f32>,
    pub output_voltages: Vec<f32>,
    pub output_currents: Vec<f32>,
    pub output_impedance: Vec<f32>,
    /// dB relative to the device's rated RMS output voltage (`0dB` = rated
    /// max output) — `None` per-channel until `driver.rs` fills it in, since
    /// the wire-format adapters (`telemetry_v118`/`telemetry_v119`) only see
    /// raw packet bytes, not the device's firmware-version string needed to
    /// look up a real reference voltage (see
    /// `capability::cvr::rated_rms_voltage_from_firmware_string`). Stays
    /// `None` entirely for a model this app doesn't recognize — never a
    /// guessed/default reference.
    pub output_level_db: Vec<Option<f32>>,
    /// The real reference voltage `output_level_db` was computed against
    /// (`0dB` = this voltage) — device-wide, not per-channel. Exposed
    /// alongside `output_level_db` so the frontend can scale a meter against
    /// the *real* rated voltage instead of an approximate/generic constant.
    /// `None` under the same conditions as `output_level_db`.
    pub rated_rms_voltage: Option<f64>,
    pub output_states: Vec<u32>,
    pub input_voltages: Vec<f32>,
    pub input_dbfs: Vec<Option<f32>>,
    pub limiters: Vec<f32>,
    pub input_states: Vec<i32>,
    /// `None` on the (common) heartbeat body lengths that don't include this
    /// trailing field at all — only the 96-byte `WHOLE118_PLUS` variant
    /// carries it. Was previously a bare `f32` that silently defaulted to
    /// `0.0` on every shorter body, i.e. real-looking fake data for any
    /// device that isn't actually sending the 96-byte variant.
    pub fan_voltage: Option<f32>,
    pub machine_mode: i32,
    pub received_at: f64,
}

/// Routes a heartbeat reply to the adapter for `firmware_family` (as set on
/// `DiscoveredDevice.firmware_family` at discovery time). A family this
/// dispatch doesn't recognize (`None`/unknown) gets no telemetry at all —
/// there is deliberately no generic fallback parser, since guessing wrong
/// would silently produce plausible-looking garbage instead of an honest gap.
pub fn parse_heartbeat_telemetry(firmware_family: Option<&str>, raw: &[u8]) -> Option<Telemetry> {
    match firmware_family {
        Some("1.1.8") => super::telemetry_v118::parse_heartbeat_telemetry(raw),
        Some("1.1.9") => super::telemetry_v119::parse_heartbeat_telemetry(raw),
        _ => None,
    }
}
