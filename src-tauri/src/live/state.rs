use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use specta::Type;
use tauri::{AppHandle, Emitter};
use tokio::sync::mpsc;

use crate::data::common::now_millis;

use super::cvr::channel_config::ChannelConfigSnapshot;
use super::cvr::request::RequestSpec;
use super::cvr::telemetry::Telemetry;
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
    /// Latest parsed heartbeat telemetry per device id. Kept separate from
    /// `devices` (and emitted via its own event) rather than as a field on
    /// `DiscoveredDevice` — that struct's own upsert/touch/mark-offline paths
    /// all emit a full-list snapshot, and heartbeats land per-device every
    /// couple of seconds, so folding telemetry into it would re-broadcast
    /// every device's identity data on every single device's heartbeat.
    /// Deliberately never cleared on offline — the UI dims the last reading
    /// via `DiscoveredDevice.online` instead of blanking it.
    pub telemetry: HashMap<String, Telemetry>,
    /// Latest FC=27 channel-config snapshot per device id — same
    /// never-cleared-on-offline, separately-emitted pattern as `telemetry`.
    pub channel_config: HashMap<String, ChannelConfigSnapshot>,
    /// Reaches into the running CVR driver's request engine from outside its
    /// task (e.g. a future Tauri command) — `None` whenever no driver is
    /// running. `Some` while `CvrDriver::start`'s spawned task is alive.
    pub request_tx: Option<mpsc::UnboundedSender<RequestSpec>>,
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
            telemetry: HashMap::new(),
            channel_config: HashMap::new(),
            request_tx: None,
        })))
    }
}

impl Default for LiveDeviceState {
    fn default() -> Self {
        Self::new()
    }
}

/// Event/command payload pairing a device id with its latest telemetry —
/// the shape `live_telemetry:updated` emits and `live_control_get_telemetry`
/// returns a snapshot `Vec` of.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DeviceTelemetry {
    pub device_id: String,
    pub telemetry: Telemetry,
}

/// Event/command payload pairing a device id with its latest channel-config
/// snapshot — the shape `live_channel_config:updated` emits and
/// `live_control_get_channel_config` returns a snapshot `Vec` of.
#[derive(Debug, Clone, Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct DeviceChannelConfig {
    pub device_id: String,
    pub config: ChannelConfigSnapshot,
}

#[derive(Clone)]
pub struct LiveEventSink {
    pub app: AppHandle,
    pub state: Arc<Mutex<LiveDeviceInner>>,
}

impl LiveEventSink {
    /// Records one device's freshly parsed heartbeat telemetry and emits it
    /// alone — not the full device snapshot `upsert`/`touch_by_ip` emit.
    pub fn set_telemetry(&self, device_id: String, telemetry: Telemetry) {
        {
            let mut inner = self.state.lock().unwrap();
            inner.telemetry.insert(device_id.clone(), telemetry.clone());
        }
        self.app.emit("live_telemetry:updated", &DeviceTelemetry { device_id, telemetry }).ok();
    }

    /// Records one device's freshly parsed FC=27 channel config and emits it
    /// alone — same rationale as `set_telemetry`: a separate, targeted event
    /// rather than folding into the full device-list broadcast.
    pub fn set_channel_config(&self, device_id: String, config: ChannelConfigSnapshot) {
        {
            let mut inner = self.state.lock().unwrap();
            inner.channel_config.insert(device_id.clone(), config.clone());
        }
        self.app.emit("live_channel_config:updated", &DeviceChannelConfig { device_id, config }).ok();
    }

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
