//! CVR Pro Audio UDP control protocol, ground-truthed against a working
//! reverse-engineered reference implementation (firmware v1.1.8 only).
//! Discovery (FC=0 BASIC_INFO), heartbeat (FC=6), and multi-fragment
//! request/response (see `request.rs`, used by FC=27 SYNC_DATA) are covered;
//! per-parameter write commands remain out of scope for this pass.
//!
//! Firmware 1.1.9 is known to differ from 1.1.8 in byte offsets *and*
//! function codes for at least some commands, but no 1.1.9 reference/spec
//! exists yet — `detect_firmware_family` below only identifies which family
//! a device is running (for display), it does not branch parsing behavior.
//! BASIC_INFO parsing already handles multiple body-length variants
//! generically and has been verified against real 1.1.8 hardware; whether it
//! also holds unmodified for 1.1.9 remains unconfirmed.

use std::net::Ipv4Addr;

use serde::Serialize;
use specta::Type;

pub const PC_LISTEN_PORT: u16 = 45454;
pub const AMP_PORT: u16 = 45455;

pub const NETWORK_DATA_FLAG: u16 = 0xD903;
pub const NETWORK_HEADER_LEN: usize = 10;
pub const STRUCT_HEADER_LEN: usize = 10;
pub const CHECKSUM_LEN: usize = 3;

pub const FC_BASIC_INFO: u8 = 0;
pub const FC_HEARTBEAT: u8 = 6;
/// SYNC_DATA — bulk per-channel DSP config readback (see
/// `channel_config.rs`). One request (empty body, built generically by
/// `RequestRegistry::register` — see `request.rs`) returns every channel's
/// config in one response; there is no per-channel request variant, the
/// wire protocol doesn't support asking for just one.
pub const FC_SYNC_DATA: u8 = 27;

/// Body-bytes-per-datagram unit for multi-fragment requests/responses —
/// matches the reference implementation's chunk size exactly (required for
/// interop: this is a wire-format constant, not a tunable).
pub const FRAGMENT_SIZE: usize = 450;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum CvrFirmwareFamily {
    V118,
    V119,
    Unknown,
}

/// Firmware family is embedded as a "118"/"119" substring somewhere in the
/// BASIC_INFO version string (e.g. "42404B06-006118-DSP-2004" -> V118) —
/// confirmed against real hardware, not a fixed-offset field.
pub fn detect_firmware_family(version_string: &str) -> CvrFirmwareFamily {
    if version_string.contains("119") {
        CvrFirmwareFamily::V119
    } else if version_string.contains("118") {
        CvrFirmwareFamily::V118
    } else {
        CvrFirmwareFamily::Unknown
    }
}

/// Only `data_flag`/`data_state` are read this pass; the rest document the
/// full wire format for the fragmentation/reassembly work deferred to a
/// future phase (see module doc).
#[allow(dead_code)]
#[derive(Debug, Clone, Copy)]
pub struct NetworkDataHeader {
    pub data_flag: u16,
    pub machine_mode: i16,
    pub packets_count: u8,
    pub packets_lastlen: u16,
    pub packets_step: u8,
    pub data_state: u8, // 0 = data, 1 = ACK
    pub padding: u8,
}

pub fn parse_network_data_header(raw: &[u8]) -> Option<NetworkDataHeader> {
    if raw.len() < NETWORK_HEADER_LEN {
        return None;
    }
    Some(NetworkDataHeader {
        data_flag: u16::from_le_bytes([raw[0], raw[1]]),
        machine_mode: i16::from_le_bytes([raw[2], raw[3]]),
        packets_count: raw[4],
        packets_lastlen: u16::from_le_bytes([raw[5], raw[6]]),
        packets_step: raw[7],
        data_state: raw[8],
        padding: raw[9],
    })
}

pub fn build_network_data_header(
    frame_len: u16,
    machine_mode: i16,
    data_state: u8,
    packets_count: u8,
    packets_step: u8,
) -> [u8; NETWORK_HEADER_LEN] {
    let mut buf = [0u8; NETWORK_HEADER_LEN];
    buf[0..2].copy_from_slice(&NETWORK_DATA_FLAG.to_le_bytes());
    buf[2..4].copy_from_slice(&machine_mode.to_le_bytes());
    buf[4] = packets_count;
    buf[5..7].copy_from_slice(&frame_len.to_le_bytes());
    buf[7] = packets_step;
    buf[8] = data_state;
    buf[9] = 0;
    buf
}

/// byte0=0x55 sentinel, byte1=FC, byte2=status(0=response,1=write,2=request,3=fire-and-forget),
/// byte3=chx, byte4=segment, bytes5-8=link (i32 LE), byte9=inOutFlag(0=in,1=out).
pub fn build_struct_header(
    function_code: u8,
    status_code: u8,
    chx: u8,
    segment: u8,
    link: i32,
    in_out_flag: u8,
) -> [u8; STRUCT_HEADER_LEN] {
    let mut buf = [0u8; STRUCT_HEADER_LEN];
    buf[0] = 0x55;
    buf[1] = function_code;
    buf[2] = status_code;
    buf[3] = chx;
    buf[4] = segment;
    buf[5..9].copy_from_slice(&link.to_le_bytes());
    buf[9] = in_out_flag;
    buf
}

/// hi/lo = length prefix of (inner_frame.len()+3); sum = hi+lo+Σbytes.
pub fn calc_check_code(inner_frame: &[u8]) -> [u8; CHECKSUM_LEN] {
    let num = inner_frame.len() as u32 + CHECKSUM_LEN as u32;
    let hi = ((num >> 8) & 0xff) as u8;
    let lo = (num & 0xff) as u8;
    let mut sum: u32 = hi as u32 + lo as u32;
    for &b in inner_frame {
        sum += b as u32;
    }
    [hi, lo, (sum & 0xff) as u8]
}

/// Full packet = NetworkHeader(10) + StructHeader(10) + body + Checksum(3).
pub fn build_protocol_packet(function_code: u8, status_code: u8, chx: u8, body: &[u8]) -> Vec<u8> {
    let struct_header = build_struct_header(function_code, status_code, chx, 0, 0, 0);
    let mut inner = Vec::with_capacity(STRUCT_HEADER_LEN + body.len());
    inner.extend_from_slice(&struct_header);
    inner.extend_from_slice(body);
    let checksum = calc_check_code(&inner);
    inner.extend_from_slice(&checksum);
    let network_header = build_network_data_header(inner.len() as u16, 0, 0, 1, 1);
    let mut packet = Vec::with_capacity(NETWORK_HEADER_LEN + inner.len());
    packet.extend_from_slice(&network_header);
    packet.extend_from_slice(&inner);
    packet
}

pub fn build_basic_info_query() -> Vec<u8> {
    build_protocol_packet(FC_BASIC_INFO, 2, 0, &[])
}

pub fn build_heartbeat_query() -> Vec<u8> {
    build_protocol_packet(FC_HEARTBEAT, 2, 0, &[])
}

/// Splits a large protocol frame across multiple datagrams when its inner
/// frame (StructHeader + body + checksum) exceeds `FRAGMENT_SIZE`. For
/// bodies that fit in one datagram, delegates to `build_protocol_packet` and
/// returns a single-element `Vec` — the existing single-fragment path stays
/// byte-for-byte unchanged for every function code in use today.
///
/// The multi-fragment path mirrors the reference implementation's `sendFC`
/// exactly: 1-based `packets_step`, and every fragment's NetworkData header
/// carries the *last* fragment's length (not its own) in the
/// `packets_lastlen` field — matching that specific asymmetry is required
/// for compatibility with real firmware, the same way `validate_frame`
/// already has to match an intentional checksum asymmetry.
///
/// Built for a future large write (e.g. FC=57 speaker data) — no function
/// code in use today sends a body anywhere near this size, so this path is
/// unexercised against real hardware until one does.
pub fn build_protocol_packets(function_code: u8, status_code: u8, chx: u8, body: &[u8]) -> Vec<Vec<u8>> {
    let struct_header = build_struct_header(function_code, status_code, chx, 0, 0, 0);
    let mut inner = Vec::with_capacity(STRUCT_HEADER_LEN + body.len());
    inner.extend_from_slice(&struct_header);
    inner.extend_from_slice(body);
    let checksum = calc_check_code(&inner);
    inner.extend_from_slice(&checksum);

    if inner.len() <= FRAGMENT_SIZE {
        let network_header = build_network_data_header(inner.len() as u16, 0, 0, 1, 1);
        let mut packet = Vec::with_capacity(NETWORK_HEADER_LEN + inner.len());
        packet.extend_from_slice(&network_header);
        packet.extend_from_slice(&inner);
        return vec![packet];
    }

    // Wire format's packets_count field is a u8, so ~114KB (255 * 450B) is
    // the hard ceiling — unreachable by anything this app sends today.
    let packets_count = ((inner.len() + FRAGMENT_SIZE - 1) / FRAGMENT_SIZE) as u8;
    let last_len = if inner.len() % FRAGMENT_SIZE == 0 { FRAGMENT_SIZE } else { inner.len() % FRAGMENT_SIZE };

    (1..=packets_count)
        .map(|step| {
            let chunk_start = (step as usize - 1) * FRAGMENT_SIZE;
            let chunk_len = if step == packets_count { last_len } else { FRAGMENT_SIZE };
            let chunk = &inner[chunk_start..chunk_start + chunk_len];
            let network_header = build_network_data_header(last_len as u16, 0, 0, packets_count, step);
            let mut packet = Vec::with_capacity(NETWORK_HEADER_LEN + chunk.len());
            packet.extend_from_slice(&network_header);
            packet.extend_from_slice(chunk);
            packet
        })
        .collect()
}

/// Every received data packet (dataState=0) gets ACK'd by echoing its
/// NetworkData header with dataState flipped to 1 — no body, stateless.
pub fn build_ack_packet(raw_packet: &[u8]) -> Option<[u8; NETWORK_HEADER_LEN]> {
    if raw_packet.len() < NETWORK_HEADER_LEN {
        return None;
    }
    let mut ack = [0u8; NETWORK_HEADER_LEN];
    ack.copy_from_slice(&raw_packet[..NETWORK_HEADER_LEN]);
    ack[8] = 1;
    Some(ack)
}

/// Mirrors the reference `validateAssembledFrame`: only the low two checksum
/// bytes (lo, sum) are compared, not the length-prefix `hi` byte — matching
/// that asymmetry exactly is required for compatibility with real firmware.
pub fn validate_frame(assembled: &[u8]) -> bool {
    if assembled.len() < STRUCT_HEADER_LEN + CHECKSUM_LEN {
        return false;
    }
    if assembled[0] != 0x55 {
        return false;
    }
    let inner = &assembled[..assembled.len() - CHECKSUM_LEN];
    let expected = calc_check_code(inner);
    expected[1] == assembled[assembled.len() - 2] && expected[2] == assembled[assembled.len() - 1]
}

#[derive(Debug, Clone)]
pub struct BasicInfoReply {
    pub mac: String,
    pub name: String,
    pub firmware_version: String,
    pub gain_max: u8,
    pub analog_input_channels: u8,
    pub digital_input_channels: u8,
    pub output_channels: u8,
    pub machine_state: u8,
}

/// `raw` = full UDP datagram: NetworkHeader(10) + StructHeader(10) + body + checksum(3).
/// Body variants seen in the original software: 75B base, 79B (base+4B
/// vendor/meta extension), 83B (32-byte name field variant), 87B (83B
/// variant + 4B extension) — all handled here.
pub fn parse_basic_info_reply(raw: &[u8]) -> Option<BasicInfoReply> {
    if raw.len() < 98 {
        return None;
    }
    if raw[10] != 0x55 {
        return None;
    }
    if raw[11] != FC_BASIC_INFO {
        return None;
    }

    let full_body = &raw[20..raw.len() - CHECKSUM_LEN];
    let body: &[u8] = if full_body.len() == 79 || full_body.len() == 87 {
        &full_body[..full_body.len() - 4]
    } else {
        full_body
    };
    if body.len() < 75 {
        return None;
    }

    let read_mac_at = |offset: usize| -> Option<[u8; 6]> {
        if body.len() < offset + 6 {
            return None;
        }
        let mut mac = [0u8; 6];
        mac.copy_from_slice(&body[offset..offset + 6]);
        (mac.iter().map(|&b| b as u32).sum::<u32>() > 0).then_some(mac)
    };

    // Legacy layout: name=24B, mac@64. Newer layout: name=32B, mac@72.
    let mac_offset = if read_mac_at(72).is_some() { 72 } else { 64 };
    let mac_bytes = read_mac_at(mac_offset)?;
    let mac = mac_bytes
        .iter()
        .map(|b| format!("{:02X}", b))
        .collect::<Vec<_>>()
        .join(":");

    let ver_slice = &body[0..24];
    let ver_end = ver_slice.iter().position(|&b| b == 0).unwrap_or(24);
    let firmware_version = String::from_utf8_lossy(&ver_slice[..ver_end]).trim().to_string();

    let name_slice = &body[32..mac_offset];
    let name_end = name_slice.iter().position(|&b| b == 0).unwrap_or(name_slice.len());
    let name = String::from_utf8_lossy(&name_slice[..name_end]).trim().to_string();

    let bi_offset = mac_offset + 6;
    let byte_at = |i: usize| -> u8 { body.get(bi_offset + i).copied().unwrap_or(0) };

    Some(BasicInfoReply {
        mac,
        name,
        firmware_version,
        gain_max: byte_at(0),
        analog_input_channels: byte_at(1),
        digital_input_channels: byte_at(2),
        output_channels: byte_at(3),
        machine_state: byte_at(4),
    })
}

/// Directed broadcast address for every active, non-loopback IPv4 interface,
/// falling back to 255.255.255.255 if none are found.
pub fn directed_broadcast_addresses() -> Vec<Ipv4Addr> {
    let mut out = Vec::new();
    if let Ok(ifaces) = if_addrs::get_if_addrs() {
        for iface in ifaces {
            if iface.is_loopback() {
                continue;
            }
            if let if_addrs::IfAddr::V4(v4) = iface.addr {
                let ip = v4.ip.octets();
                let mask = v4.netmask.octets();
                let bcast = [
                    ip[0] | !mask[0],
                    ip[1] | !mask[1],
                    ip[2] | !mask[2],
                    ip[3] | !mask[3],
                ];
                out.push(Ipv4Addr::from(bcast));
            }
        }
    }
    if out.is_empty() {
        out.push(Ipv4Addr::new(255, 255, 255, 255));
    }
    out
}
