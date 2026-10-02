//! Online subtitle search through the official OpenSubtitles.com API.
//! Bring-your-own-key: every user adds their own free API key (and can sign
//! in for a bigger daily download quota). Keys and tokens stay in the app's
//! config folder and never reach the page.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::time::Duration;
use tauri::{AppHandle, Manager};

const API: &str = "https://api.opensubtitles.com/api/v1";
const HASH_CHUNK: u64 = 64 * 1024;

fn user_agent() -> String {
    format!("FocusTube v{}", env!("CARGO_PKG_VERSION"))
}

#[derive(Serialize, Deserialize, Default)]
struct Stored {
    api_key: String,
    username: String,
    /// Login token (the password itself is never stored).
    token: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicConfig {
    has_key: bool,
    key_hint: String,
    username: String,
    signed_in: bool,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app
        .path()
        .app_config_dir()
        .map_err(|e| e.to_string())?
        .join("opensubtitles.json"))
}

fn load(app: &AppHandle) -> Stored {
    config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn store(app: &AppHandle, s: &Stored) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, serde_json::to_vec_pretty(s).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn public(s: &Stored) -> PublicConfig {
    let hint = if s.api_key.len() > 8 {
        format!("{}…{}", &s.api_key[..4], &s.api_key[s.api_key.len() - 4..])
    } else if s.api_key.is_empty() {
        String::new()
    } else {
        "••••".into()
    };
    PublicConfig {
        has_key: !s.api_key.is_empty(),
        key_hint: hint,
        username: s.username.clone(),
        signed_in: !s.token.is_empty(),
    }
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent(user_agent())
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())
}

fn api_error(status: reqwest::StatusCode, body: &str) -> String {
    let msg = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| {
            v.get("message")
                .or_else(|| v.pointer("/errors/0"))
                .and_then(Value::as_str)
                .map(String::from)
        })
        .unwrap_or_default();
    match status.as_u16() {
        401 => "OpenSubtitles rejected the API key or sign-in. Check them in subtitle settings.".into(),
        403 if msg.contains("consume") => "OpenSubtitles needs a valid API key. Add yours in subtitle settings.".into(),
        406 | 429 if !msg.is_empty() => msg,
        429 => "Download limit reached for today. Sign in for a bigger quota, or try again later.".into(),
        503 => "OpenSubtitles is temporarily unavailable. Try again later.".into(),
        _ if !msg.is_empty() => msg,
        _ => format!("OpenSubtitles request failed ({status})"),
    }
}

/// The OpenSubtitles file hash: file size plus the 64-bit little-endian
/// words of the first and last 64 KB, wrapping, as 16 hex digits. It
/// identifies the exact release, so matching subtitles are already in sync.
pub(crate) fn movie_hash(path: &Path) -> Result<(String, u64), String> {
    let mut f = fs::File::open(path).map_err(|e| e.to_string())?;
    let size = f.metadata().map_err(|e| e.to_string())?.len();
    if size < HASH_CHUNK * 2 {
        return Err("File too small to hash".into());
    }
    let mut hash = size;
    let mut buf = vec![0u8; HASH_CHUNK as usize];
    for offset in [0, size - HASH_CHUNK] {
        f.seek(SeekFrom::Start(offset)).map_err(|e| e.to_string())?;
        f.read_exact(&mut buf).map_err(|e| e.to_string())?;
        for word in buf.chunks_exact(8) {
            hash = hash.wrapping_add(u64::from_le_bytes(word.try_into().unwrap()));
        }
    }
    Ok((format!("{hash:016x}"), size))
}

// ---------- Settings ----------

#[tauri::command]
pub fn os_get_config(app: AppHandle) -> PublicConfig {
    public(&load(&app))
}

#[tauri::command]
pub fn os_save_key(app: AppHandle, api_key: String) -> Result<PublicConfig, String> {
    let mut s = load(&app);
    s.api_key = api_key.trim().to_string();
    if s.api_key.is_empty() {
        s.token.clear();
    }
    store(&app, &s)?;
    Ok(public(&s))
}

#[tauri::command]
pub async fn os_login(app: AppHandle, username: String, password: String) -> Result<PublicConfig, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut s = load(&app);
        if s.api_key.is_empty() {
            return Err("Add your API key first.".into());
        }
        let res = client()?
            .post(format!("{API}/login"))
            .header("Api-Key", &s.api_key)
            .header("Accept", "application/json")
            .json(&json!({ "username": username.trim(), "password": password }))
            .send()
            .map_err(|e| format!("Couldn't reach OpenSubtitles: {e}"))?;
        let status = res.status();
        let body = res.text().map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(if status.as_u16() == 401 {
                "Wrong username or password.".into()
            } else {
                api_error(status, &body)
            });
        }
        let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
        s.token = v.get("token").and_then(Value::as_str).unwrap_or_default().to_string();
        s.username = username.trim().to_string();
        store(&app, &s)?;
        Ok(public(&s))
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn os_logout(app: AppHandle) -> Result<PublicConfig, String> {
    let mut s = load(&app);
    s.token.clear();
    s.username.clear();
    store(&app, &s)?;
    Ok(public(&s))
}

// ---------- Search & download ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchResult {
    file_id: i64,
    file_name: String,
    language: String,
    release: String,
    title: String,
    year: Option<i64>,
    season: Option<i64>,
    episode: Option<i64>,
    downloads: i64,
    hearing_impaired: bool,
    machine_translated: bool,
    trusted: bool,
    /// Made for this exact file (hash match): timing should be right.
    exact_match: bool,
    fps: Option<f64>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchArgs {
    query: Option<String>,
    /// A local video to match by hash.
    path: Option<String>,
    /// Comma-separated codes, e.g. "en,ar".
    languages: String,
}

#[tauri::command]
pub async fn os_search(app: AppHandle, args: SearchArgs) -> Result<Vec<SearchResult>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = load(&app);
        if s.api_key.is_empty() {
            return Err("Add your OpenSubtitles API key first.".into());
        }
        // The API prefers alphabetically sorted, lower-case parameters.
        let mut params: Vec<(&str, String)> = vec![];
        if !args.languages.trim().is_empty() {
            params.push(("languages", args.languages.trim().to_lowercase()));
        }
        if let Some(p) = args.path.as_deref().filter(|p| !p.is_empty()) {
            if let Ok((hash, size)) = movie_hash(Path::new(p)) {
                params.push(("moviebytesize", size.to_string()));
                params.push(("moviehash", hash));
            }
        }
        if let Some(q) = args.query.as_deref().map(str::trim).filter(|q| !q.is_empty()) {
            params.push(("query", q.to_lowercase()));
        }
        if !params.iter().any(|(k, _)| *k == "query" || *k == "moviehash") {
            return Err("Type a title to search for.".into());
        }
        params.sort_by(|a, b| a.0.cmp(b.0));

        let mut req = client()?
            .get(format!("{API}/subtitles"))
            .query(&params)
            .header("Api-Key", &s.api_key)
            .header("Accept", "application/json");
        if !s.token.is_empty() {
            req = req.bearer_auth(&s.token);
        }
        let res = req.send().map_err(|e| format!("Couldn't reach OpenSubtitles: {e}"))?;
        let status = res.status();
        let body = res.text().map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(api_error(status, &body));
        }
        let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
        let mut results: Vec<SearchResult> = v
            .get("data")
            .and_then(Value::as_array)
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| {
                        let a = item.get("attributes")?;
                        let file = a.pointer("/files/0")?;
                        let s = |p: &str| a.pointer(p).and_then(Value::as_str).unwrap_or_default().to_string();
                        let b = |p: &str| a.pointer(p).and_then(Value::as_bool).unwrap_or(false);
                        let i = |p: &str| a.pointer(p).and_then(Value::as_i64);
                        Some(SearchResult {
                            file_id: file.get("file_id")?.as_i64()?,
                            file_name: file.get("file_name").and_then(Value::as_str).unwrap_or_default().to_string(),
                            language: s("/language"),
                            release: s("/release"),
                            title: s("/feature_details/title"),
                            year: i("/feature_details/year"),
                            season: i("/feature_details/season_number"),
                            episode: i("/feature_details/episode_number"),
                            downloads: i("/download_count").unwrap_or(0),
                            hearing_impaired: b("/hearing_impaired"),
                            machine_translated: b("/machine_translated") || b("/ai_translated"),
                            trusted: b("/from_trusted"),
                            exact_match: b("/moviehash_match"),
                            fps: a.get("fps").and_then(Value::as_f64),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default();
        // Exact file matches first, then the most downloaded.
        results.sort_by(|x, y| y.exact_match.cmp(&x.exact_match).then(y.downloads.cmp(&x.downloads)));
        Ok(results)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Downloaded {
    text: String,
    file_name: String,
    remaining: Option<i64>,
    reset_time: Option<String>,
}

#[tauri::command]
pub async fn os_download(app: AppHandle, file_id: i64) -> Result<Downloaded, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let s = load(&app);
        if s.api_key.is_empty() {
            return Err("Add your OpenSubtitles API key first.".into());
        }
        let http = client()?;
        let mut req = http
            .post(format!("{API}/download"))
            .header("Api-Key", &s.api_key)
            .header("Accept", "application/json")
            .json(&json!({ "file_id": file_id }));
        if !s.token.is_empty() {
            req = req.bearer_auth(&s.token);
        }
        let res = req.send().map_err(|e| format!("Couldn't reach OpenSubtitles: {e}"))?;
        let status = res.status();
        let body = res.text().map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(api_error(status, &body));
        }
        let v: Value = serde_json::from_str(&body).map_err(|e| e.to_string())?;
        let link = v
            .get("link")
            .and_then(Value::as_str)
            .ok_or_else(|| api_error(status, &body))?;
        let bytes = http
            .get(link)
            .send()
            .and_then(|r| r.error_for_status())
            .and_then(|r| r.bytes())
            .map_err(|e| format!("Couldn't download the subtitle file: {e}"))?;
        Ok(Downloaded {
            text: String::from_utf8_lossy(&bytes).into_owned(),
            file_name: v.get("file_name").and_then(Value::as_str).unwrap_or("subtitles.srt").to_string(),
            remaining: v.get("remaining").and_then(Value::as_i64),
            reset_time: v.get("reset_time").and_then(Value::as_str).map(String::from),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Save a downloaded subtitle next to a local video as `<video>.<lang>.srt`,
/// so it loads automatically next time. Never overwrites an existing file.
#[tauri::command]
pub fn os_save_beside(video_path: String, lang: String, contents: String) -> Result<String, String> {
    let video = Path::new(&video_path);
    if !video.is_file() {
        return Err("The video file is no longer there.".into());
    }
    let dir = video.parent().ok_or("No folder for this video")?;
    let stem = video.file_stem().and_then(|s| s.to_str()).ok_or("Bad file name")?;
    let lang: String = lang.chars().filter(|c| c.is_ascii_alphanumeric() || *c == '-').take(10).collect();
    let tag = if lang.is_empty() { String::new() } else { format!(".{lang}") };
    let ext = if contents.trim_start().starts_with("WEBVTT") { "vtt" } else { "srt" };
    let mut target = dir.join(format!("{stem}{tag}.{ext}"));
    let mut n = 2;
    while target.exists() {
        target = dir.join(format!("{stem}{tag}.{n}.{ext}"));
        n += 1;
    }
    fs::write(&target, contents).map_err(|e| e.to_string())?;
    Ok(target.to_string_lossy().into_owned())
}
