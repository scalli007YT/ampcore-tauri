use tauri::{AppHandle, State};

use crate::error::AppError;
use crate::live::driver::all_drivers;
use crate::live::state::{DiscoveredDevice, LiveDeviceState, LiveEventSink};

#[tauri::command]
#[specta::specta]
pub fn live_control_start(app: AppHandle, state: State<LiveDeviceState>) -> Result<(), AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    if !inner.handles.is_empty() {
        return Ok(()); // idempotent — already running
    }
    let sink = LiveEventSink {
        app,
        state: state.0.clone(),
    };
    for driver in all_drivers() {
        inner.handles.push(driver.start(sink.clone()));
    }
    Ok(())
}

#[tauri::command]
#[specta::specta]
pub fn live_control_stop(state: State<LiveDeviceState>) -> Result<(), AppError> {
    let handles = {
        let mut inner = state.0.lock().map_err(|e| e.to_string())?;
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
