use tauri::{AppHandle, Emitter, State};

use crate::data::common::now_millis;
use crate::data::speaker_library::{SpeakerLibraryEntry, SpeakerWay};
use crate::data::store::{save_project_file, save_speaker_library, ProjectDataState};
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

/// Hard-delete — unlike `speaker_library_archive` (soft-delete, kept for
/// its existing "hide from picker, stay resolvable for old references"
/// use case), this permanently removes the entry and cascades: clears
/// `speaker_library_id`/`way_index` on every channel, in every project,
/// that references it. `join_group_id` is deliberately left untouched —
/// Join grouping is independent of what's assigned, so a group a deleted
/// speaker belonged to stays joined (now showing "No speaker" on those
/// rows) rather than being silently un-joined. Saves only the projects
/// actually touched, matching `reconcile_project_matrix_sizes`'s pattern.
#[tauri::command]
#[specta::specta]
pub fn speaker_library_delete(app: AppHandle, state: State<ProjectDataState>, id: String) -> Result<(), AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    if !inner.speaker_library.iter().any(|e| e.id == id) {
        return Err(AppError::from(format!("speaker library entry {} not found", id)));
    }
    inner.speaker_library.retain(|e| e.id != id);
    save_speaker_library(&inner.data_dir, &inner.speaker_library).map_err(AppError::from)?;
    app.emit("speaker_library:updated", &inner.speaker_library).ok();

    let data_dir = inner.data_dir.clone();
    for project in inner.projects.iter_mut() {
        let mut touched = false;
        for assignment in project.amp_assignments.iter_mut() {
            for channel in assignment.channels.iter_mut() {
                if channel.speaker_library_id.as_deref() == Some(id.as_str()) {
                    channel.speaker_library_id = None;
                    channel.way_index = None;
                    touched = true;
                }
            }
        }
        if touched {
            project.touch();
            save_project_file(&data_dir, project).map_err(AppError::from)?;
            app.emit("project:updated", &*project).ok();
        }
    }
    Ok(())
}
