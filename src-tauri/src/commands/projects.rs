use tauri::{AppHandle, Emitter, State};

use crate::data::amp_model::AmpModelCatalogEntry;
use crate::data::capability::SourceKind;
use crate::data::project::{AmpAssignment, Project};
use crate::data::store::{delete_project_file, save_project_file, ProjectDataState};
use crate::error::AppError;

fn find_amp_model<'a>(models: &'a [AmpModelCatalogEntry], id: &str) -> Option<&'a AmpModelCatalogEntry> {
    models.iter().find(|m| m.id == id)
}

#[tauri::command]
#[specta::specta]
pub fn projects_list(state: State<ProjectDataState>) -> Result<Vec<Project>, AppError> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(inner.projects.clone())
}

#[tauri::command]
#[specta::specta]
pub fn projects_get(state: State<ProjectDataState>, id: String) -> Result<Option<Project>, AppError> {
    let inner = state.0.lock().map_err(|e| e.to_string())?;
    Ok(inner.projects.iter().find(|p| p.id == id).cloned())
}

#[tauri::command]
#[specta::specta]
pub fn projects_create(
    app: AppHandle,
    state: State<ProjectDataState>,
    name: String,
    description: String,
) -> Result<Project, AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let project = Project::new(name, description);
    save_project_file(&inner.data_dir, &project).map_err(AppError::from)?;
    inner.projects.push(project.clone());
    app.emit("project:updated", &project).ok();
    Ok(project)
}

/// Full-document replace, matching the old app's PUT-whole-project pattern.
/// Bumps `updated_at` regardless of what the caller passed.
#[tauri::command]
#[specta::specta]
pub fn projects_update(
    app: AppHandle,
    state: State<ProjectDataState>,
    mut project: Project,
) -> Result<Project, AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    if !inner.projects.iter().any(|p| p.id == project.id) {
        return Err(AppError::from(format!("project {} not found", project.id)));
    }
    project.touch();
    save_project_file(&inner.data_dir, &project).map_err(AppError::from)?;
    if let Some(slot) = inner.projects.iter_mut().find(|p| p.id == project.id) {
        *slot = project.clone();
    }
    app.emit("project:updated", &project).ok();
    Ok(project)
}

#[tauri::command]
#[specta::specta]
pub fn projects_delete(app: AppHandle, state: State<ProjectDataState>, id: String) -> Result<(), AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    delete_project_file(&inner.data_dir, &id).map_err(AppError::from)?;
    inner.projects.retain(|p| p.id != id);
    app.emit("project:deleted", &id).ok();
    Ok(())
}

/// Adds an amp assignment to a project by model/label alone — `mac` starts
/// unset (`None`) and is linked later via live network discovery, not typed
/// in manually. If `amp_model_id` references a catalog entry, its channel
/// count pre-populates the assignment's channels.
#[tauri::command]
#[specta::specta]
pub fn projects_add_amp_assignment(
    app: AppHandle,
    state: State<ProjectDataState>,
    project_id: String,
    label: Option<String>,
    amp_model_id: Option<String>,
    firmware_version: Option<String>,
) -> Result<Project, AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;

    let (channel_count, matrix_input_count) = match &amp_model_id {
        Some(id) => {
            let model = find_amp_model(&inner.amp_models, id)
                .ok_or_else(|| AppError::from(format!("amp model {} not found", id)))?;
            (model.channel_count, model.topology.matrix_input_count)
        }
        None => (0, 0),
    };

    let project = inner
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError::from(format!("project {} not found", project_id)))?;

    let mut assignment = AmpAssignment::new(None, label, channel_count, amp_model_id, firmware_version);
    assignment.reconcile_matrix_size(matrix_input_count);
    project.amp_assignments.push(assignment);
    project.touch();

    let project = project.clone();
    save_project_file(&inner.data_dir, &project).map_err(AppError::from)?;
    app.emit("project:updated", &project).ok();
    Ok(project)
}

#[tauri::command]
#[specta::specta]
pub fn projects_remove_amp_assignment(
    app: AppHandle,
    state: State<ProjectDataState>,
    project_id: String,
    assignment_id: String,
) -> Result<Project, AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let project = inner
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError::from(format!("project {} not found", project_id)))?;

    project.amp_assignments.retain(|a| a.id != assignment_id);
    project.touch();

    let project = project.clone();
    save_project_file(&inner.data_dir, &project).map_err(AppError::from)?;
    app.emit("project:updated", &project).ok();
    Ok(project)
}

/// Changes (or clears) an assignment's amp model, reconciling its channel
/// count additively — grows/shrinks `channels`, preserving existing
/// per-channel config where indices still exist. Never a destructive wipe.
#[tauri::command]
#[specta::specta]
pub fn projects_set_amp_model(
    app: AppHandle,
    state: State<ProjectDataState>,
    project_id: String,
    assignment_id: String,
    amp_model_id: Option<String>,
) -> Result<Project, AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;

    let (channel_count, matrix_input_count) = match &amp_model_id {
        Some(id) => {
            let model = find_amp_model(&inner.amp_models, id)
                .ok_or_else(|| AppError::from(format!("amp model {} not found", id)))?;
            (model.channel_count, model.topology.matrix_input_count)
        }
        None => (0, 0),
    };

    let project = inner
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError::from(format!("project {} not found", project_id)))?;

    let assignment = project
        .amp_assignments
        .iter_mut()
        .find(|a| a.id == assignment_id)
        .ok_or_else(|| AppError::from(format!("assignment {} not found", assignment_id)))?;

    assignment.amp_model_id = amp_model_id;
    if channel_count > 0 {
        assignment.reconcile_channel_count(channel_count);
    }
    assignment.reconcile_matrix_size(matrix_input_count);
    project.touch();

    let project = project.clone();
    save_project_file(&inner.data_dir, &project).map_err(AppError::from)?;
    app.emit("project:updated", &project).ok();
    Ok(project)
}

#[tauri::command]
#[specta::specta]
pub fn projects_set_channel_speaker(
    app: AppHandle,
    state: State<ProjectDataState>,
    project_id: String,
    assignment_id: String,
    channel_index: u32,
    speaker_library_id: Option<String>,
    way_index: Option<u32>,
) -> Result<Project, AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let project = inner
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError::from(format!("project {} not found", project_id)))?;

    let assignment = project
        .amp_assignments
        .iter_mut()
        .find(|a| a.id == assignment_id)
        .ok_or_else(|| AppError::from(format!("assignment {} not found", assignment_id)))?;

    let channel = assignment
        .channels
        .iter_mut()
        .find(|c| c.channel_index == channel_index)
        .ok_or_else(|| AppError::from(format!("channel {} not found", channel_index)))?;

    channel.speaker_library_id = speaker_library_id;
    channel.way_index = way_index;
    project.touch();

    let project = project.clone();
    save_project_file(&inner.data_dir, &project).map_err(AppError::from)?;
    app.emit("project:updated", &project).ok();
    Ok(project)
}

#[tauri::command]
#[specta::specta]
pub fn projects_set_channel_ohms(
    app: AppHandle,
    state: State<ProjectDataState>,
    project_id: String,
    assignment_id: String,
    channel_index: u32,
    ohms: f64,
) -> Result<Project, AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let project = inner
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError::from(format!("project {} not found", project_id)))?;

    let assignment = project
        .amp_assignments
        .iter_mut()
        .find(|a| a.id == assignment_id)
        .ok_or_else(|| AppError::from(format!("assignment {} not found", assignment_id)))?;

    let channel = assignment
        .channels
        .iter_mut()
        .find(|c| c.channel_index == channel_index)
        .ok_or_else(|| AppError::from(format!("channel {} not found", channel_index)))?;

    channel.ohms = ohms;
    project.touch();

    let project = project.clone();
    save_project_file(&inner.data_dir, &project).map_err(AppError::from)?;
    app.emit("project:updated", &project).ok();
    Ok(project)
}

/// Sets (or clears) which physical source feeds a channel's input —
/// Source Selection tab.
#[tauri::command]
#[specta::specta]
pub fn projects_set_channel_source(
    app: AppHandle,
    state: State<ProjectDataState>,
    project_id: String,
    assignment_id: String,
    channel_index: u32,
    source: Option<SourceKind>,
) -> Result<Project, AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let project = inner
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError::from(format!("project {} not found", project_id)))?;

    let assignment = project
        .amp_assignments
        .iter_mut()
        .find(|a| a.id == assignment_id)
        .ok_or_else(|| AppError::from(format!("assignment {} not found", assignment_id)))?;

    let channel = assignment
        .channels
        .iter_mut()
        .find(|c| c.channel_index == channel_index)
        .ok_or_else(|| AppError::from(format!("channel {} not found", channel_index)))?;

    channel.source = source;
    project.touch();

    let project = project.clone();
    save_project_file(&inner.data_dir, &project).map_err(AppError::from)?;
    app.emit("project:updated", &project).ok();
    Ok(project)
}

/// Partial update of one Matrix-tab crosspoint — only touches the fields the
/// caller passes (`Some`), matching `projects_set_channel_speaker`'s
/// per-field-optional convention. Fails if the crosspoint doesn't exist yet
/// (it should always exist by the time the UI can edit it, since
/// `reconcile_matrix_size` pre-populates every crosspoint for the model's
/// `matrix_input_count`).
#[tauri::command]
#[specta::specta]
pub fn projects_set_matrix_crosspoint(
    app: AppHandle,
    state: State<ProjectDataState>,
    project_id: String,
    assignment_id: String,
    channel_index: u32,
    source_index: u32,
    gain_db: Option<f64>,
    active: Option<bool>,
) -> Result<Project, AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;
    let project = inner
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError::from(format!("project {} not found", project_id)))?;

    let assignment = project
        .amp_assignments
        .iter_mut()
        .find(|a| a.id == assignment_id)
        .ok_or_else(|| AppError::from(format!("assignment {} not found", assignment_id)))?;

    let channel = assignment
        .channels
        .iter_mut()
        .find(|c| c.channel_index == channel_index)
        .ok_or_else(|| AppError::from(format!("channel {} not found", channel_index)))?;

    let crosspoint = channel
        .matrix_crosspoints
        .iter_mut()
        .find(|c| c.source_index == source_index)
        .ok_or_else(|| AppError::from(format!("matrix source {} not found", source_index)))?;

    if let Some(gain_db) = gain_db {
        crosspoint.gain_db = gain_db;
    }
    if let Some(active) = active {
        crosspoint.active = active;
    }
    project.touch();

    let project = project.clone();
    save_project_file(&inner.data_dir, &project).map_err(AppError::from)?;
    app.emit("project:updated", &project).ok();
    Ok(project)
}
