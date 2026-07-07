use tauri::{AppHandle, Emitter, State};

use crate::data::amp_model::AmpModelCatalogEntry;
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

/// Adds an amp assignment to a project, identified only by MAC — the MAC
/// need not ever have been seen live (offline pre-planning). If
/// `amp_model_id` references a catalog entry, its channel count pre-populates
/// the assignment's channels.
#[tauri::command]
#[specta::specta]
pub fn projects_add_amp_assignment(
    app: AppHandle,
    state: State<ProjectDataState>,
    project_id: String,
    mac: String,
    label: Option<String>,
    amp_model_id: Option<String>,
) -> Result<Project, AppError> {
    let mut inner = state.0.lock().map_err(|e| e.to_string())?;

    let channel_count = match &amp_model_id {
        Some(id) => find_amp_model(&inner.amp_models, id)
            .map(|m| m.channel_count)
            .ok_or_else(|| AppError::from(format!("amp model {} not found", id)))?,
        None => 0,
    };

    let project = inner
        .projects
        .iter_mut()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError::from(format!("project {} not found", project_id)))?;

    project
        .amp_assignments
        .push(AmpAssignment::new(mac, label, channel_count, amp_model_id));
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

    let channel_count = match &amp_model_id {
        Some(id) => find_amp_model(&inner.amp_models, id)
            .map(|m| m.channel_count)
            .ok_or_else(|| AppError::from(format!("amp model {} not found", id)))?,
        None => 0,
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
