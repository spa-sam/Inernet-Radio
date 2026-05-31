// Auto-update commands. Desktop ships the updater plugin and reports progress;
// mobile builds stub the commands out since the plugin is desktop-only.

#[cfg(desktop)]
use serde::Serialize;
#[cfg(desktop)]
use tauri::Emitter;

// Update availability returned to the frontend without installing anything.
#[cfg(desktop)]
#[derive(Serialize, Clone)]
pub(crate) struct UpdateInfo {
    available: bool,
    version: String,
    current_version: String,
    notes: Option<String>,
}

// Download progress for an in-flight update (emitted as `update-progress`).
#[cfg(desktop)]
#[derive(Serialize, Clone)]
struct UpdateProgress {
    downloaded: u64,
    total: Option<u64>,
}

// Check whether an update is available. Does NOT install — the frontend shows
// an "Install" button and only then calls install_update.
#[cfg(desktop)]
#[tauri::command]
pub(crate) async fn check_for_updates(app: tauri::AppHandle) -> Result<UpdateInfo, String> {
    use tauri_plugin_updater::UpdaterExt;
    let current = app.package_info().version.to_string();
    let updater = app
        .updater()
        .map_err(|_| "Updater is not configured yet".to_string())?;
    match updater.check().await {
        Ok(Some(update)) => Ok(UpdateInfo {
            available: true,
            version: update.version.clone(),
            current_version: current,
            notes: update.body.clone(),
        }),
        Ok(None) => Ok(UpdateInfo {
            available: false,
            version: current.clone(),
            current_version: current,
            notes: None,
        }),
        Err(e) => Err(e.to_string()),
    }
}

// Download and install the pending update, emitting `update-progress` events
// (downloaded / total bytes) so the UI can render a progress bar.
#[cfg(desktop)]
#[tauri::command]
pub(crate) async fn install_update(app: tauri::AppHandle) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let updater = app
        .updater()
        .map_err(|_| "Updater is not configured yet".to_string())?;
    let update = updater
        .check()
        .await
        .map_err(|e| e.to_string())?
        .ok_or("No update available")?;

    let mut downloaded: u64 = 0;
    let progress_app = app.clone();
    update
        .download_and_install(
            move |chunk_len, content_len| {
                downloaded += chunk_len as u64;
                let _ = progress_app.emit(
                    "update-progress",
                    UpdateProgress {
                        downloaded,
                        total: content_len,
                    },
                );
            },
            || {},
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

// Restart the app to apply an installed update.
#[cfg(desktop)]
#[tauri::command]
pub(crate) fn restart_app(app: tauri::AppHandle) {
    app.restart()
}

// Mobile builds do not ship the updater plugin.
#[cfg(not(desktop))]
#[tauri::command]
pub(crate) async fn check_for_updates() -> Result<String, String> {
    Err("Updates are available in the desktop app only".to_string())
}

#[cfg(not(desktop))]
#[tauri::command]
pub(crate) async fn install_update() -> Result<(), String> {
    Err("Updates are available in the desktop app only".to_string())
}

#[cfg(not(desktop))]
#[tauri::command]
pub(crate) fn restart_app() {}
