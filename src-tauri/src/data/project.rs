use serde::{Deserialize, Serialize};
use specta::Type;

use super::capability::SourceKind;
use super::common::{new_id, now_millis};

/// One crosspoint in a channel's row of the input matrix — the gain/active
/// state for a single source position. `source_index` is positional (0..
/// `AmpDspTopology.matrix_input_count`), not a `SourceKind` itself, since a
/// model can have multiple sources of the same kind (e.g. 4 analog + 4 Dante
/// inputs on a Dante-equipped model).
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct MatrixCrosspoint {
    pub source_index: u32,
    pub gain_db: f64,
    pub active: bool,
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
    /// Which way (driver/frequency band) of the assigned speaker this
    /// channel drives — e.g. a 2-way cab's "HF" way. Only meaningful when
    /// `speaker_library_id` is set; `None`/`0` for a single-way speaker.
    pub way_index: Option<u32>,
    /// Which physical source feeds this channel's input — Source Selection
    /// tab. `None` until the user picks one.
    #[serde(default)]
    pub source: Option<SourceKind>,
    /// One crosspoint per possible matrix source (0..matrix_input_count) —
    /// Matrix tab. Grown/shrunk alongside `channels` whenever the assigned
    /// model (hence its topology) changes; see `reconcile_matrix_size`.
    #[serde(default)]
    pub matrix_crosspoints: Vec<MatrixCrosspoint>,
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

/// Bumped to 2 when `AmpChannel.source`/`matrix_crosspoints` were added —
/// both fields use `#[serde(default)]`, so older project files still load
/// unchanged and need no migration code.
pub const CURRENT_PROJECT_SCHEMA_VERSION: u32 = 2;

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
        let channels = (0..channel_count).map(new_channel).collect();
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
                self.channels.push(new_channel(channel_index));
            }
        }
    }

    /// Grows/shrinks every channel's `matrix_crosspoints` to
    /// `matrix_input_count`, preserving existing crosspoint values at
    /// surviving indices — same non-destructive rule as
    /// `reconcile_channel_count`. Called whenever the assigned model (hence
    /// its resolved topology) changes.
    pub fn reconcile_matrix_size(&mut self, matrix_input_count: u32) {
        for channel in &mut self.channels {
            if channel.matrix_crosspoints.len() as u32 > matrix_input_count {
                channel.matrix_crosspoints.truncate(matrix_input_count as usize);
            } else {
                for source_index in channel.matrix_crosspoints.len() as u32..matrix_input_count {
                    channel.matrix_crosspoints.push(MatrixCrosspoint {
                        source_index,
                        gain_db: 0.0,
                        active: false,
                    });
                }
            }
        }
    }
}

fn new_channel(channel_index: u32) -> AmpChannel {
    AmpChannel {
        channel_index,
        ohms: 8.0,
        speaker_library_id: None,
        way_index: None,
        source: None,
        matrix_crosspoints: Vec::new(),
    }
}
