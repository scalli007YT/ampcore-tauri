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

use super::protocol::{build_control_packet, build_control_packet_with_status};

pub const FC_VOL: u8 = 9;
pub const FC_MUTE: u8 = 10;
pub const FC_SOURCE_SELECT: u8 = 11;
pub const FC_ROUTING: u8 = 12;
pub const FC_DELAY: u8 = 14;
pub const FC_STANDBY: u8 = 15;
pub const FC_ROTARY_LOCK: u8 = 17;
pub const FC_PHASE: u8 = 18;
pub const FC_FILTER_TYPE: u8 = 30;
pub const FC_FILTER_GAIN: u8 = 31;
pub const FC_FILTER_FREQ: u8 = 32;
pub const FC_FILTER_Q: u8 = 34;
pub const FC_DZ_DY: u8 = 49;
pub const FC_BRIDGE: u8 = 50;
pub const FC_PEAK_LIMITER: u8 = 54;
pub const FC_RMS_LIMITER: u8 = 55;
pub const FC_NOISE_GATE: u8 = 69;
pub const FC_SPEAKER_NAME: u8 = 77;
pub const FC_ANALOG_MATRIX_INPUT: u8 = 79;

/// The device's per-channel name field is a fixed 16-byte null-padded ASCII
/// buffer — half the width of the 32-byte *preset* name field, so the two
/// are not interchangeable.
pub const CHANNEL_NAME_FIELD_LEN: usize = 16;

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
    build_control_packet(
        FC_VOL,
        channel_index,
        0,
        0,
        IN_OUT_FLAG_OUTPUT,
        &trim_db.to_le_bytes(),
    )
}

/// FC=9 VOL, `in_out_flag=0` — same function code as trim but the *input*
/// flag, despite this being an output-path control. Confirmed against the
/// reference's `volumeOut` action/comment: "Observed devices apply this
/// control to the output path even though the working packet shape still
/// uses in_out_flag=0."
pub fn build_set_output_volume(channel_index: u8, volume_db: f32) -> Vec<u8> {
    build_control_packet(
        FC_VOL,
        channel_index,
        0,
        0,
        IN_OUT_FLAG_INPUT,
        &volume_db.to_le_bytes(),
    )
}

/// FC=14 DELAY, `in_out_flag=0` (input). Wire body: `f32` LE ms.
pub fn build_set_delay_in(channel_index: u8, delay_ms: f32) -> Vec<u8> {
    build_control_packet(
        FC_DELAY,
        channel_index,
        0,
        0,
        IN_OUT_FLAG_INPUT,
        &delay_ms.to_le_bytes(),
    )
}

/// FC=14 DELAY, `in_out_flag=1` (output). Wire body: `f32` LE ms.
pub fn build_set_delay_out(channel_index: u8, delay_ms: f32) -> Vec<u8> {
    build_control_packet(
        FC_DELAY,
        channel_index,
        0,
        0,
        IN_OUT_FLAG_OUTPUT,
        &delay_ms.to_le_bytes(),
    )
}

/// FC=17 ROTARY_LOCK, `chx=0`, `in_out_flag=0`. Wire body: `0x01`=front-panel
/// knobs locked, `0x00`=unlocked. Function code from the vendor source's
/// `Struct_test.Gongneng` enum (17th entry, after STANDBY/RESET); body and
/// header fields from the reference web app's `setAmpLock` action. Read back
/// through FC=27's `rotary_locked`.
pub fn build_set_rotary_lock(locked: bool) -> Vec<u8> {
    let body = [u8::from(locked)];
    build_control_packet(FC_ROTARY_LOCK, 0, 0, 0, IN_OUT_FLAG_INPUT, &body)
}

/// FC=15 STANDBY, `chx=0`, `in_out_flag=0`. Wire body: `0x01`=standby,
/// `0x00`=powered on.
///
/// Note the `status_code` of **0**, which no other write in this app uses.
/// The vendor source calls the `SendStruct(..., Responsed.Response, ...)`
/// overload for this one command (`Variable\Basic.cs`), where every other
/// write goes through the `NOT_Response` (1) path; the reference web app's
/// `setAmpStandby` records the same thing from a captured frame of the
/// original software. Sending the usual `1` here is therefore untested and
/// would be a guess.
///
/// Read back through FC=27's `standby` (absolute body byte 32), which is also
/// where the "standby locked out" state comes from — see
/// `channel_config_v118.rs`.
pub fn build_set_standby(standby: bool) -> Vec<u8> {
    let body = [u8::from(standby)];
    build_control_packet_with_status(FC_STANDBY, 0, 0, 0, 0, IN_OUT_FLAG_INPUT, &body)
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
pub fn build_set_eq_filter_type(
    channel_index: u8,
    in_out_flag: u8,
    segment: u8,
    type_code: u8,
    active: bool,
) -> Vec<u8> {
    let body = [if active { type_code } else { 255 - type_code }];
    build_control_packet(
        FC_FILTER_TYPE,
        channel_index,
        segment,
        0,
        in_out_flag,
        &body,
    )
}

/// FC=32 FILTER_FREQ. Wire body: `f32` LE Hz. `segment`: 1-8 for a
/// parametric band, 0=HP/9=LP for a crossover slot.
pub fn build_set_eq_freq(channel_index: u8, in_out_flag: u8, segment: u8, freq_hz: f32) -> Vec<u8> {
    build_control_packet(
        FC_FILTER_FREQ,
        channel_index,
        segment,
        0,
        in_out_flag,
        &freq_hz.to_le_bytes(),
    )
}

/// FC=31 FILTER_GAIN. Wire body: `f32` LE dB. Parametric bands only —
/// `CrossoverSlot` has no gain to write.
pub fn build_set_eq_gain(
    channel_index: u8,
    in_out_flag: u8,
    band_index: u8,
    gain_db: f32,
) -> Vec<u8> {
    build_control_packet(
        FC_FILTER_GAIN,
        channel_index,
        band_index,
        0,
        in_out_flag,
        &gain_db.to_le_bytes(),
    )
}

/// FC=34 FILTER_Q. Wire body: `f32` LE. Parametric bands only.
pub fn build_set_eq_q(channel_index: u8, in_out_flag: u8, band_index: u8, q: f32) -> Vec<u8> {
    build_control_packet(
        FC_FILTER_Q,
        channel_index,
        band_index,
        0,
        in_out_flag,
        &q.to_le_bytes(),
    )
}

/// FC=12 ROUTING, `in_out_flag=1` (output). `chx` is the *output* channel,
/// `segment` the source position within that channel's matrix row. Wire
/// body: `[f32 LE gain_db][u8 active]`.
///
/// Both fields ride in every packet — there is no partial matrix write on
/// the wire — so callers changing only one must supply the crosspoint's
/// current value for the other (see `live_control_set_matrix_crosspoint`,
/// which merges against the last FC=27 snapshot). The reference's
/// `matrixActive` action sends a hardcoded 0 dB when toggling, which
/// silently discards a configured gain; merging avoids that.
pub fn build_set_matrix_crosspoint(
    channel_index: u8,
    source_index: u8,
    gain_db: f32,
    active: bool,
) -> Vec<u8> {
    let mut body = [0u8; 5];
    body[..4].copy_from_slice(&gain_db.to_le_bytes());
    body[4] = u8::from(active);
    build_control_packet(
        FC_ROUTING,
        channel_index,
        source_index,
        0,
        IN_OUT_FLAG_OUTPUT,
        &body,
    )
}

/// FC=69 NOISE_GATE, `in_out_flag=1` (output). Wire body on 1.1.8 is a
/// single byte and, like MUTE, is *inverted*: `0x00`=enabled, `0x01`=
/// disabled.
///
/// 1.1.8 carries no threshold on the wire — the 2-byte
/// `[enable][threshold]` form is a 1.1.9+ extension (see
/// `write_v119::build_set_noise_gate`). That matches
/// `CvrFirmwareCapability.noise_gate_threshold`, which this app already uses
/// to hide the threshold input on 1.1.8.
pub fn build_set_noise_gate(channel_index: u8, enabled: bool) -> Vec<u8> {
    let body = [if enabled { 0x00 } else { 0x01 }];
    build_control_packet(
        FC_NOISE_GATE,
        channel_index,
        0,
        0,
        IN_OUT_FLAG_OUTPUT,
        &body,
    )
}

/// FC=55 RMS_LIMITER, `in_out_flag=1` (output). Wire body (8 bytes):
/// `[u16 LE attack_ms][u8 release_multiplier][f32 LE threshold_vrms][u8 bypass]`,
/// where the trailing byte is `0x00`=enabled / `0x01`=bypassed — the same
/// inversion MUTE and NOISE_GATE use.
///
/// Note the `f32` at offset 3 is *unaligned* in the body; it is written
/// byte-wise here, exactly as the reference's `writeFloatLE(…, 3)` does.
///
/// The reference also has a one-byte fallback (FC=48 RMS_BYPASS) for when
/// only the enable flag is known. This app always holds the full stage (the
/// FC=27 snapshot parses every field), so the full-payload form is the only
/// one built — a bypass-only write would otherwise have to invent values for
/// the three parameters it does not carry.
pub fn build_set_rms_limiter(
    channel_index: u8,
    enabled: bool,
    threshold_vrms: f32,
    attack_ms: u16,
    release_multiplier: u8,
) -> Vec<u8> {
    let mut body = [0u8; 8];
    body[..2].copy_from_slice(&attack_ms.to_le_bytes());
    body[2] = release_multiplier;
    body[3..7].copy_from_slice(&threshold_vrms.to_le_bytes());
    body[7] = if enabled { 0x00 } else { 0x01 };
    build_control_packet(
        FC_RMS_LIMITER,
        channel_index,
        0,
        0,
        IN_OUT_FLAG_OUTPUT,
        &body,
    )
}

/// FC=54 PEAK_LIMITER, `in_out_flag=1` (output). Wire body (9 bytes):
/// `[u16 LE hold_ms][u16 LE release_ms][f32 LE threshold_vp][u8 bypass]`,
/// same `0x00`=enabled / `0x01`=bypassed convention as the RMS stage. Same
/// rationale as `build_set_rms_limiter` for not porting the FC=47
/// bypass-only fallback.
pub fn build_set_peak_limiter(
    channel_index: u8,
    enabled: bool,
    threshold_vp: f32,
    hold_ms: u16,
    release_ms: u16,
) -> Vec<u8> {
    let mut body = [0u8; 9];
    body[..2].copy_from_slice(&hold_ms.to_le_bytes());
    body[2..4].copy_from_slice(&release_ms.to_le_bytes());
    body[4..8].copy_from_slice(&threshold_vp.to_le_bytes());
    body[8] = if enabled { 0x00 } else { 0x01 };
    build_control_packet(
        FC_PEAK_LIMITER,
        channel_index,
        0,
        0,
        IN_OUT_FLAG_OUTPUT,
        &body,
    )
}

/// FC=77 SPEAKER_NAME. Renames one side of a channel: `in_out_flag=0`
/// renames the input, `=1` the output — the only difference between the two,
/// confirmed by the reference's Wireshark note on `renameInput`/
/// `renameOutput`. Wire body: 16-byte null-padded ASCII.
///
/// `name` is truncated on a byte boundary, so callers must reject non-ASCII
/// before calling (see `live_control_set_channel_name`) rather than risk
/// splitting a UTF-8 sequence.
pub fn build_set_channel_name(channel_index: u8, in_out_flag: u8, name: &str) -> Vec<u8> {
    let mut body = [0u8; CHANNEL_NAME_FIELD_LEN];
    let bytes = name.as_bytes();
    let len = bytes.len().min(CHANNEL_NAME_FIELD_LEN);
    body[..len].copy_from_slice(&bytes[..len]);
    build_control_packet(FC_SPEAKER_NAME, channel_index, 0, 0, in_out_flag, &body)
}

/// FC=11 SOURCE_SELECT, `in_out_flag=0` (input). Wire body: one byte,
/// `0`=Analog, `1`=Dante, `2`=AES3 — the same code space
/// `channel_config_v118::source` decodes on the read side, so the two stay
/// in agreement by construction.
pub fn build_set_source_select(channel_index: u8, source_code: u8) -> Vec<u8> {
    build_control_packet(
        FC_SOURCE_SELECT,
        channel_index,
        0,
        0,
        IN_OUT_FLAG_INPUT,
        &[source_code],
    )
}

/// FC=79 ANALOG_MATRIX_INPUT, `in_out_flag=0`. Wire body: one byte, the
/// 0-based physical analog input that feeds `channel_index`. Matches the
/// vendor's `AnalogType` send (`SendStruct(Analog_Matrix_input, ch, b)`, a
/// header with no flag/segment/link) and the reference's `analogType` action.
/// Read back from the FC=27 trailer's analog-matrix bytes (`trailer+136+ch`).
pub fn build_set_analog_input(channel_index: u8, analog_input_index: u8) -> Vec<u8> {
    build_control_packet(
        FC_ANALOG_MATRIX_INPUT,
        channel_index,
        0,
        0,
        IN_OUT_FLAG_INPUT,
        &[analog_input_index],
    )
}

/// FC=50 BRIDGE, `in_out_flag=0`. Wire body is inverted like MUTE:
/// `0x00`=bridged, `0x01`=independent.
///
/// `chx` is the **pair index** (0 = outputs A/B, 1 = C/D), *not* the pair's
/// leader channel index. The two coincide for pair 0 and diverge for every
/// pair after it, which is exactly how the original bug presented: bridging
/// A/B worked and C/D silently did nothing, because it sent `chx=2` for a
/// device that only recognises 0 and 1.
///
/// Same addressing as the read side — `parse_bridge_reply` takes the pair
/// straight out of the reply's `chx`, and the driver's poll queries `chx=0`
/// and `chx=1` — so read and write now agree by construction. The reference
/// implementation does the same (`sendSingle(..., "bridgePair", pair, ...)`
/// passes a pair, never a channel).
pub fn build_set_output_bridge(pair_index: u8, bridged: bool) -> Vec<u8> {
    let body = [if bridged { 0x00 } else { 0x01 }];
    build_control_packet(FC_BRIDGE, pair_index, 0, 0, IN_OUT_FLAG_INPUT, &body)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Pins the FC=15 frame, above all its `status_code` of 0 — the one field
    /// that makes this command different from every other write here, and the
    /// one a future "why is standby not using `build_control_packet` like
    /// everything else?" cleanup would quietly normalize away.
    ///
    /// The bytes come from this module's own already-ground-truthed header and
    /// checksum builders, so this is a regression lock on the encoding, not
    /// independent proof of what the hardware wants — that part is verified
    /// against a real amp.
    #[test]
    fn standby_frame_uses_status_code_zero() {
        let packet = build_set_standby(true);
        assert_eq!(
            packet,
            vec![
                // NetworkData: flag 0xd903 little-endian (so 0x03 first),
                // machine_mode=0, count=1, frame_len=14, step=1, state=0, pad
                0x03, 0xd9, 0x00, 0x00, 0x01, 0x0e, 0x00, 0x01, 0x00, 0x00,
                // StructHeader: 0x55, FC=15, status=0, chx=0, seg=0, link=0, in_out=0
                0x55, 0x0f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
                // Standby_data = 1
                0x01,
                // checksum: hi, lo, sum
                0x00, 0x0e, 0x73,
            ]
        );
        // Only the body byte differs between standby and powered-on.
        let on = build_set_standby(false);
        assert_eq!(on[20], 0x00);
        assert_eq!(on[12], 0x00, "status_code stays 0 in both directions");
    }
}
