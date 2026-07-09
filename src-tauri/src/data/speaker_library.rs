use serde::{Deserialize, Serialize};
use specta::Type;

use super::common::{new_id, now_millis, EntryOrigin};

/// One named way (driver/frequency band) of a speaker, e.g. "LF", "HF Horn",
/// "S218" — matches the old app's simple way-label concept. Deliberately
/// does not carry `processing`/`deviceData` (DSP/tuning snapshots) — that's
/// live-device territory, deferred like every other device-I/O concern.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerWay {
    pub id: String,
    pub label: String,
}

/// A reusable, project-independent speaker profile. Projects reference
/// entries by `id` from `Channel.speaker_library_id` — never an embedded copy.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerLibraryEntry {
    pub id: String,
    pub brand: String,
    /// Product family/series (e.g. "LX Series") — distinct from `model`.
    pub family: Option<String>,
    pub model: String,
    /// Use-case category (e.g. "Full-range", "Subwoofer") — matches the old
    /// app's "Speaker Application" field.
    pub application: Option<String>,
    /// A speaker may have multiple ways (e.g. a 2-way cab has LF + HF); a
    /// channel assignment references one specific way, not the whole entry.
    /// Custom deserializer: older persisted entries have this field as an
    /// explicit `null` (from a prior schema where it was `Option<u32>`) —
    /// `#[serde(default)]` alone only covers a *missing* key, not `null`.
    #[serde(default, deserialize_with = "deserialize_ways")]
    #[specta(type = Vec<SpeakerWay>)]
    pub ways: Vec<SpeakerWay>,
    pub notes: Option<String>,
    pub origin: EntryOrigin,
    /// Soft-delete flag — archived entries stay resolvable for existing
    /// Project references but are hidden from pickers for new assignments.
    pub archived: bool,
    pub created_at: f64,
    pub updated_at: f64,
}

fn deserialize_ways<'de, D>(deserializer: D) -> Result<Vec<SpeakerWay>, D::Error>
where
    D: serde::Deserializer<'de>,
{
    let opt: Option<Vec<SpeakerWay>> = Option::deserialize(deserializer)?;
    Ok(opt.unwrap_or_default())
}

impl SpeakerLibraryEntry {
    pub fn new(
        brand: String,
        model: String,
        family: Option<String>,
        application: Option<String>,
        ways: Vec<SpeakerWay>,
    ) -> Self {
        let now = now_millis();
        Self {
            id: new_id(),
            brand,
            family,
            model,
            application,
            ways,
            notes: None,
            origin: EntryOrigin::UserDefined,
            archived: false,
            created_at: now,
            updated_at: now,
        }
    }
}
