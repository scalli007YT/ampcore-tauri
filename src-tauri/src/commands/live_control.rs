use std::net::Ipv4Addr;

use tauri::{AppHandle, State};
use tokio::sync::mpsc;

use crate::data::capability::PowerMode;
use crate::data::common::now_millis;
use crate::data::project::{CrossoverSlot, CrossoverSlotKind, CrossoverSlotPatch, EqBand, EqBandPatch, EqDirection};
use crate::error::AppError;
use crate::live::cvr::channel_config_v118::{crossover_filter_type_code, eq_filter_type_code};
use crate::live::cvr::preset;
use crate::live::cvr::request::{WriteOutcome, WriteSpec};
use crate::live::cvr::write;
use crate::live::driver::all_drivers;
use crate::live::state::{
    DeviceChannelConfig, DevicePresets, DeviceTelemetry, DiscoveredDevice, LiveDeviceState, LiveEventSink, LiveWriteAck,
};

/// Shared lookup for every write command below: resolves `device_id` to its
/// current `firmware_family`, parsed IP, and the running driver's write
/// channel in one pass, so each command body is just "build a packet or
/// error, then send it". The channel is resolved here rather than at each
/// send so a command against a stopped driver fails before building anything.
fn resolve_write_target(
    state: &State<'_, LiveDeviceState>,
    device_id: &str,
) -> Result<(Option<String>, Ipv4Addr, mpsc::UnboundedSender<WriteSpec>), AppError> {
    let (device, write_tx) = {
        let inner = state.0.lock().map_err(|e| e.to_string())?;
        let device = inner
            .devices
            .get(device_id)
            .cloned()
            .ok_or_else(|| AppError::from(format!("device {} not found", device_id)))?;
        let write_tx = inner.write_tx.clone().ok_or_else(|| AppError::from("live control is not running"))?;
        (device, write_tx)
    };
    let ip: Ipv4Addr = device
        .ip
        .parse()
        .map_err(|_| AppError::from(format!("device {} has an unparseable ip {}", device_id, device.ip)))?;
    Ok((device.firmware_family, ip, write_tx))
}

/// Accumulates the per-packet `WriteOutcome`s of one command into the single
/// `LiveWriteAck` it returns. Every write command uses this, including the
/// single-packet ones, so the shape the frontend receives never depends on
/// how many packets a given parameter happens to require.
#[derive(Default)]
struct WriteTally {
    packets: u32,
    attempts: u32,
    elapsed_ms: u32,
    coalesced: u32,
}

impl WriteTally {
    fn record(&mut self, outcome: WriteOutcome) {
        self.packets += 1;
        if outcome.attempts == 0 {
            // Coalesced: never transmitted, so it contributes no latency and
            // must not drag the reported attempt count down to 0.
            self.coalesced += 1;
        } else {
            self.attempts = self.attempts.max(outcome.attempts as u32);
            self.elapsed_ms += outcome.elapsed_ms as u32;
        }
    }

    fn finish(self) -> LiveWriteAck {
        LiveWriteAck {
            packets: self.packets,
            attempts: self.attempts,
            elapsed_ms: self.elapsed_ms,
            coalesced: self.coalesced,
        }
    }
}

fn unknown_firmware_error(device_id: &str) -> AppError {
    AppError::from(format!("device {} has unrecognized/unknown firmware — cannot build write packet", device_id))
}

/// FC=59 preset fetch/recall has no confirmed 1.1.9 spec in either reference
/// source (see `live/cvr/preset.rs`'s module doc) — gate the feature to 1.1.8
/// only rather than guessing it also works there, matching this app's
/// "no generic fallback encoding" write philosophy.
fn require_v118_firmware(device_id: &str, firmware_family: Option<&str>) -> Result<(), AppError> {
    if firmware_family != Some("1.1.8") {
        return Err(AppError::from(format!(
            "device {} preset fetch/recall requires firmware 1.1.8 (detected: {:?})",
            device_id, firmware_family
        )));
    }
    Ok(())
}

/// FC=30 FILTER_TYPE's wire body encodes `filter_type` and `active`
/// (bypass) together in one byte — writing one field without knowing the
/// other's current value would silently clobber it. Reads the most recent
/// FC=27 poll result already cached in `LiveDeviceState` (refreshed every
/// ~200ms, see `driver.rs`) rather than querying the device directly.
/// `None` when nothing has been polled for this device/channel yet — the
/// caller must treat that as an honest "can't merge yet" error, not guess.
fn current_eq_band(
    state: &State<'_, LiveDeviceState>,
    device_id: &str,
    channel_index: u8,
    direction: EqDirection,
    band_index: usize,
) -> Result<Option<EqBand>, AppError> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(inner.channel_config.get(device_id).and_then(|snapshot| {
        snapshot.channels.iter().find(|c| c.channel_index == channel_index as u32).and_then(|c| {
            let eq = match direction {
                EqDirection::Input => &c.input_eq,
                EqDirection::Output => &c.output_eq,
            };
            eq.bands.get(band_index).copied()
        })
    }))
}

/// Same merge problem as `current_eq_band`, for a crossover (HP/LP) slot.
fn current_crossover_slot(
    state: &State<'_, LiveDeviceState>,
    device_id: &str,
    channel_index: u8,
    direction: EqDirection,
    slot: CrossoverSlotKind,
) -> Result<Option<CrossoverSlot>, AppError> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(inner.channel_config.get(device_id).and_then(|snapshot| {
        snapshot.channels.iter().find(|c| c.channel_index == channel_index as u32).map(|c| {
            let eq = match direction {
                EqDirection::Input => &c.input_eq,
                EqDirection::Output => &c.output_eq,
            };
            match slot {
                CrossoverSlotKind::Hp => eq.hp,
                CrossoverSlotKind::Lp => eq.lp,
            }
        })
    }))
}

#[tauri::command]
#[specta::specta]
pub fn live_control_start(app: AppHandle, state: State<LiveDeviceState>) -> Result<(), AppError> {
    {
        let inner = state.0.lock().map_err(|e| e.to_string())?;
        if !inner.handles.is_empty() {
            return Ok(()); // idempotent — already running
        }
    }
    // Lock must be released before calling `start()` — `CvrDriver::start`
    // locks this same `Arc<Mutex<LiveDeviceInner>>` itself (to store
    // `request_tx`), and `std::sync::Mutex` isn't reentrant: holding it
    // across the call deadlocks the very first `live_control_start`
    // invocation, which fires automatically on app load.
    let sink = LiveEventSink {
        app,
        state: state.0.clone(),
    };
    let handles: Vec<_> = all_drivers().into_iter().map(|driver| driver.start(sink.clone())).collect();
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    inner.handles.extend(handles);
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn live_control_stop(state: State<LiveDeviceState>) -> Result<(), AppError> {
    let handles = {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
        inner.request_tx = None;
        inner.write_tx = None;
        std::mem::take(&mut inner.handles)
    };
    for h in handles {
        h.request_stop();
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn live_control_list_devices(state: State<LiveDeviceState>) -> Result<Vec<DiscoveredDevice>, AppError> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(inner.devices.values().cloned().collect())
}

#[tauri::command]
#[specta::specta]
pub fn live_control_get_telemetry(state: State<LiveDeviceState>) -> Result<Vec<DeviceTelemetry>, AppError> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(inner
        .telemetry
        .iter()
        .map(|(device_id, telemetry)| DeviceTelemetry { device_id: device_id.clone(), telemetry: telemetry.clone() })
        .collect())
}

#[tauri::command]
#[specta::specta]
pub fn live_control_get_channel_config(state: State<LiveDeviceState>) -> Result<Vec<DeviceChannelConfig>, AppError> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(inner
        .channel_config
        .iter()
        .map(|(device_id, config)| DeviceChannelConfig { device_id: device_id.clone(), config: config.clone() })
        .collect())
}

/// On-demand counterpart to the background ~200ms FC=27 poll (see
/// `driver.rs`'s `config_poll_tick`): sends one SYNC_DATA request through the
/// driver's request registry with an `External` sink and awaits its result
/// directly, instead of waiting for the next passive poll tick to pick it up.
/// Still updates `LiveDeviceState.channel_config` and emits
/// `live_channel_config:updated` exactly like the background poll does (via
/// the shared `parse_and_store_sync_data`), so callers that only listen for
/// the event rather than this command's return value stay in sync too.
#[tauri::command]
#[specta::specta]
pub async fn live_control_refresh_now(app: AppHandle, state: State<'_, LiveDeviceState>, device_id: String) -> Result<DeviceChannelConfig, AppError> {
    let (ip, request_tx) = {
        let inner = state.0.lock().map_err(|e| e.to_string())?;
        let device = inner.devices.get(&device_id).cloned().ok_or_else(|| AppError::from(format!("device {} not found", device_id)))?;
        let request_tx = inner.request_tx.clone().ok_or_else(|| AppError::from("live control is not running"))?;
        (device.ip, request_tx)
    };

    let (tx, rx) = tokio::sync::oneshot::channel();
    let spec = crate::live::cvr::request::RequestSpec {
        ip: ip.clone(),
        function_code: crate::live::cvr::protocol::FC_SYNC_DATA,
        body: Vec::new(),
        sink: crate::live::cvr::request::ResultSink::External(tx),
    };
    request_tx.send(spec).map_err(|_| AppError::from("live control driver is not running"))?;
    let frame = rx
        .await
        .map_err(|_| AppError::from("live control driver dropped the request"))?
        .map_err(|e| AppError::from(format!("{:?}", e)))?;

    let sink = LiveEventSink { app, state: state.0.clone() };
    let config = crate::live::cvr::driver::parse_and_store_sync_data(&ip, &frame, &sink).map_err(AppError::from)?;
    Ok(DeviceChannelConfig { device_id, config })
}

/// Retry budget for `RequestError::Busy` — the FC=27 poll tick fires every
/// `CONFIG_POLL_INTERVAL` (200ms) and a single exchange typically resolves
/// in well under that, so 10 retries at 30ms apart (up to ~300ms worst case)
/// comfortably outlasts one poll cycle without adding noticeable latency to
/// the common case (which succeeds on the first attempt).
const PRESET_REQUEST_MAX_RETRIES: u32 = 10;
const PRESET_REQUEST_RETRY_DELAY_MS: u64 = 30;

/// Sends one FC=59 request through the driver's request registry with an
/// `External` sink and awaits its resolved frame — shared by both halves of
/// `live_control_fetch_presets` below. Not reusable across an `.await` point
/// with a second call in flight for the same device: `RequestRegistry` keys
/// pending requests by `(ip, function_code)` only, so a second FC=59 request
/// sent before the first resolves would supersede/fail it (see
/// `live/cvr/request.rs`'s `RequestRegistry::register`) — callers must fully
/// await one call before making the next.
///
/// Transparently retries `RequestError::Busy` (the driver rejects a new
/// request outright when another exchange — most commonly the background
/// FC=27 poll — is already in flight for this ip, since the shared per-IP
/// `FragmentReassembler` can't safely interleave two concurrent
/// multi-fragment responses; see `RequestError::Busy`'s doc). Without this
/// retry, a fetch racing the poll tick (most likely right after mount, when
/// several things fire close together) would surface a raw "Busy" error
/// instead of just quietly succeeding a moment later.
async fn send_preset_request(
    request_tx: &tokio::sync::mpsc::UnboundedSender<crate::live::cvr::request::RequestSpec>,
    ip: &str,
    body: Vec<u8>,
) -> Result<Vec<u8>, AppError> {
    let mut last_err = AppError::from(format!("device {} preset request never attempted", ip));
    for attempt in 0..=PRESET_REQUEST_MAX_RETRIES {
        let (tx, rx) = tokio::sync::oneshot::channel();
        let spec = crate::live::cvr::request::RequestSpec {
            ip: ip.to_string(),
            function_code: crate::live::cvr::preset::FC_SAVE_RECALL,
            body: body.clone(),
            sink: crate::live::cvr::request::ResultSink::External(tx),
        };
        request_tx.send(spec).map_err(|_| AppError::from("live control driver is not running"))?;
        match rx.await.map_err(|_| AppError::from("live control driver dropped the request"))? {
            Ok(frame) => return Ok(frame),
            Err(crate::live::cvr::request::RequestError::Busy) => {
                last_err = AppError::from(format!("device {} still busy after {} attempt(s)", ip, attempt + 1));
                if attempt < PRESET_REQUEST_MAX_RETRIES {
                    tokio::time::sleep(std::time::Duration::from_millis(PRESET_REQUEST_RETRY_DELAY_MS)).await;
                }
            }
            Err(e) => return Err(AppError::from(format!("{:?}", e))),
        }
    }
    Err(last_err)
}

/// Fetches the full preset slot-name list (FC=59 mode=0) and the currently
/// active preset's name (mode=4) as one command — deliberately not two
/// independently-callable commands, since both share the same FC=59 request
/// registry key and must not overlap (see `send_preset_request`'s doc). The
/// mode=4 request is only sent after the mode=0 oneshot has resolved. Stores
/// the result and emits `live_presets:updated`, same pattern as
/// `live_control_refresh_now`/`parse_and_store_sync_data`.
#[tauri::command]
#[specta::specta]
pub async fn live_control_fetch_presets(app: AppHandle, state: State<'_, LiveDeviceState>, device_id: String) -> Result<DevicePresets, AppError> {
    let (ip, firmware_family, request_tx) = {
        let inner = state.0.lock().map_err(|e| e.to_string())?;
        let device = inner.devices.get(&device_id).cloned().ok_or_else(|| AppError::from(format!("device {} not found", device_id)))?;
        let request_tx = inner.request_tx.clone().ok_or_else(|| AppError::from("live control is not running"))?;
        (device.ip, device.firmware_family, request_tx)
    };
    require_v118_firmware(&device_id, firmware_family.as_deref())?;

    let list_frame = send_preset_request(&request_tx, &ip, preset::build_list_request_body()).await?;
    let slots = preset::parse_preset_list(&list_frame)
        .ok_or_else(|| AppError::from(format!("device {} FC=59 mode=0 response had an unexpected shape", device_id)))?;

    let current_frame = send_preset_request(&request_tx, &ip, preset::build_current_request_body()).await?;
    let active_preset_name = preset::parse_preset_current(&current_frame)
        .ok_or_else(|| AppError::from(format!("device {} FC=59 mode=4 response had an unexpected shape", device_id)))?;

    let snapshot = preset::DevicePresetsSnapshot { slots, active_preset_name: Some(active_preset_name), received_at: now_millis() };
    let sink = LiveEventSink { app, state: state.0.clone() };
    sink.set_presets(device_id.clone(), snapshot.clone());
    Ok(DevicePresets { device_id, presets: snapshot })
}

/// Snapshot getter mirroring `live_control_get_channel_config` — returns
/// whatever `live_control_fetch_presets` last stored, no wire I/O.
#[tauri::command]
#[specta::specta]
pub fn live_control_get_presets(state: State<LiveDeviceState>) -> Result<Vec<DevicePresets>, AppError> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(inner.presets.iter().map(|(device_id, presets)| DevicePresets { device_id: device_id.clone(), presets: presets.clone() }).collect())
}

/// FC=59 mode=2 recall, same convention as every other write in this app
/// (see `write.rs`'s module doc): returns once the device has ACKed the
/// packet, which confirms delivery only. The device's new active preset
/// still shows up on the next manual `live_control_fetch_presets` call, not
/// pushed automatically here.
#[tauri::command]
#[specta::specta]
pub async fn live_control_recall_preset(state: State<'_, LiveDeviceState>, device_id: String, slot_index: u8) -> Result<LiveWriteAck, AppError> {
    let (firmware_family, ip, write_tx) = resolve_write_target(&state, &device_id)?;
    let mut tally = WriteTally::default();
    require_v118_firmware(&device_id, firmware_family.as_deref())?;
    tally.record(write::send_control(&write_tx, ip, &crate::live::cvr::preset::build_recall_packet(slot_index)).await.map_err(|e| e.to_string())?);
    Ok(tally.finish())
}

/// Returns once the device has ACKed the write at the transport level (see
/// `write.rs`'s `send_control`), or errors if it never does — delivery is
/// confirmed, but not that the device applied the value. The next FC=27 poll
/// (already running for every discovered device, see `driver.rs`) picks up
/// the real new state and pushes it to the frontend via the existing
/// `live_channel_config:updated` event — no optimistic update here.
#[tauri::command]
#[specta::specta]
pub async fn live_control_set_output_mute(
    state: State<'_, LiveDeviceState>,
    device_id: String,
    channel_index: u8,
    muted: bool,
) -> Result<LiveWriteAck, AppError> {
    let (firmware_family, ip, write_tx) = resolve_write_target(&state, &device_id)?;
    let mut tally = WriteTally::default();
    let packet = write::build_set_output_mute(firmware_family.as_deref(), channel_index, muted)
        .ok_or_else(|| AppError::from(format!("device {} has unrecognized/unknown firmware — cannot build write packet", device_id)))?;
    tally.record(write::send_control(&write_tx, ip, &packet).await.map_err(|e| e.to_string())?);
    Ok(tally.finish())
}

#[tauri::command]
#[specta::specta]
pub async fn live_control_set_channel_input_mute(
    state: State<'_, LiveDeviceState>,
    device_id: String,
    channel_index: u8,
    muted: bool,
) -> Result<LiveWriteAck, AppError> {
    let (firmware_family, ip, write_tx) = resolve_write_target(&state, &device_id)?;
    let mut tally = WriteTally::default();
    let packet = write::build_set_input_mute(firmware_family.as_deref(), channel_index, muted)
        .ok_or_else(|| AppError::from(format!("device {} has unrecognized/unknown firmware — cannot build write packet", device_id)))?;
    tally.record(write::send_control(&write_tx, ip, &packet).await.map_err(|e| e.to_string())?);
    Ok(tally.finish())
}

#[tauri::command]
#[specta::specta]
pub async fn live_control_set_channel_delay_in(
    state: State<'_, LiveDeviceState>,
    device_id: String,
    channel_index: u8,
    delay_in_ms: f64,
) -> Result<LiveWriteAck, AppError> {
    let (firmware_family, ip, write_tx) = resolve_write_target(&state, &device_id)?;
    let mut tally = WriteTally::default();
    let packet = write::build_set_delay_in(firmware_family.as_deref(), channel_index, delay_in_ms as f32)
        .ok_or_else(|| AppError::from(format!("device {} has unrecognized/unknown firmware — cannot build write packet", device_id)))?;
    tally.record(write::send_control(&write_tx, ip, &packet).await.map_err(|e| e.to_string())?);
    Ok(tally.finish())
}

#[tauri::command]
#[specta::specta]
pub async fn live_control_set_channel_phase_invert(
    state: State<'_, LiveDeviceState>,
    device_id: String,
    channel_index: u8,
    inverted: bool,
) -> Result<LiveWriteAck, AppError> {
    let (firmware_family, ip, write_tx) = resolve_write_target(&state, &device_id)?;
    let mut tally = WriteTally::default();
    let packet = write::build_set_phase_invert(firmware_family.as_deref(), channel_index, inverted)
        .ok_or_else(|| AppError::from(format!("device {} has unrecognized/unknown firmware — cannot build write packet", device_id)))?;
    tally.record(write::send_control(&write_tx, ip, &packet).await.map_err(|e| e.to_string())?);
    Ok(tally.finish())
}

#[tauri::command]
#[specta::specta]
pub async fn live_control_set_channel_power_mode(
    state: State<'_, LiveDeviceState>,
    device_id: String,
    channel_index: u8,
    power_mode: PowerMode,
) -> Result<LiveWriteAck, AppError> {
    let (firmware_family, ip, write_tx) = resolve_write_target(&state, &device_id)?;
    let mut tally = WriteTally::default();
    let packet = write::build_set_power_mode(firmware_family.as_deref(), channel_index, power_mode)
        .ok_or_else(|| AppError::from(format!("device {} has unrecognized/unknown firmware — cannot build write packet", device_id)))?;
    tally.record(write::send_control(&write_tx, ip, &packet).await.map_err(|e| e.to_string())?);
    Ok(tally.finish())
}

/// Partial update of a channel's output trim/volume/delay — mirrors
/// `projects_set_channel_output`'s per-field-optional convention, but unlike
/// that single-struct-mutation command, each populated field here is its own
/// wire write (different FC/`in_out_flag` per field, see `write_v118.rs`) —
/// up to three UDP sends per call, each awaited to its ACK before the next
/// goes out (writes are stop-and-wait per device; see `WriteRegistry`), so a
/// failure on any field surfaces instead of being masked by the others.
#[tauri::command]
#[specta::specta]
pub async fn live_control_set_channel_output(
    state: State<'_, LiveDeviceState>,
    device_id: String,
    channel_index: u8,
    trim_db: Option<f64>,
    volume_db: Option<f64>,
    delay_out_ms: Option<f64>,
) -> Result<LiveWriteAck, AppError> {
    let (firmware_family, ip, write_tx) = resolve_write_target(&state, &device_id)?;
    let mut tally = WriteTally::default();
    let firmware_family = firmware_family.as_deref();

    let mut packets = Vec::with_capacity(3);
    if let Some(trim_db) = trim_db {
        packets.push(write::build_set_output_trim(firmware_family, channel_index, trim_db as f32));
    }
    if let Some(volume_db) = volume_db {
        packets.push(write::build_set_output_volume(firmware_family, channel_index, volume_db as f32));
    }
    if let Some(delay_out_ms) = delay_out_ms {
        packets.push(write::build_set_delay_out(firmware_family, channel_index, delay_out_ms as f32));
    }

    for packet in packets {
        let packet = packet.ok_or_else(|| {
            AppError::from(format!("device {} has unrecognized/unknown firmware — cannot build write packet", device_id))
        })?;
        tally.record(write::send_control(&write_tx, ip, &packet).await.map_err(|e| e.to_string())?);
    }
    Ok(tally.finish())
}

/// Partial update of one parametric EQ band (1-8) — mirrors
/// `projects_set_eq_band`'s shape (`EqBandPatch`, only non-`None` fields
/// applied), but `filter_type`/`active` share one wire byte (FC=30) on this
/// protocol, so touching either one requires merging in the *other's*
/// current value first (see `current_eq_band`) rather than writing a
/// stale/default byte for whichever field wasn't part of this patch.
/// `freq_hz`/`gain_db`/`q` are independent FCs (32/31/34) and each sends its
/// own packet when present in the patch — up to 4 UDP sends per call.
#[tauri::command]
#[specta::specta]
pub async fn live_control_set_eq_band(
    state: State<'_, LiveDeviceState>,
    device_id: String,
    channel_index: u8,
    direction: EqDirection,
    band_index: u8,
    patch: EqBandPatch,
) -> Result<LiveWriteAck, AppError> {
    let (firmware_family, ip, write_tx) = resolve_write_target(&state, &device_id)?;
    let mut tally = WriteTally::default();
    let firmware_family = firmware_family.as_deref();
    let in_out_flag: u8 = match direction {
        EqDirection::Input => 0,
        EqDirection::Output => 1,
    };
    // `band_index` (0-7) is the array index into `ChannelEq.bands`; the wire
    // protocol's `segment` numbering reserves 0 for HP and 9 for LP, so a
    // parametric band's wire segment is always `band_index + 1` (1-8), never
    // `band_index` directly — passing it unshifted silently aims every write
    // at the wrong stage (band 0 would land on the HP crossover slot).
    let segment = band_index + 1;

    if patch.filter_type.is_some() || patch.active.is_some() {
        let current = current_eq_band(&state, &device_id, channel_index, direction, band_index as usize)?
            .ok_or_else(|| AppError::from(format!("device {} channel {} has no cached EQ state yet — try again shortly", device_id, channel_index)))?;
        let filter_type = patch.filter_type.unwrap_or(current.filter_type);
        let active = patch.active.unwrap_or(current.active);
        let type_code = eq_filter_type_code(filter_type);
        let packet = write::build_set_eq_filter_type(firmware_family, channel_index, in_out_flag, segment, type_code, active)
            .ok_or_else(|| unknown_firmware_error(&device_id))?;
        tally.record(write::send_control(&write_tx, ip, &packet).await.map_err(|e| e.to_string())?);
    }
    if let Some(freq_hz) = patch.freq_hz {
        let packet = write::build_set_eq_freq(firmware_family, channel_index, in_out_flag, segment, freq_hz as f32)
            .ok_or_else(|| unknown_firmware_error(&device_id))?;
        tally.record(write::send_control(&write_tx, ip, &packet).await.map_err(|e| e.to_string())?);
    }
    if let Some(gain_db) = patch.gain_db {
        let packet = write::build_set_eq_gain(firmware_family, channel_index, in_out_flag, segment, gain_db as f32)
            .ok_or_else(|| unknown_firmware_error(&device_id))?;
        tally.record(write::send_control(&write_tx, ip, &packet).await.map_err(|e| e.to_string())?);
    }
    if let Some(q) = patch.q {
        let packet = write::build_set_eq_q(firmware_family, channel_index, in_out_flag, segment, q as f32)
            .ok_or_else(|| unknown_firmware_error(&device_id))?;
        tally.record(write::send_control(&write_tx, ip, &packet).await.map_err(|e| e.to_string())?);
    }
    Ok(tally.finish())
}

/// Partial update of the HP or LP crossover slot — same `filter_type`/
/// `active` merge requirement as `live_control_set_eq_band` (see its doc
/// comment), plus a device-required follow-up: any FILTER_TYPE/FILTER_FREQ
/// write to a crossover slot only takes effect once
/// `write::CROSSOVER_COMMIT_PACKET` is sent afterward (reverse-engineered by
/// the reference implementation from real packet captures — see that
/// constant's doc comment). Sent once per call, after whichever field(s)
/// were actually written, not once per field.
#[tauri::command]
#[specta::specta]
pub async fn live_control_set_crossover_slot(
    state: State<'_, LiveDeviceState>,
    device_id: String,
    channel_index: u8,
    direction: EqDirection,
    slot: CrossoverSlotKind,
    patch: CrossoverSlotPatch,
) -> Result<LiveWriteAck, AppError> {
    let (firmware_family, ip, write_tx) = resolve_write_target(&state, &device_id)?;
    let mut tally = WriteTally::default();
    let firmware_family = firmware_family.as_deref();
    let in_out_flag: u8 = match direction {
        EqDirection::Input => 0,
        EqDirection::Output => 1,
    };
    // HP = segment 0, LP = segment 9 of the fixed 10-band chain, per the
    // reference's `getCrossoverSegment`.
    let segment: u8 = match slot {
        CrossoverSlotKind::Hp => 0,
        CrossoverSlotKind::Lp => 9,
    };
    let mut wrote_anything = false;

    if patch.filter_type.is_some() || patch.active.is_some() {
        let current = current_crossover_slot(&state, &device_id, channel_index, direction, slot)?.ok_or_else(|| {
            AppError::from(format!("device {} channel {} has no cached EQ state yet — try again shortly", device_id, channel_index))
        })?;
        let filter_type = patch.filter_type.unwrap_or(current.filter_type);
        let active = patch.active.unwrap_or(current.active);
        let type_code = crossover_filter_type_code(filter_type);
        let packet = write::build_set_eq_filter_type(firmware_family, channel_index, in_out_flag, segment, type_code, active)
            .ok_or_else(|| unknown_firmware_error(&device_id))?;
        tally.record(write::send_control(&write_tx, ip, &packet).await.map_err(|e| e.to_string())?);
        wrote_anything = true;
    }
    if let Some(freq_hz) = patch.freq_hz {
        let packet = write::build_set_eq_freq(firmware_family, channel_index, in_out_flag, segment, freq_hz as f32)
            .ok_or_else(|| unknown_firmware_error(&device_id))?;
        tally.record(write::send_control(&write_tx, ip, &packet).await.map_err(|e| e.to_string())?);
        wrote_anything = true;
    }
    if wrote_anything {
        tally.record(write::send_control(&write_tx, ip, &write::CROSSOVER_COMMIT_PACKET).await.map_err(|e| e.to_string())?);
    }
    Ok(tally.finish())
}
