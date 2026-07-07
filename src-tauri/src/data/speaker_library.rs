use serde::{Deserialize, Serialize};
use specta::Type;

use super::common::{new_id, now_millis, EntryOrigin};

/// A reusable, project-independent speaker profile. Projects reference
/// entries by `id` from `Channel.speaker_library_id` — never an embedded copy.
#[derive(Debug, Clone, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct SpeakerLibraryEntry {
    pub id: String,
    pub brand: String,
    pub model: String,
    pub nominal_impedance: Option<f64>,
    pub power_rating: Option<f64>,
    pub sensitivity: Option<f64>,
    pub frequency_response: Option<String>,
    pub speaker_type: Option<String>,
    pub ways: Option<u32>,
    pub notes: Option<String>,
    pub origin: EntryOrigin,
    /// Soft-delete flag — archived entries stay resolvable for existing
    /// Project references but are hidden from pickers for new assignments.
    pub archived: bool,
    pub created_at: f64,
    pub updated_at: f64,
}

impl SpeakerLibraryEntry {
    pub fn new(brand: String, model: String) -> Self {
        let now = now_millis();
        Self {
            id: new_id(),
            brand,
            model,
            nominal_impedance: None,
            power_rating: None,
            sensitivity: None,
            frequency_response: None,
            speaker_type: None,
            ways: None,
            notes: None,
            origin: EntryOrigin::UserDefined,
            archived: false,
            created_at: now,
            updated_at: now,
        }
    }
}
