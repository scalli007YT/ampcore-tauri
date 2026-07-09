use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Emitter};

use crate::data::common::now_millis;

use super::driver::DriverHandle;

#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredDevice {
    /// "{driver_id}:{mac}", e.g. "cvr:AA:BB:CC:DD:EE:FF" — stable, brand-namespaced.
    pub id: String,
    pub driver_id: String,
    pub brand: String,
    pub name: String,
    pub mac: String,
    pub ip: String,
    pub firmware_version: String,
    /// Human-readable firmware family (e.g. "1.1.8"/"1.1.9" for CVR),
    /// `None` if unknown or not applicable to this brand's protocol.
    /// Brand-agnostic free text — driver-specific detection enums (like
    /// CVR's `CvrFirmwareFamily`) map into this rather than leaking here.
    pub firmware_family: Option<String>,
    pub gain_max: u32,
    pub analog_input_channels: u32,
    pub digital_input_channels: u32,
    pub output_channels: u32,
    pub machine_state: u32,
    pub online: bool,
    pub last_seen_at: f64,
}

pub struct LiveDeviceInner {
    pub devices: HashMap<String, DiscoveredDevice>,
    pub handles: Vec<DriverHandle>,
}

/// Arc-wrapped (unlike `ProjectDataState`'s bare `Mutex<T>`) because a clone
/// of it has to be moved into a detached background task that outlives the
/// synchronous command invocation that spawned it.
pub struct LiveDeviceState(pub Arc<Mutex<LiveDeviceInner>>);

impl LiveDeviceState {
    pub fn new() -> Self {
        Self(Arc::new(Mutex::new(LiveDeviceInner {
            devices: HashMap::new(),
            handles: Vec::new(),
        })))
    }
}

impl Default for LiveDeviceState {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Clone)]
pub struct LiveEventSink {
    pub app: AppHandle,
    pub state: Arc<Mutex<LiveDeviceInner>>,
}

impl LiveEventSink {
    pub fn upsert(&self, mut device: DiscoveredDevice) {
        device.online = true;
        device.last_seen_at = now_millis();
        let snapshot = {
            let mut inner = self.state.lock().unwrap();
            inner.devices.insert(device.id.clone(), device);
            inner.devices.values().cloned().collect::<Vec<_>>()
        };
        self.app.emit("live_device:updated", &snapshot).ok();
    }

    /// Refresh liveness for a device already known by ip (e.g. on a heartbeat
    /// reply, where we don't re-parse full identity).
    pub fn touch_by_ip(&self, ip: &str) {
        let snapshot = {
            let mut inner = self.state.lock().unwrap();
            let mut changed = false;
            for d in inner.devices.values_mut() {
                if d.ip == ip {
                    d.last_seen_at = now_millis();
                    if !d.online {
                        d.online = true;
                        changed = true;
                    }
                }
            }
            if !changed {
                return;
            }
            inner.devices.values().cloned().collect::<Vec<_>>()
        };
        self.app.emit("live_device:updated", &snapshot).ok();
    }

    pub fn mark_stale_offline(&self, timeout_ms: f64) {
        let now = now_millis();
        let snapshot = {
            let mut inner = self.state.lock().unwrap();
            let mut changed = false;
            for d in inner.devices.values_mut() {
                if d.online && now - d.last_seen_at > timeout_ms {
                    d.online = false;
                    changed = true;
                }
            }
            if !changed {
                return;
            }
            inner.devices.values().cloned().collect::<Vec<_>>()
        };
        self.app.emit("live_device:updated", &snapshot).ok();
    }
}
