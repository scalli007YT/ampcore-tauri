use std::collections::HashMap;
use std::time::{Duration, Instant};

use tokio::net::UdpSocket;
use tokio::sync::{mpsc, oneshot};

use crate::data::amp_model::AmpProtocol;
use crate::data::capability::cvr::rated_rms_voltage_from_firmware_string;
use crate::data::common::now_millis;
use crate::live::driver::{AmpDriver, DriverHandle};
use crate::live::dsp::voltage_to_db;
use crate::live::state::{DiscoveredDevice, LiveEventSink};

use super::channel_config;
use super::protocol::*;
use super::request::{Assembled, FragmentReassembler, RequestError, RequestRegistry, RequestSpec, ResultSink};
use super::telemetry;

// Matches the reference implementation's `TimerRefresh.Interval = 4000`
// discovery cadence, with a two-cycle (~8s) grace before an amp is marked
// offline. Heartbeat now carries parsed telemetry (see `telemetry.rs`), so
// it's polled faster than the reference's 140ms cycle — an async Rust task
// has no event-loop/GC contention to worry about at this rate.
const DISCOVERY_INTERVAL: Duration = Duration::from_millis(4000);
const HEARTBEAT_INTERVAL: Duration = Duration::from_millis(50);
const OFFLINE_TIMEOUT_MS: f64 = 8_000.0;
const STATS_INTERVAL: Duration = Duration::from_secs(1);
/// FC=27 is far heavier than a 6-byte heartbeat (~2.4KB for a 4-channel amp,
/// requiring fragmentation + reassembly + a full round trip), but the
/// config-poll tick's own `has_pending` check (see the tick handler below)
/// already skips issuing a new request per device while its previous one is
/// still in flight — so this interval is just an upper bound on cadence, not
/// a request-pileup risk, however low it's set. 200ms is close to (slightly
/// under) the reference app's own fast tier for its actively-viewed device
/// (250ms, see below) — the fastest cadence known to work against real
/// hardware, chosen so a write (e.g. `live_control_set_output_mute`) is
/// reflected back to the UI quickly. Uniform across all devices — this
/// backend has no notion of "which device the UI has selected" the way the
/// reference app's dual-tier (250ms/2000ms) polling does, and plumbing that
/// through would be new coupling not justified this phase.
const CONFIG_POLL_INTERVAL: Duration = Duration::from_millis(200);
/// Drives the request registry's settle/hard-timeout checks — finer than
/// `SETTLE_MS` (20ms) so a settled request resolves promptly.
const DEADLINE_TICK_INTERVAL: Duration = Duration::from_millis(10);

/// Per-device heartbeat request/reply counters for the terminal stats
/// printout — "cheap" loss/jitter estimation (timing-derived, not a real
/// sequence-numbered ACK correlation, since the wire heartbeat body carries
/// no per-request id to match a reply against). `sent`/`received` reset every
/// `STATS_INTERVAL`; `last_received_at`/inter-arrival accumulators persist
/// across print windows so the very first delta after a reset is still valid.
#[derive(Default)]
struct DeviceStats {
    sent: u32,
    received: u32,
    last_received_at: Option<f64>,
    delta_sum_ms: f64,
    delta_sq_sum_ms: f64,
    delta_count: u32,
}

impl DeviceStats {
    fn record_received(&mut self) {
        self.received += 1;
        let now = now_millis();
        if let Some(last) = self.last_received_at {
            let delta = now - last;
            self.delta_sum_ms += delta;
            self.delta_sq_sum_ms += delta * delta;
            self.delta_count += 1;
        }
        self.last_received_at = Some(now);
    }

    /// Standard deviation of inter-arrival time over the current window — a
    /// cheap jitter proxy, not RFC 3550's EWMA jitter estimator.
    fn jitter_ms(&self) -> f64 {
        if self.delta_count == 0 {
            return 0.0;
        }
        let mean = self.delta_sum_ms / self.delta_count as f64;
        let variance = (self.delta_sq_sum_ms / self.delta_count as f64) - mean * mean;
        variance.max(0.0).sqrt()
    }

    fn mean_interval_ms(&self) -> f64 {
        if self.delta_count == 0 {
            0.0
        } else {
            self.delta_sum_ms / self.delta_count as f64
        }
    }

    fn reset_window(&mut self) {
        self.sent = 0;
        self.received = 0;
        self.delta_sum_ms = 0.0;
        self.delta_sq_sum_ms = 0.0;
        self.delta_count = 0;
    }
}

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
        let (request_tx, request_rx) = mpsc::unbounded_channel();
        {
            let mut inner = sink.state.lock().unwrap();
            inner.request_tx = Some(request_tx);
        }
        let protocol_slug = self.protocol().slug();
        let brand = self.brand();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = run(sink, stop_rx, request_rx, protocol_slug, brand).await {
                eprintln!("[cvr driver] exited with error: {e}");
            }
        });
        DriverHandle::new(stop_tx)
    }
}

async fn run(
    sink: LiveEventSink,
    mut stop_rx: oneshot::Receiver<()>,
    mut request_rx: mpsc::UnboundedReceiver<RequestSpec>,
    protocol_slug: &'static str,
    brand: &'static str,
) -> std::io::Result<()> {
    let socket = UdpSocket::bind(("0.0.0.0", PC_LISTEN_PORT)).await?;
    socket.set_broadcast(true)?;

    let mut discovery_tick = tokio::time::interval(DISCOVERY_INTERVAL);
    let mut heartbeat_tick = tokio::time::interval(HEARTBEAT_INTERVAL);
    let mut stats_tick = tokio::time::interval(STATS_INTERVAL);
    let mut config_poll_tick = tokio::time::interval(CONFIG_POLL_INTERVAL);
    let mut deadline_tick = tokio::time::interval(DEADLINE_TICK_INTERVAL);
    let mut stats: HashMap<String, DeviceStats> = HashMap::new();
    let mut reassembler = FragmentReassembler::default();
    let mut registry = RequestRegistry::default();
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
                let targets: Vec<(String, String)> = {
                    let inner = sink.state.lock().unwrap();
                    inner.devices.values().map(|d| (d.id.clone(), d.ip.clone())).collect()
                };
                let query = build_heartbeat_query();
                for (id, ip) in targets {
                    let _ = socket.send_to(&query, (ip.as_str(), AMP_PORT)).await;
                    stats.entry(id).or_default().sent += 1;
                }
            }

            _ = stats_tick.tick() => {
                for (id, s) in stats.iter_mut() {
                    if s.sent == 0 {
                        continue;
                    }
                    let lost = s.sent.saturating_sub(s.received);
                    let loss_pct = lost as f64 / s.sent as f64 * 100.0;
                    println!(
                        "[cvr driver] {id}: sent={} recv={} lost={} ({loss_pct:.1}%) avg={:.1}ms jitter={:.1}ms",
                        s.sent,
                        s.received,
                        lost,
                        s.mean_interval_ms(),
                        s.jitter_ms()
                    );
                    s.reset_window();
                }
            }

            _ = config_poll_tick.tick() => {
                let targets: Vec<(String, String)> = {
                    let inner = sink.state.lock().unwrap();
                    inner.devices.values().map(|d| (d.id.clone(), d.ip.clone())).collect()
                };
                for (_id, ip) in targets {
                    // Any pending request for this ip (not just FC=27) blocks a
                    // new poll — the shared per-IP FragmentReassembler can't
                    // safely interleave two concurrent multi-fragment exchanges,
                    // so this defers to whatever's already in flight (e.g. an
                    // on-demand FC=59 fetch) rather than racing it. Just skipped
                    // this cycle — tried again next tick.
                    if registry.has_pending_for_ip(&ip) {
                        continue;
                    }
                    let spec = RequestSpec { ip: ip.clone(), function_code: FC_SYNC_DATA, body: Vec::new(), sink: ResultSink::Internal };
                    let (packet, superseded) = registry.register(spec, Instant::now());
                    if let Some(resolved) = superseded {
                        deliver_resolved(resolved, &sink);
                    }
                    let _ = socket.send_to(&packet, (ip.as_str(), AMP_PORT)).await;
                }
            }

            Some(spec) = request_rx.recv() => {
                let ip = spec.ip.clone();
                // Same per-IP exclusivity as the poll tick above, enforced on
                // the way in here too — an external caller (e.g.
                // `live_control_fetch_presets`) racing the poll tick must be
                // rejected outright rather than registered, since by the time
                // both are pending it's too late: their responses would already
                // be interleaving in the shared reassembler.
                if registry.has_pending_for_ip(&ip) {
                    if let ResultSink::External(tx) = spec.sink {
                        let _ = tx.send(Err(RequestError::Busy));
                    }
                } else {
                    let (packet, superseded) = registry.register(spec, Instant::now());
                    if let Some(resolved) = superseded {
                        deliver_resolved(resolved, &sink);
                    }
                    let _ = socket.send_to(&packet, (ip.as_str(), AMP_PORT)).await;
                }
            }

            _ = deadline_tick.tick() => {
                let (resolved, retransmits) = registry.poll_deadlines(Instant::now());
                for r in resolved {
                    deliver_resolved(r, &sink);
                }
                for t in retransmits {
                    let _ = socket.send_to(&t.packet, (t.ip.as_str(), AMP_PORT)).await;
                }
                reassembler.sweep(super::request::FRAGMENT_MAX_AGE_MS);
            }

            recv = socket.recv_from(&mut buf) => {
                if let Ok((len, addr)) = recv {
                    let ip = addr.ip().to_string();
                    let raw = &buf[..len];

                    let Some(nd) = parse_network_data_header(raw) else { continue };
                    if nd.data_flag != NETWORK_DATA_FLAG {
                        continue;
                    }
                    // Stateless per-datagram ACK — not a session handshake.
                    // Must fire before reassembly, for every physical
                    // fragment, not just the logical frame it belongs to.
                    if nd.data_state == 0 {
                        if let Some(ack) = build_ack_packet(raw) {
                            let _ = socket.send_to(&ack, (ip.as_str(), AMP_PORT)).await;
                        }
                    }

                    match reassembler.accept(&ip, &nd, raw) {
                        Some(Assembled::Single(raw)) => {
                            // Most request/response FCs (unlike FC=27's always-fragmented
                            // SYNC_DATA) fit in one datagram — feed into the registry first;
                            // on_frame() is a no-op when there's no live pending request for
                            // (ip, fc), so this is safe unconditionally, including for FC=0/6
                            // (never registered via the registry in the first place).
                            if raw.len() >= NETWORK_HEADER_LEN + STRUCT_HEADER_LEN {
                                let inner = &raw[NETWORK_HEADER_LEN..];
                                if validate_frame(inner) {
                                    registry.on_frame(&ip, inner[1], inner.to_vec(), Instant::now());
                                }
                            }
                            if let Some(id) = handle_single(&raw, ip.clone(), &sink, protocol_slug, brand) {
                                stats.entry(id).or_default().record_received();
                            }
                        }
                        Some(Assembled::Multi(inner)) => {
                            if inner.len() >= STRUCT_HEADER_LEN && validate_frame(&inner) {
                                let function_code = inner[1];
                                registry.on_frame(&ip, function_code, inner, Instant::now());
                            } else {
                                eprintln!(
                                    "[cvr driver] assembled Multi frame from {ip} FAILED validate_frame (len={})",
                                    inner.len()
                                );
                            }
                        }
                        None => {} // mid-reassembly, waiting for more fragments
                    }
                }
            }
        }
    }
    Ok(())
}

/// Parses a resolved FC=27 SYNC_DATA frame, stores it, and broadcasts
/// `live_channel_config:updated` — shared by the config-poll tick's
/// `Internal` path here and `live_control_refresh_now`'s `External`
/// on-demand path (see `commands/live_control.rs`), so both go through
/// identical validation/parsing instead of two copies drifting apart.
pub fn parse_and_store_sync_data(ip: &str, frame: &[u8], sink: &LiveEventSink) -> Result<channel_config::ChannelConfigSnapshot, String> {
    if frame.len() < STRUCT_HEADER_LEN + CHECKSUM_LEN {
        return Err(format!("FC=27 frame too short for {}: {} bytes", ip, frame.len()));
    }
    let body = &frame[STRUCT_HEADER_LEN..frame.len() - CHECKSUM_LEN];
    let device = {
        let inner = sink.state.lock().unwrap();
        inner.devices.values().find(|d| d.ip == ip).cloned()
    };
    let Some(device) = device else {
        return Err(format!("no known device for ip {}", ip));
    };
    match channel_config::parse_channel_config(device.firmware_family.as_deref(), body) {
        Some(cfg) => {
            sink.set_channel_config(device.id, cfg.clone());
            Ok(cfg)
        }
        None => Err(format!(
            "FC=27 parse failure for {} (firmware {:?}, {} body bytes)",
            ip,
            device.firmware_family,
            body.len()
        )),
    }
}

/// Delivers one resolved request's result to wherever it needs to go.
/// `Internal` (the config-poll tick's own requests) is handled synchronously
/// right here — parsing ~2.5KB of already-in-memory bytes is not actually
/// async work, so there's no need for a channel/oneshot round trip for this
/// case. `External` wakes whatever task is awaiting the oneshot `Receiver`
/// on the other side (a Tauri command, see `live_control_refresh_now`) via a
/// non-blocking send.
fn deliver_resolved(resolved: super::request::ResolvedRequest, sink: &LiveEventSink) {
    match resolved.sink {
        ResultSink::Internal => {
            if resolved.function_code != FC_SYNC_DATA {
                return;
            }
            match resolved.result {
                Ok(frame) => match parse_and_store_sync_data(&resolved.ip, &frame, sink) {
                    Ok(cfg) => println!("[cvr driver] FC=27 config for {}: {} channels", resolved.ip, cfg.channels.len()),
                    Err(e) => eprintln!("[cvr driver] {e}"),
                },
                Err(RequestError::Timeout) => {
                    eprintln!("[cvr driver] FC=27 request to {} timed out", resolved.ip);
                }
                Err(RequestError::ShapeMismatch(len)) => {
                    eprintln!("[cvr driver] FC=27 response from {} had an implausible shape ({len} bytes)", resolved.ip);
                }
                // Never actually produced for a *registered* Internal request —
                // `Busy` is only ever sent from the `request_rx` arm's rejection
                // path, before a request is registered at all — but matched
                // here for exhaustiveness.
                Err(RequestError::Busy) => {
                    eprintln!("[cvr driver] FC=27 request to {} unexpectedly resolved as Busy", resolved.ip);
                }
            }
        }
        ResultSink::External(tx) => {
            let _ = tx.send(resolved.result);
        }
    }
}

/// Handles a single-fragment (`packets_count <= 1`) datagram exactly as
/// `handle_packet` always has — this is the trivial passthrough case of the
/// reassembler, so FC=0/FC=6 dispatch is byte-for-byte unchanged from before
/// the request/fragmentation engine existed.
fn handle_single(raw: &[u8], ip: String, sink: &LiveEventSink, protocol_slug: &'static str, brand: &'static str) -> Option<String> {
    if raw.len() < NETWORK_HEADER_LEN + STRUCT_HEADER_LEN {
        return None;
    }
    let assembled = &raw[NETWORK_HEADER_LEN..];
    if !validate_frame(assembled) {
        return None;
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
            None
        }
        FC_HEARTBEAT => {
            sink.touch_by_ip(&ip);
            // Firmware string only arrives via BASIC_INFO, not the heartbeat
            // body itself — dispatch to the firmware-specific adapter
            // (telemetry_v118/telemetry_v119) by the family already detected
            // at discovery time. Unrecognized families get no telemetry.
            let device = {
                let inner = sink.state.lock().unwrap();
                inner.devices.values().find(|d| d.ip == ip).cloned()
            };
            let device = device?;
            if let Some(mut parsed) = telemetry::parse_heartbeat_telemetry(device.firmware_family.as_deref(), raw) {
                // Enrichment step, not part of the wire adapter itself: the
                // adapters only see raw packet bytes, but a real rated
                // voltage (needed as the dB reference) can only be looked up
                // from the device's own firmware string. Stays `None` per
                // channel — never a guessed default — for any model this
                // doesn't recognize.
                if let Some(rated_v) = rated_rms_voltage_from_firmware_string(&device.firmware_version) {
                    let rated_v_f32 = rated_v as f32;
                    parsed.output_level_db =
                        parsed.output_voltages.iter().map(|&v| voltage_to_db(v, 1.0, rated_v_f32)).collect();
                    parsed.rated_rms_voltage = Some(rated_v);
                }
                sink.set_telemetry(device.id.clone(), parsed);
            }
            Some(device.id)
        }
        _ => None, // out of scope this pass
    }
}
