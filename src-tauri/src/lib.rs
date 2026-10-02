mod ai;
mod downloader;
mod opensubs;
mod search;
mod subtitles;

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
            subtitles::subtitle_tracks,
            subtitles::fetch_subtitle,
            subtitles::find_sidecar_subtitles,
            subtitles::read_subtitle_file,
            subtitles::write_text_file,
            ai::ai_get_config,
            ai::ai_save_config,
            ai::ai_forget,
            ai::ai_list_models,
            ai::ai_test,
            ai::ai_complete,
            opensubs::os_get_config,
            opensubs::os_save_key,
            opensubs::os_login,
            opensubs::os_logout,
            opensubs::os_search,
            opensubs::os_download,
            opensubs::os_save_beside,
            search::yt_search,
        ])
        .run(tauri::generate_context!())
        .expect("error while running FocusTube");
}
