use serde::{Deserialize, Serialize};
use specta::Type;

use super::common::{new_id, now_millis, EntryOrigin};

/// A reusable, project-independent amp hardware model — mirrors the Speaker
/// Library pattern. Referenced by `AmpAssignment.amp_model_id` to pre-populate
/// an assignment's channel count during offline planning.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct AmpModelCatalogEntry {
    pub id: String,
    pub brand: String,
    pub model: String,
    pub channel_count: u32,
    pub notes: Option<String>,
    pub origin: EntryOrigin,
    /// Soft-delete flag — see SpeakerLibraryEntry.archived for rationale.
    pub archived: bool,
    pub created_at: f64,
    pub updated_at: f64,
}

impl AmpModelCatalogEntry {
    pub fn new(brand: String, model: String, channel_count: u32) -> Self {
        let now = now_millis();
        Self {
            id: new_id(),
            brand,
            model,
            channel_count,
            notes: None,
            origin: EntryOrigin::UserDefined,
            archived: false,
            created_at: now,
            updated_at: now,
        }
    }

    /// Builtin catalog entries use a deterministic id (not `new_id()`'s
    /// random uuid) so re-seeding on every app start is idempotent — no
    /// need to track "have we seeded yet" separately from the data itself.
    pub fn new_builtin(id: &str, brand: &str, model: &str, channel_count: u32) -> Self {
        let now = now_millis();
        Self {
            id: id.to_string(),
            brand: brand.to_string(),
            model: model.to_string(),
            channel_count,
            notes: None,
            origin: EntryOrigin::BuiltIn,
            archived: false,
            created_at: now,
            updated_at: now,
        }
    }
}
