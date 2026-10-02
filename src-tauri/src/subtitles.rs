//! Caption tracks: YouTube captions via yt-dlp, sidecar `.srt` / `.vtt` files
//! for local videos, and plain-text export for timestamp notes.

use serde::Serialize;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

use crate::downloader::{clean_error, ytdlp_cmd};

const MAX_SUBTITLE_BYTES: u64 = 8 * 1024 * 1024;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Track {
    lang: String,
    name: Option<String>,
    /// Auto-generated (speech recognition or machine translation).
    auto: bool,
    /// Direct VTT URL when YouTube serves a plain file; None when only a
    /// segmented stream exists and yt-dlp has to assemble it.
    url: Option<String>,
}

fn tracks_from(dict: Option<&Value>, auto: bool) -> Vec<Track> {
    let Some(map) = dict.and_then(Value::as_object) else { return vec![] };
    map.iter()
        .filter(|(lang, _)| *lang != "live_chat")
        .map(|(lang, formats)| {
            let formats = formats.as_array().cloned().unwrap_or_default();
            let vtt = formats.iter().find(|f| {
                f.get("ext").and_then(Value::as_str) == Some("vtt")
                    && !f.get("protocol").and_then(Value::as_str).unwrap_or("").starts_with("m3u8")
            });
            Track {
                lang: lang.clone(),
                name: formats
                    .iter()
                    .find_map(|f| f.get("name").and_then(Value::as_str))
                    .map(String::from),
                auto,
                url: vtt.and_then(|f| f.get("url")).and_then(Value::as_str).map(String::from),
            }
        })
        .collect()
}

#[tauri::command]
pub async fn subtitle_tracks(app: AppHandle, video_id: String) -> Result<Vec<Track>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let out = ytdlp_cmd(&app)?
            .args(["-J", "--skip-download", "--no-playlist", "--ignore-config", "--no-warnings", "--"])
            .arg(format!("https://www.youtube.com/watch?v={video_id}"))
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(clean_error(&String::from_utf8_lossy(&out.stderr)));
        }
        let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
        let mut tracks = tracks_from(v.get("subtitles"), false);
        tracks.extend(tracks_from(v.get("automatic_captions"), true));
        Ok(tracks)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// The caption file for one track, as VTT text.
#[tauri::command]
pub async fn fetch_subtitle(
    app: AppHandle,
    video_id: String,
    lang: String,
    auto: bool,
    url: Option<String>,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if let Some(url) = url {
            if let Ok(text) = reqwest::blocking::get(&url)
                .and_then(|r| r.error_for_status())
                .and_then(|r| r.text())
            {
                if text.trim_start().starts_with("WEBVTT") {
                    return Ok(text);
                }
            }
            // Fall through: let yt-dlp try when the direct link fails.
        }

        let dir = app
            .path()
            .app_cache_dir()
            .map_err(|e| e.to_string())?
            .join("subs")
            .join(format!("{video_id}-{lang}-{}", std::process::id()));
        fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        let out = ytdlp_cmd(&app)?
            .args(["--skip-download", "--no-playlist", "--ignore-config", "--no-warnings"])
            .arg(if auto { "--write-auto-subs" } else { "--write-subs" })
            // Exact language only (the option takes regexes).
            .args(["--sub-langs", &format!("^{}$", regex_escape(&lang))])
            .args(["--sub-format", "vtt", "-P"])
            .arg(&dir)
            .args(["-o", "sub.%(ext)s", "--"])
            .arg(format!("https://www.youtube.com/watch?v={video_id}"))
            .output()
            .map_err(|e| e.to_string())?;
        let file = fs::read_dir(&dir)
            .ok()
            .and_then(|rd| {
                rd.filter_map(Result::ok)
                    .map(|e| e.path())
                    .find(|p| p.extension().is_some_and(|x| x == "vtt"))
            });
        let result = match file {
            Some(f) => fs::read_to_string(&f).map_err(|e| e.to_string()),
            None if !out.status.success() => Err(clean_error(&String::from_utf8_lossy(&out.stderr))),
            None => Err("No captions in that language.".into()),
        };
        let _ = fs::remove_dir_all(&dir);
        result
    })
    .await
    .map_err(|e| e.to_string())?
}

pub(crate) fn regex_escape(s: &str) -> String {
    s.chars()
        .flat_map(|c| {
            let special = "\\.+*?()|[]{}^$".contains(c);
            special.then_some('\\').into_iter().chain(std::iter::once(c))
        })
        .collect()
}

fn is_subtitle(p: &Path) -> bool {
    p.extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("srt") || e.eq_ignore_ascii_case("vtt"))
}

#[derive(Serialize)]
pub struct SidecarFile {
    path: String,
    /// The part between the video name and the extension, e.g. "en" for
    /// `talk.en.srt`; empty for `talk.srt`.
    tag: String,
}

/// Subtitle files next to a local video that share its name
/// (`talk.mp4` → `talk.srt`, `talk.en.vtt`, …).
#[tauri::command]
pub fn find_sidecar_subtitles(path: String) -> Vec<SidecarFile> {
    let video = PathBuf::from(&path);
    let (Some(dir), Some(stem)) = (video.parent(), video.file_stem().and_then(|s| s.to_str())) else {
        return vec![];
    };
    let Ok(entries) = fs::read_dir(dir) else { return vec![] };
    let mut found: Vec<SidecarFile> = entries
        .filter_map(Result::ok)
        .map(|e| e.path())
        .filter(|p| is_subtitle(p))
        .filter_map(|p| {
            let name_stem = p.file_stem()?.to_str()?.to_string();
            let tag = if name_stem == stem {
                String::new()
            } else {
                name_stem.strip_prefix(&format!("{stem}."))?.to_string()
            };
            Some(SidecarFile { path: p.to_string_lossy().into_owned(), tag })
        })
        .collect();
    found.sort_by(|a, b| a.tag.cmp(&b.tag));
    found
}

/// Read a subtitle file the user picked or that sits next to their video.
#[tauri::command]
pub fn read_subtitle_file(path: String) -> Result<String, String> {
    let p = Path::new(&path);
    if !is_subtitle(p) {
        return Err("Only .srt and .vtt subtitle files can be opened.".into());
    }
    let size = fs::metadata(p).map_err(|e| e.to_string())?.len();
    if size > MAX_SUBTITLE_BYTES {
        return Err("That subtitle file is too large.".into());
    }
    let bytes = fs::read(p).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&bytes).into_owned())
}

/// Save exported notes. Limited to text formats so this can't be used to
/// overwrite arbitrary files.
#[tauri::command]
pub fn write_text_file(path: String, contents: String) -> Result<(), String> {
    let p = Path::new(&path);
    let ok = p
        .extension()
        .and_then(|e| e.to_str())
        .is_some_and(|e| e.eq_ignore_ascii_case("md") || e.eq_ignore_ascii_case("txt"));
    if !ok {
        return Err("Notes can only be saved as .md or .txt.".into());
    }
    fs::write(p, contents).map_err(|e| e.to_string())
}
