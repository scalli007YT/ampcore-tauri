//! Write/control command dispatch — the write-side counterpart to
//! `channel_config.rs`/`telemetry.rs`: one dispatch point per logical action
//! that routes to a firmware-specific encoder (`write_v118.rs`,
//! `write_v119.rs`) based on `DiscoveredDevice.firmware_family`, rather than
//! hardcoding one firmware's function codes/body layout directly in a Tauri
//! command.
//!
//! Unlike the FC=27 read path, writes are fire-and-forget: the reference
//! implementation this was ported from sends a control packet from an
//! ephemeral UDP socket and does not wait for or correlate a response — the
//! device's own state, once changed, shows up on the next FC=27 poll
//! (already running, see `driver.rs`) and flows to the frontend via the
//! existing `live_channel_config:updated` event. No use of `request.rs`'s
//! request/response engine is needed here.

use std::net::Ipv4Addr;

use tokio::net::UdpSocket;

use crate::data::capability::PowerMode;

use super::protocol::{AMP_PORT, CHECKSUM_LEN, NETWORK_HEADER_LEN, STRUCT_HEADER_LEN};

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

/// Sends a single pre-built control packet to `ip:AMP_PORT` from a fresh
/// ephemeral socket, mirroring the reference implementation's `sendControl`:
/// fire-and-forget, no ACK/response awaited.
pub async fn send_control(ip: Ipv4Addr, packet: &[u8]) -> std::io::Result<()> {
    log_write(ip, packet);
    let socket = UdpSocket::bind(("0.0.0.0", 0)).await?;
    socket.send_to(packet, (ip, AMP_PORT)).await?;
    Ok(())
}
