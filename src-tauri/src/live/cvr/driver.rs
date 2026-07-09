use std::time::Duration;

use tokio::net::UdpSocket;
use tokio::sync::oneshot;

use crate::data::amp_model::AmpProtocol;
use crate::data::common::now_millis;
use crate::live::driver::{AmpDriver, DriverHandle};
use crate::live::state::{DiscoveredDevice, LiveEventSink};

use super::protocol::*;

// Matches the reference implementation's `TimerRefresh.Interval = 4000`
// discovery cadence, with a two-cycle (~8s) grace before an amp is marked
// offline. Heartbeat is polled less aggressively than the reference's 140ms
// cycle since this pass only needs liveness tracking, not parameter data.
const DISCOVERY_INTERVAL: Duration = Duration::from_millis(4000);
const HEARTBEAT_INTERVAL: Duration = Duration::from_millis(2000);
const OFFLINE_TIMEOUT_MS: f64 = 8_000.0;

pub struct CvrDriver;

impl AmpDriver for CvrDriver {
    fn protocol(&self) -> AmpProtocol {
        AmpProtocol::CvrUdp
    }

    fn brand(&self) -> &'static str {
        "CVR"
    }

    fn start(&self, sink: LiveEventSink) -> DriverHandle {
        let (stop_tx, stop_rx) = oneshot::channel();
        let protocol_slug = self.protocol().slug();
        let brand = self.brand();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = run(sink, stop_rx, protocol_slug, brand).await {
                eprintln!("[cvr driver] exited with error: {e}");
            }
        });
        DriverHandle::new(stop_tx)
    }
}

async fn run(
    sink: LiveEventSink,
    mut stop_rx: oneshot::Receiver<()>,
    protocol_slug: &'static str,
    brand: &'static str,
) -> std::io::Result<()> {
    let socket = UdpSocket::bind(("0.0.0.0", PC_LISTEN_PORT)).await?;
    socket.set_broadcast(true)?;

    let mut discovery_tick = tokio::time::interval(DISCOVERY_INTERVAL);
    let mut heartbeat_tick = tokio::time::interval(HEARTBEAT_INTERVAL);
    let mut buf = [0u8; 2048];

    loop {
        tokio::select! {
            _ = &mut stop_rx => break,

            _ = discovery_tick.tick() => {
                let query = build_basic_info_query();
                for addr in directed_broadcast_addresses() {
                    let _ = socket.send_to(&query, (addr, AMP_PORT)).await;
                }
                sink.mark_stale_offline(OFFLINE_TIMEOUT_MS);
            }

            _ = heartbeat_tick.tick() => {
                let ips: Vec<String> = {
                    let inner = sink.state.lock().unwrap();
                    inner.devices.values().map(|d| d.ip.clone()).collect()
                };
                let query = build_heartbeat_query();
                for ip in ips {
                    let _ = socket.send_to(&query, (ip.as_str(), AMP_PORT)).await;
                }
            }

            recv = socket.recv_from(&mut buf) => {
                if let Ok((len, addr)) = recv {
                    handle_packet(&socket, &buf[..len], addr.ip().to_string(), &sink, protocol_slug, brand).await;
                }
            }
        }
    }
    Ok(())
}

async fn handle_packet(
    socket: &UdpSocket,
    raw: &[u8],
    ip: String,
    sink: &LiveEventSink,
    protocol_slug: &'static str,
    brand: &'static str,
) {
    let Some(nd) = parse_network_data_header(raw) else {
        return;
    };
    if nd.data_flag != NETWORK_DATA_FLAG {
        return;
    }

    // Stateless per-datagram ACK — not a session handshake.
    if nd.data_state == 0 {
        if let Some(ack) = build_ack_packet(raw) {
            let _ = socket.send_to(&ack, (ip.as_str(), AMP_PORT)).await;
        }
    }

    if raw.len() < NETWORK_HEADER_LEN + STRUCT_HEADER_LEN {
        return;
    }
    // Single-fragment assumption — see protocol.rs module doc.
    let assembled = &raw[NETWORK_HEADER_LEN..];
    if !validate_frame(assembled) {
        return;
    }

    match raw[11] {
        FC_BASIC_INFO => {
            if let Some(info) = parse_basic_info_reply(raw) {
                let firmware_family = match detect_firmware_family(&info.firmware_version) {
                    CvrFirmwareFamily::V118 => Some("1.1.8".to_string()),
                    CvrFirmwareFamily::V119 => Some("1.1.9".to_string()),
                    CvrFirmwareFamily::Unknown => None,
                };
                sink.upsert(DiscoveredDevice {
                    id: format!("{protocol_slug}:{}", info.mac),
                    driver_id: protocol_slug.to_string(),
                    brand: brand.to_string(),
                    name: info.name,
                    mac: info.mac,
                    ip,
                    firmware_version: info.firmware_version,
                    firmware_family,
                    gain_max: info.gain_max as u32,
                    analog_input_channels: info.analog_input_channels as u32,
                    digital_input_channels: info.digital_input_channels as u32,
                    output_channels: info.output_channels as u32,
                    machine_state: info.machine_state as u32,
                    online: true,
                    last_seen_at: now_millis(),
                });
            }
        }
        FC_HEARTBEAT => sink.touch_by_ip(&ip),
        _ => {} // out of scope this pass
    }
}
