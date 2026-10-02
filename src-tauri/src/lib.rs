mod downloader;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(downloader::Downloads::default())
        .invoke_handler(tauri::generate_handler![
            downloader::downloader_status,
            downloader::install_downloader,
            downloader::fetch_info,
            downloader::fetch_sizes,
            downloader::cancel_sizes,
            downloader::start_download,
            downloader::cancel_download,
            downloader::show_in_folder,
            downloader::allow_media,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FocusTube");
}
