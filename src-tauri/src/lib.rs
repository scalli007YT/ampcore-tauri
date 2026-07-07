mod commands;
mod data;
mod error;

use tauri::Manager;
use tauri_specta::{collect_commands, Builder};

use commands::amp_models::{amp_models_archive, amp_models_create, amp_models_list, amp_models_update};
use commands::projects::{
    projects_add_amp_assignment, projects_create, projects_delete, projects_get, projects_list,
    projects_remove_amp_assignment, projects_set_amp_model, projects_set_channel_ohms,
    projects_set_channel_speaker, projects_update,
};
use commands::speaker_library::{
    speaker_library_archive, speaker_library_create, speaker_library_list, speaker_library_update,
};
use data::store::ProjectDataState;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
#[specta::specta]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let specta_builder = Builder::<tauri::Wry>::new()
        .commands(collect_commands![
            greet,
            projects_list,
            projects_get,
            projects_create,
            projects_update,
            projects_delete,
            projects_add_amp_assignment,
            projects_remove_amp_assignment,
            projects_set_amp_model,
            projects_set_channel_speaker,
            projects_set_channel_ohms,
            speaker_library_list,
            speaker_library_create,
            speaker_library_update,
            speaker_library_archive,
            amp_models_list,
            amp_models_create,
            amp_models_update,
            amp_models_archive,
        ]);

    #[cfg(debug_assertions)]
    specta_builder
        .export(
            specta_typescript::Typescript::default(),
            "../src/lib/bindings.ts",
        )
        .expect("failed to export typescript bindings");

    tauri::Builder::default()
        .invoke_handler(specta_builder.invoke_handler())
        .setup(move |app| {
            let project_data = ProjectDataState::load(&app.handle().clone())
                .expect("failed to load project data store");
            app.manage(project_data);
            Ok(())
        })
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_opener::init())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
