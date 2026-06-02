// Prevents additional console window on Windows in release
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod metadata;
mod proxy;
mod recording;
mod updater;

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
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
    }

    builder
        .manage(RecordingState::default())
        .invoke_handler(tauri::generate_handler![
            metadata::get_stream_metadata,
            proxy::get_proxy_port,
            open_url,
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

            // Create tray menu
            let show_item = MenuItem::with_id(app, "show", "Show", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            // Create tray icon
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
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
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
