//! Search YouTube (videos, playlists) and YouTube Music (songs) from inside
//! the app, through yt-dlp's flat search so no API key is needed.

use serde::Serialize;
use serde_json::Value;
use std::thread;
use std::time::Duration;
use tauri::AppHandle;

use crate::downloader::{clean_error, ytdlp_cmd};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SearchItem {
    /// "video" | "playlist" | "song"
    kind: &'static str,
    /// Video id, or playlist id for playlists.
    id: String,
    title: String,
    channel: Option<String>,
    duration: Option<f64>,
    views: Option<u64>,
    /// Best thumbnail URL from the results (playlists); videos use the id.
    thumb: Option<String>,
}

fn url_for(kind: &str, query: &str, limit: u32) -> Result<String, String> {
    let q: String = query
        .split_whitespace()
        .map(|w| {
            w.bytes()
                .map(|b| match b {
                    b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => (b as char).to_string(),
                    _ => format!("%{b:02X}"),
                })
                .collect::<String>()
        })
        .collect::<Vec<_>>()
        .join("+");
    Ok(match kind {
        "videos" => format!("ytsearch{limit}:{}", query.trim()),
        // YouTube's "Type: Playlist" filter.
        "playlists" => format!("https://www.youtube.com/results?search_query={q}&sp=EgIQAw%253D%253D"),
        "music" => format!("https://music.youtube.com/search?q={q}#songs"),
        other => return Err(format!("Unknown search type: {other}")),
    })
}

/// Artist + title for songs from YouTube's public oEmbed endpoint, since
/// YouTube Music's flat results carry only an id and a title.
fn enrich_songs(items: &mut [SearchItem]) {
    let Ok(http) = reqwest::blocking::Client::builder()
        .user_agent("FocusTube")
        .timeout(Duration::from_secs(6))
        .build()
    else {
        return;
    };
    let handles: Vec<_> = items
        .iter()
        .map(|it| {
            let http = http.clone();
            let id = it.id.clone();
            thread::spawn(move || -> Option<(String, String)> {
                let v: Value = http
                    .get("https://www.youtube.com/oembed")
                    .query(&[("format", "json"), ("url", &format!("https://www.youtube.com/watch?v={id}"))])
                    .send()
                    .ok()?
                    .error_for_status()
                    .ok()?
                    .json()
                    .ok()?;
                let author = v.get("author_name")?.as_str()?;
                // Auto-generated artist channels are named "Artist - Topic".
                Some((id, author.trim_end_matches(" - Topic").to_string()))
            })
        })
        .collect();
    for h in handles {
        if let Ok(Some((id, artist))) = h.join() {
            if let Some(it) = items.iter_mut().find(|i| i.id == id) {
                it.channel = Some(artist);
            }
        }
    }
}

#[tauri::command]
pub async fn yt_search(app: AppHandle, kind: String, query: String, limit: u32) -> Result<Vec<SearchItem>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if query.trim().is_empty() {
            return Ok(vec![]);
        }
        let limit = limit.clamp(1, 100);
        let out = ytdlp_cmd(&app)?
            .args(["-J", "--flat-playlist", "--ignore-config", "--no-warnings", "--playlist-end"])
            .arg(limit.to_string())
            .arg("--")
            .arg(url_for(&kind, &query, limit)?)
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(clean_error(&String::from_utf8_lossy(&out.stderr)));
        }
        let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
        let mut items: Vec<SearchItem> = v
            .get("entries")
            .and_then(Value::as_array)
            .map(|entries| {
                entries
                    .iter()
                    .filter_map(|e| {
                        let s = |k: &str| e.get(k).and_then(Value::as_str).map(String::from);
                        let is_playlist = e.get("ie_key").and_then(Value::as_str) == Some("YoutubeTab");
                        let item_kind = match (kind.as_str(), is_playlist) {
                            ("playlists", true) => "playlist",
                            ("playlists", false) => return None,
                            (_, true) => return None,
                            ("music", _) => "song",
                            _ => "video",
                        };
                        Some(SearchItem {
                            kind: item_kind,
                            id: s("id")?,
                            title: s("title").unwrap_or_default(),
                            channel: s("channel").or_else(|| s("uploader")),
                            duration: e.get("duration").and_then(Value::as_f64),
                            views: e.get("view_count").and_then(Value::as_u64),
                            thumb: e
                                .get("thumbnails")
                                .and_then(Value::as_array)
                                .and_then(|t| t.last())
                                .and_then(|t| t.get("url"))
                                .and_then(Value::as_str)
                                .map(String::from),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        if kind == "music" {
            enrich_songs(&mut items);
        }
        Ok(items)
    })
    .await
    .map_err(|e| e.to_string())?
}
