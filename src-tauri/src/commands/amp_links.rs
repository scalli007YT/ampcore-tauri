use tauri::{AppHandle, Emitter, State};

use crate::data::amp_link::{normalize_mac, validate_amp_link, AmpLinkValidation};
use crate::data::edit_lock::{resolve_edit_lock, AmpEditLock, LiveAmpReading};
use crate::data::project::Project;
use crate::data::store::{save_project_file, ProjectDataState};
use crate::error::AppError;
use crate::live::state::{DiscoveredDevice, LiveDeviceState};

/// Clones the device out of the live store and releases that lock before the
/// project lock is taken — the two are never held together (same rule as
/// `commands/fingerprint.rs::catalog_snapshot`).
fn live_device(live: &State<LiveDeviceState>, device_id: &str) -> Result<DiscoveredDevice, AppError> {
    let inner = live.0.lock().map_err(|e| e.to_string())?;
    let device = inner.devices.get(device_id).cloned();
    device.ok_or_else(|| AppError::from(format!("device {} not found", device_id)))
}

/// Read-only: can `device_id` be linked to this project amp? See
/// `data/amp_link.rs` for the checks.
#[tauri::command]
#[specta::specta]
pub fn projects_validate_amp_link(
    project_data: State<ProjectDataState>,
    live: State<LiveDeviceState>,
    project_id: String,
    assignment_id: String,
    device_id: String,
) -> Result<AmpLinkValidation, AppError> {
    let device = live_device(&live, &device_id)?;
    let inner = project_data.0.lock().map_err(|e| e.to_string())?;
    let project = inner
        .projects
        .iter()
        .find(|p| p.id == project_id)
        .ok_or_else(|| AppError::from(format!("project {} not found", project_id)))?;
    let assignment = project
        .amp_assignments
        .iter()
        .find(|a| a.id == assignment_id)
        .ok_or_else(|| AppError::from(format!("assignment {} not found", assignment_id)))?;
    Ok(validate_amp_link(project, assignment, &device, &inner.amp_models, &inner.device_model_links))
}

/// Links a live device to a project amp by writing its MAC. Re-validates
/// under the project lock and refuses on any failing check — the frontend's
/// earlier validation is never trusted. Config is not touched; matching
/// offline and online settings happens in the editor.
#[tauri::command]
#[specta::specta]
pub fn projects_link_amp(
    app: AppHandle,
    project_data: State<ProjectDataState>,
    live: State<LiveDeviceState>,
    project_id: String,
    assignment_id: String,
    device_id: String,
) -> Result<Project, AppError> {
    let device = live_device(&live, &device_id)?;
    let mut inner = project_data.0.lock().map_err(|e| e.to_string())?;

    let validation = {
        let project = inner
            .projects
            .iter()
            .find(|p| p.id == project_id)
            .ok_or_else(|| AppError::from(format!("project {} not found", project_id)))?;
        let assignment = project
            .amp_assignments
            .iter()
            .find(|a| a.id == assignment_id)
            .ok_or_else(|| AppError::from(format!("assignment {} not found", assignment_id)))?;
        validate_amp_link(project, assignment, &device, &inner.amp_models, &inner.device_model_links)
    };
    if let Some(failed) = validation.first_failure() {
        return Err(AppError::from(failed.detail.clone()));
    }

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

    assignment.mac = Some(device.mac);
    project.touch();

    let project = project.clone();
    save_project_file(&inner.data_dir, &project).map_err(AppError::from)?;
    app.emit("project:updated", &project).ok();
    Ok(project)
}

/// Read-only: whether this project amp is editable right now, with both
/// fingerprints and the field-by-field comparison when it's locked. See
/// `data/edit_lock.rs`.
#[tauri::command]
#[specta::specta]
pub fn projects_amp_edit_lock(
    project_data: State<ProjectDataState>,
    live: State<LiveDeviceState>,
    project_id: String,
    assignment_id: String,
) -> Result<AmpEditLock, AppError> {
    let (project, models, links) = {
        let inner = project_data.0.lock().map_err(|e| e.to_string())?;
        let project = inner
            .projects
            .iter()
            .find(|p| p.id == project_id)
            .cloned()
            .ok_or_else(|| AppError::from(format!("project {} not found", project_id)))?;
        (project, inner.amp_models.clone(), inner.device_model_links.clone())
    };
    let assignment = project
        .amp_assignments
        .iter()
        .find(|a| a.id == assignment_id)
        .ok_or_else(|| AppError::from(format!("assignment {} not found", assignment_id)))?;

    let reading = match assignment.mac.as_deref() {
        None => None,
        Some(mac) => {
            let mac = normalize_mac(mac);
            let inner = live.0.lock().map_err(|e| e.to_string())?;
            let reading = inner.devices.values().find(|d| normalize_mac(&d.mac) == mac).map(|device| LiveAmpReading {
                device: device.clone(),
                snapshot: inner.channel_config.get(&device.id).cloned(),
                bridge: inner.bridge.get(&device.id).cloned(),
            });
            reading
        }
    };

    Ok(resolve_edit_lock(&project, assignment, &models, &links, reading.as_ref()))
}

/// Clears a project amp's linked MAC. Planned config is left untouched.
#[tauri::command]
#[specta::specta]
pub fn projects_unlink_amp(
    app: AppHandle,
    project_data: State<ProjectDataState>,
    project_id: String,
    assignment_id: String,
) -> Result<Project, AppError> {
    let mut inner = project_data.0.lock().map_err(|e| e.to_string())?;
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

    assignment.mac = None;
    project.touch();

    let project = project.clone();
    save_project_file(&inner.data_dir, &project).map_err(AppError::from)?;
    app.emit("project:updated", &project).ok();
    Ok(project)
}
