use serde::{Deserialize, Serialize};
use specta::Type;

use super::common::{new_id, now_millis, EntryOrigin};

/// Placeholder DSP-capability schema — all fields intentionally `None` until
/// real per-model datasheet data is sourced. Exists so the Configure tabs
/// (Matrix, Input, Output, etc.) have a real place to eventually read
/// per-model capability from, for any brand, not just channel_count.
#[derive(Debug, Clone, Serialize, Deserialize, Type, Default)]
#[serde(rename_all = "camelCase")]
pub struct AmpDspTopology {
    pub matrix_input_count: Option<u32>,
    pub matrix_output_count: Option<u32>,
    pub eq_band_count: Option<u32>,
    /// Free-text for now (e.g. "Butterworth", "Linkwitz-Riley") — not an enum
    /// yet since no real per-model data exists to validate against.
    pub crossover_types: Option<Vec<String>>,
    pub limiter_count: Option<u32>,
}

/// Identifies which `AmpDriver` controls a catalog model — a brand-protocol-
/// family concept, not a firmware version (firmware is a runtime property of
/// a physical unit, detected at discovery time, not a fixed catalog attribute).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Type)]
#[serde(rename_all = "camelCase")]
pub enum AmpProtocol {
    CvrUdp,
}

impl AmpProtocol {
    /// Stable short slug used to namespace live device ids (e.g. "cvr:AA:BB:...").
    pub fn slug(&self) -> &'static str {
        match self {
            AmpProtocol::CvrUdp => "cvr",
        }
    }
}

fn default_protocol() -> AmpProtocol {
    // Safe today: every existing/seeded catalog entry is CVR-brand.
    AmpProtocol::CvrUdp
}

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
    /// Authoritative Dante-variant flag — replaces string-matching on the
    /// model name (e.g. a trailing "D") in the frontend.
    #[serde(default)]
    pub is_dante: bool,
    #[serde(default = "default_protocol")]
    pub protocol: AmpProtocol,
    #[serde(default)]
    pub topology: AmpDspTopology,
    pub notes: Option<String>,
    pub origin: EntryOrigin,
    /// Soft-delete flag — see SpeakerLibraryEntry.archived for rationale.
    pub archived: bool,
    pub created_at: f64,
    pub updated_at: f64,
}

impl AmpModelCatalogEntry {
    pub fn new(brand: String, model: String, channel_count: u32, is_dante: bool, protocol: AmpProtocol) -> Self {
        let now = now_millis();
        Self {
            id: new_id(),
            brand,
            model,
            channel_count,
            is_dante,
            protocol,
            topology: AmpDspTopology::default(),
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
    pub fn new_builtin(
        id: &str,
        brand: &str,
        model: &str,
        channel_count: u32,
        is_dante: bool,
        protocol: AmpProtocol,
    ) -> Self {
        let now = now_millis();
        Self {
            id: id.to_string(),
            brand: brand.to_string(),
            model: model.to_string(),
            channel_count,
            is_dante,
            protocol,
            topology: AmpDspTopology::default(),
            notes: None,
            origin: EntryOrigin::BuiltIn,
            archived: false,
            created_at: now,
            updated_at: now,
        }
    }
}
