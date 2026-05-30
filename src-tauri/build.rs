fn main() {
    tauri_build::try_build(tauri_build::Attributes::new().app_manifest(
        tauri_build::AppManifest::new().commands(&[
            "get_proxy_port",
            "get_stream_metadata",
            "open_url",
            "start_recording",
            "stop_recording",
            "is_recording",
            "check_for_updates",
        ]),
    ))
    .unwrap();
}
