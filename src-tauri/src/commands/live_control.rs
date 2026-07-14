use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::live::driver::all_drivers;
use crate::live::state::{DeviceChannelConfig, DeviceTelemetry, DiscoveredDevice, LiveDeviceState, LiveEventSink};

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
