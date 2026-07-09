use tauri::{AppHandle, Emitter, State};

use crate::data::common::now_millis;
use crate::data::speaker_library::{SpeakerLibraryEntry, SpeakerWay};
use crate::data::store::{save_speaker_library, ProjectDataState};
use crate::error::AppError;

#[tauri::command]
#[specta::specta]
pub fn speaker_library_list(state: State<ProjectDataState>) -> Result<Vec<SpeakerLibraryEntry>, AppError> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(inner.speaker_library.clone())
}

#[tauri::command]
#[specta::specta]
pub fn speaker_library_create(
    app: AppHandle,
    state: State<ProjectDataState>,
    brand: String,
    model: String,
    family: Option<String>,
    application: Option<String>,
    ways: Vec<SpeakerWay>,
) -> Result<SpeakerLibraryEntry, AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let entry = SpeakerLibraryEntry::new(brand, model, family, application, ways);
    inner.speaker_library.push(entry.clone());
    save_speaker_library(&inner.data_dir, &inner.speaker_library).map_err(AppError::from)?;
    app.emit("speaker_library:updated", &inner.speaker_library).ok();
    Ok(entry)
}

/// Full-entry replace, mirroring `projects_update`'s pattern.
#[tauri::command]
#[specta::specta]
pub fn speaker_library_update(
    app: AppHandle,
    state: State<ProjectDataState>,
    mut entry: SpeakerLibraryEntry,
) -> Result<SpeakerLibraryEntry, AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let existing = inner
        .speaker_library
        .iter_mut()
        .find(|e| e.id == entry.id)
        .ok_or_else(|| AppError::from(format!("speaker library entry {} not found", entry.id)))?;
    entry.updated_at = now_millis();
    *existing = entry.clone();
    save_speaker_library(&inner.data_dir, &inner.speaker_library).map_err(AppError::from)?;
    app.emit("speaker_library:updated", &inner.speaker_library).ok();
    Ok(entry)
}

/// Soft-delete — archived entries stay resolvable for existing Project
/// references but are hidden from pickers for new assignments.
#[tauri::command]
#[specta::specta]
pub fn speaker_library_archive(
    app: AppHandle,
    state: State<ProjectDataState>,
    id: String,
) -> Result<(), AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let entry = inner
        .speaker_library
        .iter_mut()
        .find(|e| e.id == id)
        .ok_or_else(|| AppError::from(format!("speaker library entry {} not found", id)))?;
    entry.archived = true;
    entry.updated_at = now_millis();
    save_speaker_library(&inner.data_dir, &inner.speaker_library).map_err(AppError::from)?;
    app.emit("speaker_library:updated", &inner.speaker_library).ok();
    Ok(())
}
