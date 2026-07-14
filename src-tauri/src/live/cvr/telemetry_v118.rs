//! CVR firmware 1.1.8 heartbeat body -> live telemetry (voltages, currents,
//! temperatures, limiter/clip state). Ported from the reference
//! implementation's `heartbeat-parser.ts`/`heartbeat-structs.ts`, scoped to
//! the WHOLE118 family only (4-channel amps, body lengths 72/76/88/92/96) —
//! the other body-length families (2-channel, 8-channel/DA8300) are a
//! different model shape and are out of scope for this pass. Ground-truthed
//! against real 1.1.8 hardware.
//!
//! Dispatch is purely by heartbeat body byte length, not by catalog model —
//! the wire data is self-describing.
//!
//! `outputDbu` (present in the reference) is deliberately omitted here: it's
//! `20*log10(v / ratedRmsVoltage)`, and no discovered device is linked to a
//! catalog model/`AmpAssignment` yet in this phase, so no rated voltage is
//! available. A future phase that links `DiscoveredDevice` to an
//! `AmpAssignment` should add it back using `capability::cvr::rated_rms_voltage`.

use crate::data::common::now_millis;
use crate::live::dsp::voltage_to_db;

use super::protocol::{CHECKSUM_LEN, FC_HEARTBEAT};
use super::telemetry::Telemetry;

const WHOLE117: usize = 72;
const ACTIVE: usize = 76;
const WHOLE118_MINUS_INSTATES: usize = 88;
const WHOLE118: usize = 92;
const WHOLE118_PLUS: usize = 96;

/// Byte offset 20 = NetworkHeader(10) + StructHeader(10).
const BODY_START: usize = 20;

struct HeartFields {
    temperatures: Vec<f32>,
    output_voltages: Vec<f32>,
    output_currents: Vec<f32>,
    output_states: Vec<u32>,
    input_voltages: Vec<f32>,
    input_states: Vec<i32>,
    limiters: Vec<f32>,
    fan_voltage: Option<f32>,
}

fn read_floats(body: &[u8], offset: usize, count: usize) -> Vec<f32> {
    (0..count)
        .map(|i| {
            let abs = offset + i * 4;
            body.get(abs..abs + 4)
                .map(|b| f32::from_le_bytes([b[0], b[1], b[2], b[3]]))
                .unwrap_or(0.0)
        })
        .collect()
}

fn read_bytes(body: &[u8], offset: usize, count: usize) -> Vec<u32> {
    (0..count).map(|i| body.get(offset + i).copied().unwrap_or(0) as u32).collect()
}

fn read_sbytes(body: &[u8], offset: usize, count: usize) -> Vec<i32> {
    (0..count)
        .map(|i| body.get(offset + i).copied().unwrap_or(0) as i8 as i32)
        .collect()
}

/// True if every byte at `[offset, offset+count)` looks like a plausible
/// output-state enum value (0..=11) — used to disambiguate the "legacy" vs
/// "shifted" WHOLE118 layout, which share several body lengths.
fn looks_like_state_block(body: &[u8], offset: usize, count: usize) -> bool {
    if offset + count > body.len() {
        return false;
    }
    body[offset..offset + count].iter().all(|&b| b <= 11)
}

fn parse_whole118_family(body: &[u8]) -> HeartFields {
    let legacy_likely = looks_like_state_block(body, 52, 4);
    let shifted_likely = looks_like_state_block(body, 36, 4);
    let use_shifted = shifted_likely && !legacy_likely;

    if use_shifted {
        HeartFields {
            temperatures: read_floats(body, 0, 5),
            output_voltages: read_floats(body, 0, 4),
            output_currents: read_floats(body, 20, 4),
            output_states: read_bytes(body, 36, 4),
            input_voltages: read_floats(body, 40, 4),
            limiters: read_floats(body, 56, 4),
            input_states: read_sbytes(body, 72, 4),
            fan_voltage: if body.len() >= 96 { Some(read_floats(body, 92, 1)[0]) } else { None },
        }
    } else {
        HeartFields {
            temperatures: read_floats(body, 0, 5),
            output_voltages: read_floats(body, 20, 4),
            output_currents: read_floats(body, 36, 4),
            output_states: read_bytes(body, 52, 4),
            input_voltages: read_floats(body, 56, 4),
            limiters: if body.len() >= 88 { read_floats(body, 72, 4) } else { vec![0.0; 4] },
            input_states: if body.len() >= 92 { read_sbytes(body, 88, 4) } else { vec![0; 4] },
            fan_voltage: if body.len() >= 96 { Some(read_floats(body, 92, 1)[0]) } else { None },
        }
    }
}

/// `raw` = full UDP datagram: NetworkHeader(10) + StructHeader(10) + body + checksum(3).
/// Returns `None` for any body length outside the recognized WHOLE118 family
/// set — the caller treats that the same as an unsupported shape (silent
/// skip, no telemetry recorded).
pub fn parse_heartbeat_telemetry(raw: &[u8]) -> Option<Telemetry> {
    if raw.len() < BODY_START + CHECKSUM_LEN {
        return None;
    }
    if raw[10] != 0x55 {
        return None;
    }
    if raw[11] != FC_HEARTBEAT {
        return None;
    }

    let machine_mode = i16::from_le_bytes([raw[2], raw[3]]) as i32;
    let body = &raw[BODY_START..raw.len() - CHECKSUM_LEN];

    let fields = match body.len() {
        WHOLE117 | ACTIVE | WHOLE118_MINUS_INSTATES | WHOLE118 | WHOLE118_PLUS => parse_whole118_family(body),
        _ => return None,
    };

    let output_impedance = fields
        .output_voltages
        .iter()
        .zip(fields.output_currents.iter())
        .map(|(&v, &a)| if a > 0.0 { (v / a).round() } else { 0.0 })
        .collect();

    // Reference is an explicit, honest 1.0V — NOT a calibrated ADC full-scale
    // value (this device's real full-scale voltage isn't known here), so this
    // is "dB relative to 1V", not true dBFS despite the field name. See
    // `dsp::voltage_to_db`'s doc for why no reference is ever guessed.
    let input_dbfs = fields.input_voltages.iter().map(|&v| voltage_to_db(v, 1.0, 1.0)).collect();
    // Filled in by `driver.rs` once it can look up a real rated voltage from
    // the device's firmware string — this adapter only sees raw bytes.
    let output_level_db = vec![None; fields.output_voltages.len()];

    Some(Telemetry {
        temperatures: fields.temperatures,
        output_voltages: fields.output_voltages,
        output_currents: fields.output_currents,
        output_impedance,
        output_level_db,
        rated_rms_voltage: None,
        output_states: fields.output_states,
        input_voltages: fields.input_voltages,
        input_dbfs,
        limiters: fields.limiters,
        input_states: fields.input_states,
        fan_voltage: fields.fan_voltage,
        machine_mode,
        received_at: now_millis(),
    })
}
