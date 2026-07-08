use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use super::amp_model::AmpModelCatalogEntry;
use super::project::Project;
use super::speaker_library::SpeakerLibraryEntry;

/// Rust-owned canonical store for Projects + Speaker Library + Amp Model
/// Catalog — the "Project Data" domain from the architecture plan. Writes
/// here are infrequent and user-paced (not a polling loop), so a single
/// coarse lock is fine; this is deliberately kept independent from the
/// (future, separate) live-device-state domain.
pub struct ProjectDataState(pub Mutex<ProjectDataInner>);

pub struct ProjectDataInner {
    pub data_dir: PathBuf,
    pub projects: Vec<Project>,
    pub speaker_library: Vec<SpeakerLibraryEntry>,
    pub amp_models: Vec<AmpModelCatalogEntry>,
}

/// Builtin CVR amp product line — (model, channel_count). Seeded into the
/// catalog on every load if missing; ids are deterministic (`builtin-<model
/// lowercased>`) so this is idempotent rather than a one-time migration.
const BUILTIN_AMP_MODELS: &[(&str, u32)] = &[
    ("DSP-654", 4),
    ("DSP-802", 2),
    ("DSP-1002", 2),
    ("DSP-1004", 4),
    ("DSP-1502", 2),
    ("DSP-2002", 2),
    ("DSP-1504", 4),
    ("DSP-2004", 4),
    ("DSP-3002", 2),
    ("DSP-3004", 4),
    ("DSP-3302", 2),
    ("DSP-4302", 2),
];

fn seed_builtin_amp_models(amp_models: &mut Vec<AmpModelCatalogEntry>) -> bool {
    let mut changed = false;
    for (model, channel_count) in BUILTIN_AMP_MODELS {
        let id = format!("builtin-{}", model.to_lowercase());
        if !amp_models.iter().any(|m| m.id == id) {
            amp_models.push(AmpModelCatalogEntry::new_builtin(&id, "CVR", model, *channel_count));
            changed = true;
        }
    }
    changed
}

impl ProjectDataState {
    pub fn load(app: &AppHandle) -> Result<Self, String> {
        let data_dir = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("project-data");
        fs::create_dir_all(data_dir.join("projects")).map_err(|e| e.to_string())?;

        let projects = load_projects(&data_dir)?;
        let speaker_library = load_json_or_default(&data_dir.join("speaker_library.json"))?;
        let mut amp_models = load_json_or_default(&data_dir.join("amp_models.json"))?;
        if seed_builtin_amp_models(&mut amp_models) {
            save_amp_models(&data_dir, &amp_models)?;
        }

        Ok(Self(Mutex::new(ProjectDataInner {
            data_dir,
            projects,
            speaker_library,
            amp_models,
        })))
    }
}

fn load_projects(data_dir: &Path) -> Result<Vec<Project>, String> {
    let projects_dir = data_dir.join("projects");
    let mut projects = Vec::new();
    for entry in fs::read_dir(&projects_dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) == Some("json") {
            let contents = fs::read_to_string(&path).map_err(|e| e.to_string())?;
            let project: Project = serde_json::from_str(&contents).map_err(|e| e.to_string())?;
            projects.push(project);
        }
    }
    Ok(projects)
}

fn load_json_or_default<T>(path: &Path) -> Result<T, String>
where
    T: Default + serde::de::DeserializeOwned,
{
    if !path.exists() {
        return Ok(T::default());
    }
    let contents = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(&contents).map_err(|e| e.to_string())
}

pub fn save_project_file(data_dir: &Path, project: &Project) -> Result<(), String> {
    let path = data_dir.join("projects").join(format!("{}.json", project.id));
    let json = serde_json::to_string_pretty(project).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn delete_project_file(data_dir: &Path, id: &str) -> Result<(), String> {
    let path = data_dir.join("projects").join(format!("{}.json", id));
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn save_speaker_library(data_dir: &Path, entries: &[SpeakerLibraryEntry]) -> Result<(), String> {
    let path = data_dir.join("speaker_library.json");
    let json = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}

pub fn save_amp_models(data_dir: &Path, entries: &[AmpModelCatalogEntry]) -> Result<(), String> {
    let path = data_dir.join("amp_models.json");
    let json = serde_json::to_string_pretty(entries).map_err(|e| e.to_string())?;
    fs::write(path, json).map_err(|e| e.to_string())
}
