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
        let amp_models = load_json_or_default(&data_dir.join("amp_models.json"))?;

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
