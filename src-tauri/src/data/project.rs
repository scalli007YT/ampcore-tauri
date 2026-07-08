use std::collections::HashMap;

use serde::{Deserialize, Serialize};
use specta::Type;

use super::common::{new_id, now_millis};

/// Known linking scopes, mirroring the old app's `LINK_SCOPES`. Kept as plain
/// strings (not a Rust enum) so `AmpLinkConfig.scopes` stays a simple
/// `Record<string, LinkScopeConfig>` on the TypeScript side.
pub const LINK_SCOPES: &[&str] = &[
    "muteIn",
    "muteOut",
    "volumeOut",
    "noiseGateOut",
    "polarityOut",
    "trimOut",
    "delayOut",
    "inputEq",
    "outputEq",
    "limiters",
];

#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinkGroup {
    pub id: String,
    pub name: String,
    pub channels: Vec<u32>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct LinkScopeConfig {
    pub enabled: bool,
    pub groups: Vec<LinkGroup>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AmpLinkConfig {
    pub enabled: bool,
    pub scopes: HashMap<String, LinkScopeConfig>,
}

impl AmpLinkConfig {
    pub fn default_with_scopes() -> Self {
        let mut scopes = HashMap::new();
        for scope in LINK_SCOPES {
            scopes.insert(scope.to_string(), LinkScopeConfig::default());
        }
        Self {
            enabled: false,
            scopes,
        }
    }
}

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
    pub channels: Vec<AmpChannel>,
    pub linking: AmpLinkConfig,
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
    pub fn new(mac: Option<String>, label: Option<String>, channel_count: u32, amp_model_id: Option<String>) -> Self {
        let channels = (0..channel_count)
            .map(|channel_index| AmpChannel {
                channel_index,
                ohms: 8.0,
                speaker_library_id: None,
            })
            .collect();
        Self {
            id: new_id(),
            mac,
            label,
            amp_model_id,
            channels,
            linking: AmpLinkConfig::default_with_scopes(),
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
                });
            }
        }
    }
}
