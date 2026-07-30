use std::net::Ipv4Addr;

use tauri::{AppHandle, State};

use crate::data::capability::PowerMode;
use crate::data::project::{CrossoverSlot, CrossoverSlotKind, CrossoverSlotPatch, EqBand, EqBandPatch, EqDirection};
use crate::error::AppError;
use crate::live::cvr::channel_config_v118::{crossover_filter_type_code, eq_filter_type_code};
use crate::live::cvr::write;
use crate::live::driver::all_drivers;
use crate::live::state::{DeviceChannelConfig, DeviceTelemetry, DiscoveredDevice, LiveDeviceState, LiveEventSink};

/// Shared lookup for every write command below: resolves `device_id` to its
/// current `firmware_family` + parsed IP in one pass, so each command body
/// is just "build a packet or error, then send it".
fn resolve_write_target(
    state: &State<'_, LiveDeviceState>,
    device_id: &str,
) -> Result<(Option<String>, Ipv4Addr), AppError> {
    let device = {
        let inner = state.0.lock().map_err(|e| e.to_string())?;
        inner
            .devices
            .get(device_id)
            .cloned()
            .ok_or_else(|| AppError::from(format!("device {} not found", device_id)))?
    };
    let ip: Ipv4Addr = device
        .ip
        .parse()
        .map_err(|_| AppError::from(format!("device {} has an unparseable ip {}", device_id, device.ip)))?;
    Ok((device.firmware_family, ip))
}

fn unknown_firmware_error(device_id: &str) -> AppError {
    AppError::from(format!("device {} has unrecognized/unknown firmware — cannot build write packet", device_id))
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

/// Fire-and-forget: sends the write packet and returns once the datagram is
/// sent, without waiting for the device to apply it. The next FC=27 poll
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
) -> Result<(), AppError> {
    let (firmware_family, ip) = resolve_write_target(&state, &device_id)?;
    let packet = write::build_set_output_mute(firmware_family.as_deref(), channel_index, muted)
        .ok_or_else(|| AppError::from(format!("device {} has unrecognized/unknown firmware — cannot build write packet", device_id)))?;
    write::send_control(ip, &packet).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn live_control_set_channel_input_mute(
    state: State<'_, LiveDeviceState>,
    device_id: String,
    channel_index: u8,
    muted: bool,
) -> Result<(), AppError> {
    let (firmware_family, ip) = resolve_write_target(&state, &device_id)?;
    let packet = write::build_set_input_mute(firmware_family.as_deref(), channel_index, muted)
        .ok_or_else(|| AppError::from(format!("device {} has unrecognized/unknown firmware — cannot build write packet", device_id)))?;
    write::send_control(ip, &packet).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn live_control_set_channel_delay_in(
    state: State<'_, LiveDeviceState>,
    device_id: String,
    channel_index: u8,
    delay_in_ms: f64,
) -> Result<(), AppError> {
    let (firmware_family, ip) = resolve_write_target(&state, &device_id)?;
    let packet = write::build_set_delay_in(firmware_family.as_deref(), channel_index, delay_in_ms as f32)
        .ok_or_else(|| AppError::from(format!("device {} has unrecognized/unknown firmware — cannot build write packet", device_id)))?;
    write::send_control(ip, &packet).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn live_control_set_channel_phase_invert(
    state: State<'_, LiveDeviceState>,
    device_id: String,
    channel_index: u8,
    inverted: bool,
) -> Result<(), AppError> {
    let (firmware_family, ip) = resolve_write_target(&state, &device_id)?;
    let packet = write::build_set_phase_invert(firmware_family.as_deref(), channel_index, inverted)
        .ok_or_else(|| AppError::from(format!("device {} has unrecognized/unknown firmware — cannot build write packet", device_id)))?;
    write::send_control(ip, &packet).await.map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub async fn live_control_set_channel_power_mode(
    state: State<'_, LiveDeviceState>,
    device_id: String,
    channel_index: u8,
    power_mode: PowerMode,
) -> Result<(), AppError> {
    let (firmware_family, ip) = resolve_write_target(&state, &device_id)?;
    let packet = write::build_set_power_mode(firmware_family.as_deref(), channel_index, power_mode)
        .ok_or_else(|| AppError::from(format!("device {} has unrecognized/unknown firmware — cannot build write packet", device_id)))?;
    write::send_control(ip, &packet).await.map_err(|e| e.to_string())?;
    Ok(())
}

/// Partial update of a channel's output trim/volume/delay — mirrors
/// `projects_set_channel_output`'s per-field-optional convention, but unlike
/// that single-struct-mutation command, each populated field here is its own
/// wire write (different FC/`in_out_flag` per field, see `write_v118.rs`) —
/// up to three fire-and-forget UDP sends per call, dispatched concurrently
/// rather than awaited one at a time.
#[tauri::command]
#[specta::specta]
pub async fn live_control_set_channel_output(
    state: State<'_, LiveDeviceState>,
    device_id: String,
    channel_index: u8,
    trim_db: Option<f64>,
    volume_db: Option<f64>,
    delay_out_ms: Option<f64>,
) -> Result<(), AppError> {
    let (firmware_family, ip) = resolve_write_target(&state, &device_id)?;
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
        write::send_control(ip, &packet).await.map_err(|e| e.to_string())?;
    }
    Ok(())
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
) -> Result<(), AppError> {
    let (firmware_family, ip) = resolve_write_target(&state, &device_id)?;
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
        write::send_control(ip, &packet).await.map_err(|e| e.to_string())?;
    }
    if let Some(freq_hz) = patch.freq_hz {
        let packet = write::build_set_eq_freq(firmware_family, channel_index, in_out_flag, segment, freq_hz as f32)
            .ok_or_else(|| unknown_firmware_error(&device_id))?;
        write::send_control(ip, &packet).await.map_err(|e| e.to_string())?;
    }
    if let Some(gain_db) = patch.gain_db {
        let packet = write::build_set_eq_gain(firmware_family, channel_index, in_out_flag, segment, gain_db as f32)
            .ok_or_else(|| unknown_firmware_error(&device_id))?;
        write::send_control(ip, &packet).await.map_err(|e| e.to_string())?;
    }
    if let Some(q) = patch.q {
        let packet = write::build_set_eq_q(firmware_family, channel_index, in_out_flag, segment, q as f32)
            .ok_or_else(|| unknown_firmware_error(&device_id))?;
        write::send_control(ip, &packet).await.map_err(|e| e.to_string())?;
    }
    Ok(())
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
) -> Result<(), AppError> {
    let (firmware_family, ip) = resolve_write_target(&state, &device_id)?;
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
        write::send_control(ip, &packet).await.map_err(|e| e.to_string())?;
        wrote_anything = true;
    }
    if let Some(freq_hz) = patch.freq_hz {
        let packet = write::build_set_eq_freq(firmware_family, channel_index, in_out_flag, segment, freq_hz as f32)
            .ok_or_else(|| unknown_firmware_error(&device_id))?;
        write::send_control(ip, &packet).await.map_err(|e| e.to_string())?;
        wrote_anything = true;
    }
    if wrote_anything {
        write::send_control(ip, &write::CROSSOVER_COMMIT_PACKET).await.map_err(|e| e.to_string())?;
    }
    Ok(())
}
