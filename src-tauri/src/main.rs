// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod metadata;
mod proxy;
mod recording;
mod updater;

use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager, WindowEvent,
};

use proxy::{start_proxy_server, ProxyState};
use recording::RecordingState;

// Open a web URL in the user's default browser.
#[tauri::command]
fn open_url(app: tauri::AppHandle, url: String) {
    use tauri_plugin_opener::OpenerExt;
    // Only allow web URLs to avoid launching arbitrary programs.
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return;
    }
    // The opener plugin passes the URL straight to the OS handler
    // (ShellExecute / open / xdg-open) without going through a shell,
    // so URL contents cannot be interpreted as shell commands.
    let _ = app.opener().open_url(url, None::<&str>);
}

// Whether closing the window hides it to the tray instead of quitting. Mirrors
// the "Keep playing in the tray when the window is closed" setting; the
// frontend pushes the value at startup and whenever the user changes it.
#[derive(Default)]
struct CloseToTray(AtomicBool);

#[tauri::command]
fn set_close_to_tray(state: tauri::State<'_, CloseToTray>, enabled: bool) {
    state.0.store(enabled, Ordering::Relaxed);
}

// Launch-at-login. Desktop only; mobile builds report "off" and ignore writes.
#[cfg(desktop)]
#[tauri::command]
fn set_autostart(app: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    use tauri_plugin_autostart::ManagerExt;
    let launcher = app.autolaunch();
    let result = if enabled {
        launcher.enable()
    } else {
        launcher.disable()
    };
    result.map_err(|e| e.to_string())
}

#[cfg(desktop)]
#[tauri::command]
fn is_autostart_enabled(app: tauri::AppHandle) -> bool {
    use tauri_plugin_autostart::ManagerExt;
    app.autolaunch().is_enabled().unwrap_or(false)
}

#[cfg(not(desktop))]
#[tauri::command]
fn set_autostart(_enabled: bool) -> Result<(), String> {
    Ok(())
}

#[cfg(not(desktop))]
#[tauri::command]
fn is_autostart_enabled() -> bool {
    false
}

// Bring the main window back from the tray (or from behind other windows).
fn show_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    #[allow(unused_mut)]
    let mut builder = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        // Persist the window size between sessions (size only — position
        // stays centered, visibility is left to the tray logic).
        .plugin(
            tauri_plugin_window_state::Builder::default()
                // Remember size, position and maximized state between sessions.
                .with_state_flags(
                    tauri_plugin_window_state::StateFlags::SIZE
                        | tauri_plugin_window_state::StateFlags::POSITION
                        | tauri_plugin_window_state::StateFlags::MAXIMIZED,
                )
                .build(),
        );

    // The updater plugin is desktop-only. It reads plugins.updater from
    // tauri.conf.json (endpoints + pubkey), which is configured.
    #[cfg(desktop)]
    {
        builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
        // Launch at login. The extra argument lets setup() start hidden in the
        // tray when the OS launches the app rather than the user.
        builder = builder.plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            Some(vec!["--minimized"]),
        ));
    }

    builder
        .manage(RecordingState::default())
        .manage(CloseToTray::default())
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                let to_tray = window
                    .app_handle()
                    .state::<CloseToTray>()
                    .0
                    .load(Ordering::Relaxed);
                if window.label() == "main" && to_tray {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            metadata::get_stream_metadata,
            proxy::get_proxy_port,
            open_url,
            set_close_to_tray,
            set_autostart,
            is_autostart_enabled,
            recording::start_recording,
            recording::stop_recording,
            recording::is_recording,
            updater::check_for_updates,
            updater::install_update,
            updater::restart_app
        ])
        .setup(|app| {
            let app_handle = app.handle().clone();
            let (port, token) = tauri::async_runtime::block_on(async {
                start_proxy_server(app_handle)
                    .await
                    .unwrap_or((0, String::new()))
            });
            app.manage(ProxyState { port, token });

            // Tray menu: playback controls (forwarded to the frontend as
            // `tray-action` events) plus Show / Quit.
            let play_item =
                MenuItem::with_id(app, "play_pause", "Play / Stop", true, None::<&str>)?;
            let prev_item = MenuItem::with_id(app, "prev", "Previous station", true, None::<&str>)?;
            let next_item = MenuItem::with_id(app, "next", "Next station", true, None::<&str>)?;
            let mute_item = MenuItem::with_id(app, "mute", "Mute / Unmute", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(
                app,
                &[
                    &play_item, &prev_item, &next_item, &mute_item, &sep, &show_item, &quit_item,
                ],
            )?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .tooltip("Internet Radio")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => show_main_window(app),
                    id @ ("play_pause" | "prev" | "next" | "mute") => {
                        let _ = app.emit("tray-action", id);
                    }
                    "quit" => {
                        // Persist window size/position before exiting via the
                        // tray, since app.exit bypasses the normal close flow.
                        use tauri_plugin_window_state::{AppHandleExt, StateFlags};
                        let _ = app.save_window_state(StateFlags::all());
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(tray.app_handle());
                    }
                })
                .build(app)?;

            // Started by the OS at login: stay in the tray until summoned.
            if std::env::args().any(|a| a == "--minimized") {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.hide();
                }
            }

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
