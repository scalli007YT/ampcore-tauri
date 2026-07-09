use serde::{Deserialize, Serialize};
use specta::Type;

use super::common::{new_id, now_millis};

/// Per-channel config on an amp assignment. `ohms` is independently authored
/// (never derived from the assigned speaker's nominal spec — real wiring can
/// legitimately diverge) and `speaker_library_id` is a reference, never an
/// embedded copy of the speaker's data.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AmpChannel {
    pub channel_index: u32,
    pub ohms: f64,
    pub speaker_library_id: Option<String>,
    /// Which way (driver/frequency band) of the assigned speaker this
    /// channel drives — e.g. a 2-way cab's "HF" way. Only meaningful when
    /// `speaker_library_id` is set; `None`/`0` for a single-way speaker.
    pub way_index: Option<u32>,
}

/// One assigned amp "slot" within a Project. `id` is independent of `mac` so
/// a slot's configuration survives a physical unit swap. `mac` starts unset
/// at creation time — a slot is planned by model/label alone; linking it to
/// a physical unit's MAC happens later via live network discovery, not by
/// manual entry.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AmpAssignment {
    pub id: String,
    pub mac: Option<String>,
    pub label: Option<String>,
    pub amp_model_id: Option<String>,
    /// Firmware version this slot is being planned for (e.g. "1.1.8",
    /// "1.1.9") — declared by the user at planning time, not detected, since
    /// offline planning has no live device to sniff it from. Free text
    /// (mirrors `DiscoveredDevice.firmware_family`) rather than a closed
    /// enum, since it's protocol-specific and protocols are pluggable.
    #[serde(default)]
    pub firmware_version: Option<String>,
    pub channels: Vec<AmpChannel>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct Project {
    pub id: String,
    pub name: String,
    pub description: String,
    pub schema_version: u32,
    pub created_at: f64,
    pub updated_at: f64,
    pub amp_assignments: Vec<AmpAssignment>,
}

pub const CURRENT_PROJECT_SCHEMA_VERSION: u32 = 1;

impl Project {
    pub fn new(name: String, description: String) -> Self {
        let now = now_millis();
        Self {
            id: new_id(),
            name,
            description,
            schema_version: CURRENT_PROJECT_SCHEMA_VERSION,
            created_at: now,
            updated_at: now,
            amp_assignments: Vec::new(),
        }
    }

    pub fn touch(&mut self) {
        self.updated_at = now_millis();
    }
}

impl AmpAssignment {
    pub fn new(
        mac: Option<String>,
        label: Option<String>,
        channel_count: u32,
        amp_model_id: Option<String>,
        firmware_version: Option<String>,
    ) -> Self {
        let channels = (0..channel_count)
            .map(|channel_index| AmpChannel {
                channel_index,
                ohms: 8.0,
                speaker_library_id: None,
                way_index: None,
            })
            .collect();
        Self {
            id: new_id(),
            mac,
            label,
            amp_model_id,
            firmware_version,
            channels,
        }
    }

    /// Grows/shrinks `channels` to match `channel_count`, preserving existing
    /// per-channel config where indices still exist — never a destructive
    /// wipe, per the amp-model-reconciliation rule in the data model plan.
    pub fn reconcile_channel_count(&mut self, channel_count: u32) {
        if self.channels.len() as u32 > channel_count {
            self.channels.truncate(channel_count as usize);
        } else {
            for channel_index in self.channels.len() as u32..channel_count {
                self.channels.push(AmpChannel {
                    channel_index,
                    ohms: 8.0,
                    speaker_library_id: None,
                    way_index: None,
                });
            }
        }
    }
}
