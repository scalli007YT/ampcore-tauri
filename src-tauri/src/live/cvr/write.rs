//! Write/control command dispatch — the write-side counterpart to
//! `channel_config.rs`/`telemetry.rs`: one dispatch point per logical action
//! that routes to a firmware-specific encoder (`write_v118.rs`,
//! `write_v119.rs`) based on `DiscoveredDevice.firmware_family`, rather than
//! hardcoding one firmware's function codes/body layout directly in a Tauri
//! command.
//!
//! Writes are delivery-confirmed, but not *value*-confirmed. `send_control`
//! submits through the driver's socket and resolves only once the device has
//! echoed the packet's NetworkData header back with `data_state = 1`,
//! refiring up to `WRITE_MAX_REFIRES` times first (see `request.rs`'s
//! `WriteRegistry`, and the vendor reference's `UDP.send`/`outTime` loop it
//! mirrors). What that ACK proves is that the datagram arrived — nothing
//! about whether the parameter took the requested value. The resulting state
//! is still observed the same way it always was: via the next FC=27 poll
//! (already running, see `driver.rs`) reaching the frontend through the
//! existing `live_channel_config:updated` event, with no optimistic update.
//!
//! This is a *transport* ACK and so has nothing to do with `request.rs`'s
//! function-code request/response engine, which the read path uses — the two
//! registries are independent and run side by side in the driver loop.

use std::net::Ipv4Addr;

use tokio::sync::{mpsc, oneshot};

use crate::data::capability::PowerMode;

use super::protocol::{wire_log_enabled, CHECKSUM_LEN, NETWORK_HEADER_LEN, STRUCT_HEADER_LEN};
use super::request::{write_max_attempts, WriteError, WriteOutcome, WriteSpec};

/// Routes a "set output mute" request to the adapter for `firmware_family`.
/// A family this dispatch doesn't recognize (`None`/unknown) builds no
/// packet at all — no generic fallback encoding, since guessing wrong would
/// silently send bytes the device might misinterpret instead of an honest
/// error (see `commands/live_control.rs`).
pub fn build_set_output_mute(firmware_family: Option<&str>, channel_index: u8, muted: bool) -> Option<Vec<u8>> {
    match firmware_family {
        Some("1.1.8") => Some(super::write_v118::build_set_output_mute(channel_index, muted)),
        Some("1.1.9") => Some(super::write_v119::build_set_output_mute(channel_index, muted)),
        _ => None,
    }
}

pub fn build_set_input_mute(firmware_family: Option<&str>, channel_index: u8, muted: bool) -> Option<Vec<u8>> {
    match firmware_family {
        Some("1.1.8") => Some(super::write_v118::build_set_input_mute(channel_index, muted)),
        Some("1.1.9") => Some(super::write_v119::build_set_input_mute(channel_index, muted)),
        _ => None,
    }
}

pub fn build_set_output_trim(firmware_family: Option<&str>, channel_index: u8, trim_db: f32) -> Option<Vec<u8>> {
    match firmware_family {
        Some("1.1.8") => Some(super::write_v118::build_set_output_trim(channel_index, trim_db)),
        Some("1.1.9") => Some(super::write_v119::build_set_output_trim(channel_index, trim_db)),
        _ => None,
    }
}

pub fn build_set_output_volume(firmware_family: Option<&str>, channel_index: u8, volume_db: f32) -> Option<Vec<u8>> {
    match firmware_family {
        Some("1.1.8") => Some(super::write_v118::build_set_output_volume(channel_index, volume_db)),
        Some("1.1.9") => Some(super::write_v119::build_set_output_volume(channel_index, volume_db)),
        _ => None,
    }
}

pub fn build_set_delay_in(firmware_family: Option<&str>, channel_index: u8, delay_ms: f32) -> Option<Vec<u8>> {
    match firmware_family {
        Some("1.1.8") => Some(super::write_v118::build_set_delay_in(channel_index, delay_ms)),
        Some("1.1.9") => Some(super::write_v119::build_set_delay_in(channel_index, delay_ms)),
        _ => None,
    }
}

pub fn build_set_delay_out(firmware_family: Option<&str>, channel_index: u8, delay_ms: f32) -> Option<Vec<u8>> {
    match firmware_family {
        Some("1.1.8") => Some(super::write_v118::build_set_delay_out(channel_index, delay_ms)),
        Some("1.1.9") => Some(super::write_v119::build_set_delay_out(channel_index, delay_ms)),
        _ => None,
    }
}

pub fn build_set_phase_invert(firmware_family: Option<&str>, channel_index: u8, inverted: bool) -> Option<Vec<u8>> {
    match firmware_family {
        Some("1.1.8") => Some(super::write_v118::build_set_phase_invert(channel_index, inverted)),
        Some("1.1.9") => Some(super::write_v119::build_set_phase_invert(channel_index, inverted)),
        _ => None,
    }
}

pub fn build_set_power_mode(firmware_family: Option<&str>, channel_index: u8, mode: PowerMode) -> Option<Vec<u8>> {
    match firmware_family {
        Some("1.1.8") => Some(super::write_v118::build_set_power_mode(channel_index, mode)),
        Some("1.1.9") => Some(super::write_v119::build_set_power_mode(channel_index, mode)),
        _ => None,
    }
}

pub fn build_set_eq_filter_type(
    firmware_family: Option<&str>,
    channel_index: u8,
    in_out_flag: u8,
    segment: u8,
    type_code: u8,
    active: bool,
) -> Option<Vec<u8>> {
    match firmware_family {
        Some("1.1.8") => Some(super::write_v118::build_set_eq_filter_type(channel_index, in_out_flag, segment, type_code, active)),
        Some("1.1.9") => Some(super::write_v119::build_set_eq_filter_type(channel_index, in_out_flag, segment, type_code, active)),
        _ => None,
    }
}

pub fn build_set_eq_freq(
    firmware_family: Option<&str>,
    channel_index: u8,
    in_out_flag: u8,
    segment: u8,
    freq_hz: f32,
) -> Option<Vec<u8>> {
    match firmware_family {
        Some("1.1.8") => Some(super::write_v118::build_set_eq_freq(channel_index, in_out_flag, segment, freq_hz)),
        Some("1.1.9") => Some(super::write_v119::build_set_eq_freq(channel_index, in_out_flag, segment, freq_hz)),
        _ => None,
    }
}

pub fn build_set_eq_gain(
    firmware_family: Option<&str>,
    channel_index: u8,
    in_out_flag: u8,
    band_index: u8,
    gain_db: f32,
) -> Option<Vec<u8>> {
    match firmware_family {
        Some("1.1.8") => Some(super::write_v118::build_set_eq_gain(channel_index, in_out_flag, band_index, gain_db)),
        Some("1.1.9") => Some(super::write_v119::build_set_eq_gain(channel_index, in_out_flag, band_index, gain_db)),
        _ => None,
    }
}

pub fn build_set_eq_q(
    firmware_family: Option<&str>,
    channel_index: u8,
    in_out_flag: u8,
    band_index: u8,
    q: f32,
) -> Option<Vec<u8>> {
    match firmware_family {
        Some("1.1.8") => Some(super::write_v118::build_set_eq_q(channel_index, in_out_flag, band_index, q)),
        Some("1.1.9") => Some(super::write_v119::build_set_eq_q(channel_index, in_out_flag, band_index, q)),
        _ => None,
    }
}

/// Fixed 10-byte follow-up packet the device expects after any crossover
/// (HP/LP) FILTER_TYPE/FILTER_FREQ write before the change takes effect —
/// reverse-engineered by the reference implementation (`amp-device.ts`'s
/// `CROSSOVER_COMMIT_PACKET`) from real packet captures and the vendor C#
/// source; not something `build_control_packet` can construct (it isn't a
/// standard struct-header + body frame), so it's sent verbatim. Unlike every
/// other write in this module, the reference does not gate this by firmware
/// family, so it's sent as-is regardless of `firmware_family` here too.
///
/// Decoded as a `NetworkDataHeader` it is not a control frame at all — it is
/// an *ACK*: `data_flag = 0xD903`, `machine_mode = 404`, `packets_count = 1`,
/// `packets_lastlen = 92`, `packets_step = 1`, `data_state = 1`. In other
/// words the capture this was lifted from recorded the PC acknowledging a
/// 92-byte frame, and replaying those exact bytes is what the device treats
/// as the commit. That is why `send_control` sends it with
/// `expect_ack = false`: a device never ACKs an ACK, so waiting on one would
/// time out every time.
pub const CROSSOVER_COMMIT_PACKET: [u8; 10] = [0x03, 0xd9, 0x94, 0x01, 0x01, 0x5c, 0x00, 0x01, 0x01, 0x5a];

fn hex_dump(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect::<Vec<_>>().join(" ")
}

/// Logs one outgoing write with the same `[cvr driver]` prefix/console the
/// read path (`driver.rs`) already uses, so a write shows up alongside the
/// FC=27/heartbeat traffic it's meant to influence, not silently. Decodes
/// FC/chx/segment/in_out_flag/body when `packet` has the shape
/// `build_control_packet` produces (NetworkHeader+StructHeader+body+
/// checksum); falls back to a plain length+hex dump for anything else — the
/// one exception today being `CROSSOVER_COMMIT_PACKET`, a fixed raw packet
/// with no StructHeader at all.
fn log_write(ip: Ipv4Addr, packet: &[u8]) {
    if !wire_log_enabled() {
        return;
    }
    let header_len = NETWORK_HEADER_LEN + STRUCT_HEADER_LEN;
    if packet.len() >= header_len + CHECKSUM_LEN {
        let function_code = packet[NETWORK_HEADER_LEN + 1];
        let chx = packet[NETWORK_HEADER_LEN + 3];
        let segment = packet[NETWORK_HEADER_LEN + 4];
        let in_out_flag = packet[NETWORK_HEADER_LEN + 9];
        let body = &packet[header_len..packet.len() - CHECKSUM_LEN];
        println!(
            "[cvr driver] write to {ip}: FC={function_code} chx={chx} segment={segment} in_out_flag={in_out_flag} body=[{}] ({} bytes)",
            hex_dump(body),
            packet.len()
        );
    } else {
        println!("[cvr driver] write to {ip}: {} raw bytes [{}]", packet.len(), hex_dump(packet));
    }
}

/// True for a packet that is itself an ACK (`data_state = 1` at byte 8 of the
/// NetworkData header) — today only `CROSSOVER_COMMIT_PACKET`, which is a
/// replayed ACK rather than a control frame. Neither side ACKs an ACK, so
/// waiting for confirmation of one would always time out.
fn is_ack_packet(packet: &[u8]) -> bool {
    packet.len() >= NETWORK_HEADER_LEN && packet[8] != 0
}

/// Submits a pre-built control packet to the running driver and awaits the
/// device's transport-level ACK for it (see `request.rs`'s `WriteRegistry`):
/// resolves `Ok` only once the device has echoed the packet's NetworkData
/// header back, or `Err` once the initial send and all `WRITE_MAX_REFIRES`
/// refires have gone unacknowledged.
///
/// This deliberately does *not* send from its own ephemeral socket the way
/// the vendor reference's `sendControl` port did. The ACK returns either to
/// the datagram's source port or to a fixed 45454 depending on firmware —
/// sending from the driver's socket, which is bound to 45454, satisfies both
/// readings, whereas an ephemeral socket is closed before the ACK lands under
/// the first and is simply not listening under the second.
///
/// The device applying the write is still observed separately, via the next
/// FC=27 poll and the existing `live_channel_config:updated` event — an ACK
/// confirms delivery, not that the parameter took the requested value.
pub async fn send_control(
    write_tx: &mpsc::UnboundedSender<WriteSpec>,
    ip: Ipv4Addr,
    packet: &[u8],
) -> Result<WriteOutcome, WriteError> {
    log_write(ip, packet);
    let (tx, rx) = oneshot::channel();
    let spec = WriteSpec {
        ip: ip.to_string(),
        packet: packet.to_vec(),
        expect_ack: !is_ack_packet(packet),
        tx,
    };
    write_tx.send(spec).map_err(|_| WriteError::DriverStopped)?;
    let result = rx.await.map_err(|_| WriteError::DriverStopped)?;
    // Success lines are gated behind `AMPCORE_WIRE_LOG` (see
    // `protocol::wire_log_enabled`) because stdout from inside the driver loop
    // is what stalls ACK correlation in the first place. When enabled, the
    // attempt count is the point: `1/6` is a clean link, anything higher is
    // packet loss the refires papered over and that would otherwise be
    // invisible. Failures always log, unconditionally: a device whose firmware
    // does not ACK writes at all shows up as a FAILED line on *every* write —
    // the signal to look at `WriteSpec::expect_ack`, the single lever that
    // turns confirmation off (the vendor reference's `IsNoACK10` escape hatch).
    match &result {
        Ok(outcome) if wire_log_enabled() => {
            if outcome.attempts == 0 {
                println!("[cvr driver] write to {ip} coalesced into a newer write for the same parameter");
            } else {
                println!(
                    "[cvr driver] write to {ip} ACKed on attempt {}/{} ({}ms)",
                    outcome.attempts,
                    write_max_attempts(),
                    outcome.elapsed_ms
                );
            }
        }
        Ok(_) => {}
        Err(e) => eprintln!("[cvr driver] write to {ip} FAILED: {e}"),
    }
    result
}
