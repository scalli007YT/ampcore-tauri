//! CVR firmware 1.1.8 write/control command encoding.
//!
//! Ported from a prior web-based implementation of this same CVR controller
//! (`cvr-amp-controller-web`'s `lib/amp-device.ts` `FuncCode` table and
//! `app/api/amp-actions/route.ts`), itself confirmed against real 1.1.8
//! hardware and the original vendor C# source. Only the actions this app
//! currently exposes a Tauri command for are ported here — the reference has
//! many more (EQ bands, crossover, limiter, matrix gain, renaming, etc.),
//! to be added mechanically as each gets its own command.

use crate::data::capability::PowerMode;

use super::protocol::build_control_packet;

pub const FC_VOL: u8 = 9;
pub const FC_MUTE: u8 = 10;
pub const FC_DELAY: u8 = 14;
pub const FC_PHASE: u8 = 18;
pub const FC_FILTER_TYPE: u8 = 30;
pub const FC_FILTER_GAIN: u8 = 31;
pub const FC_FILTER_FREQ: u8 = 32;
pub const FC_FILTER_Q: u8 = 34;
pub const FC_DZ_DY: u8 = 49;

const IN_OUT_FLAG_INPUT: u8 = 0;
const IN_OUT_FLAG_OUTPUT: u8 = 1;

/// FC=10 MUTE, `in_out_flag=1` (output). Wire body: `0x00`=muted,
/// `0x01`=unmuted — inverted relative to the boolean, confirmed against the
/// reference's `muteOut` action.
pub fn build_set_output_mute(channel_index: u8, muted: bool) -> Vec<u8> {
    let body = [if muted { 0x00 } else { 0x01 }];
    build_control_packet(FC_MUTE, channel_index, 0, 0, IN_OUT_FLAG_OUTPUT, &body)
}

/// FC=10 MUTE, `in_out_flag=0` (input) — same body convention as output mute.
pub fn build_set_input_mute(channel_index: u8, muted: bool) -> Vec<u8> {
    let body = [if muted { 0x00 } else { 0x01 }];
    build_control_packet(FC_MUTE, channel_index, 0, 0, IN_OUT_FLAG_INPUT, &body)
}

/// FC=9 VOL, `in_out_flag=1` (output). Wire body: `f32` LE dB. Confirmed
/// against the reference's `outputTrim` action.
pub fn build_set_output_trim(channel_index: u8, trim_db: f32) -> Vec<u8> {
    build_control_packet(FC_VOL, channel_index, 0, 0, IN_OUT_FLAG_OUTPUT, &trim_db.to_le_bytes())
}

/// FC=9 VOL, `in_out_flag=0` — same function code as trim but the *input*
/// flag, despite this being an output-path control. Confirmed against the
/// reference's `volumeOut` action/comment: "Observed devices apply this
/// control to the output path even though the working packet shape still
/// uses in_out_flag=0."
pub fn build_set_output_volume(channel_index: u8, volume_db: f32) -> Vec<u8> {
    build_control_packet(FC_VOL, channel_index, 0, 0, IN_OUT_FLAG_INPUT, &volume_db.to_le_bytes())
}

/// FC=14 DELAY, `in_out_flag=0` (input). Wire body: `f32` LE ms.
pub fn build_set_delay_in(channel_index: u8, delay_ms: f32) -> Vec<u8> {
    build_control_packet(FC_DELAY, channel_index, 0, 0, IN_OUT_FLAG_INPUT, &delay_ms.to_le_bytes())
}

/// FC=14 DELAY, `in_out_flag=1` (output). Wire body: `f32` LE ms.
pub fn build_set_delay_out(channel_index: u8, delay_ms: f32) -> Vec<u8> {
    build_control_packet(FC_DELAY, channel_index, 0, 0, IN_OUT_FLAG_OUTPUT, &delay_ms.to_le_bytes())
}

/// FC=18 PHASE, `in_out_flag=1` (output). Wire body: `0x01`=inverted,
/// `0x00`=normal.
pub fn build_set_phase_invert(channel_index: u8, inverted: bool) -> Vec<u8> {
    let body = [if inverted { 0x01 } else { 0x00 }];
    build_control_packet(FC_PHASE, channel_index, 0, 0, IN_OUT_FLAG_OUTPUT, &body)
}

/// FC=49 DZ_DY, `in_out_flag=1` (output). Wire body: `0`=Low-Ohm, `1`=70V,
/// `2`=100V.
pub fn build_set_power_mode(channel_index: u8, mode: PowerMode) -> Vec<u8> {
    let code: u8 = match mode {
        PowerMode::LowOhm => 0,
        PowerMode::V70 => 1,
        PowerMode::V100 => 2,
    };
    build_control_packet(FC_DZ_DY, channel_index, 0, 0, IN_OUT_FLAG_OUTPUT, &[code])
}

/// FC=30 FILTER_TYPE. Body: the wire type code as-is when `active`,
/// `255 - type_code` when not — the same "enabled=type, bypassed=255-type"
/// convention this app's own read-side parsing already relies on
/// (`channel_config_v118.rs`). Used for both parametric bands (`segment`
/// 1-8) and HP/LP crossover slots (`segment` 0=HP / 9=LP) — the wire
/// encoding is identical, only `segment` (and, for a crossover slot, the
/// follow-up `CROSSOVER_COMMIT_PACKET`) differs. `type_code` is resolved by
/// the caller via `channel_config_v118::eq_filter_type_code`/
/// `crossover_filter_type_code` — kept as a plain `u8` here rather than
/// generic over which of the two disjoint filter-type enums applies.
pub fn build_set_eq_filter_type(channel_index: u8, in_out_flag: u8, segment: u8, type_code: u8, active: bool) -> Vec<u8> {
    let body = [if active { type_code } else { 255 - type_code }];
    build_control_packet(FC_FILTER_TYPE, channel_index, segment, 0, in_out_flag, &body)
}

/// FC=32 FILTER_FREQ. Wire body: `f32` LE Hz. `segment`: 1-8 for a
/// parametric band, 0=HP/9=LP for a crossover slot.
pub fn build_set_eq_freq(channel_index: u8, in_out_flag: u8, segment: u8, freq_hz: f32) -> Vec<u8> {
    build_control_packet(FC_FILTER_FREQ, channel_index, segment, 0, in_out_flag, &freq_hz.to_le_bytes())
}

/// FC=31 FILTER_GAIN. Wire body: `f32` LE dB. Parametric bands only —
/// `CrossoverSlot` has no gain to write.
pub fn build_set_eq_gain(channel_index: u8, in_out_flag: u8, band_index: u8, gain_db: f32) -> Vec<u8> {
    build_control_packet(FC_FILTER_GAIN, channel_index, band_index, 0, in_out_flag, &gain_db.to_le_bytes())
}

/// FC=34 FILTER_Q. Wire body: `f32` LE. Parametric bands only.
pub fn build_set_eq_q(channel_index: u8, in_out_flag: u8, band_index: u8, q: f32) -> Vec<u8> {
    build_control_packet(FC_FILTER_Q, channel_index, band_index, 0, in_out_flag, &q.to_le_bytes())
}
