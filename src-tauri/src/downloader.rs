//! Video / playlist downloads backed by yt-dlp (+ FFmpeg for merging HD
//! streams and MP3 conversion). Both tools are fetched on first use into the
//! app data dir so the installer stays small and yt-dlp can self-update.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, Manager, State};

const EXE: &str = std::env::consts::EXE_SUFFIX;

#[cfg(target_os = "windows")]
const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe";
#[cfg(target_os = "macos")]
const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_macos";
#[cfg(all(target_os = "linux", target_arch = "aarch64"))]
const YTDLP_URL: &str =
    "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux_aarch64";
#[cfg(all(target_os = "linux", not(target_arch = "aarch64")))]
const YTDLP_URL: &str = "https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp_linux";

// Only Windows gets a managed FFmpeg; elsewhere we use one from the system.
#[cfg(all(target_os = "windows", target_arch = "aarch64"))]
const FFMPEG_ZIP_URL: Option<&str> = Some(
    "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-winarm64-gpl.zip",
);
#[cfg(all(target_os = "windows", not(target_arch = "aarch64")))]
const FFMPEG_ZIP_URL: Option<&str> = Some(
    "https://github.com/yt-dlp/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip",
);
#[cfg(not(target_os = "windows"))]
const FFMPEG_ZIP_URL: Option<&str> = None;

#[derive(Default)]
pub struct Downloads {
    pids: Mutex<HashMap<String, u32>>,
    size_pids: Mutex<HashMap<String, Vec<u32>>>,
    cancelled: Mutex<HashSet<String>>,
    updated: AtomicBool,
}

fn bin_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join("bin");
    Ok(dir)
}

fn ytdlp_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(bin_dir(app)?.join(format!("yt-dlp{EXE}")))
}

/// Directory containing `name`: our managed bin dir first, then PATH plus the
/// usual Homebrew/system locations (GUI apps on macOS don't inherit the shell
/// PATH).
fn find_tool(app: &AppHandle, name: &str) -> Option<PathBuf> {
    let file = format!("{name}{EXE}");
    let mut candidates: Vec<PathBuf> = bin_dir(app).ok().into_iter().collect();
    if let Some(path) = std::env::var_os("PATH") {
        candidates.extend(std::env::split_paths(&path));
    }
    candidates.extend(
        ["/opt/homebrew/bin", "/usr/local/bin", "/usr/bin"]
            .iter()
            .map(PathBuf::from),
    );
    candidates.into_iter().find(|d| d.join(&file).is_file())
}

fn ffmpeg_dir(app: &AppHandle) -> Option<PathBuf> {
    find_tool(app, "ffmpeg")
}

/// YouTube increasingly needs a JS runtime to unlock all formats; use one if
/// the user already has it installed.
fn js_runtime_arg(app: &AppHandle) -> Option<String> {
    ["deno", "node", "bun"].iter().find_map(|rt| {
        find_tool(app, rt).map(|dir| format!("{rt}:{}", dir.join(format!("{rt}{EXE}")).display()))
    })
}

pub(crate) fn ytdlp_cmd(app: &AppHandle) -> Result<Command, String> {
    let mut cmd = Command::new(ytdlp_path(app)?);
    cmd.env("PYTHONIOENCODING", "utf-8")
        .env("PYTHONUTF8", "1")
        .stdin(Stdio::null());
    if let Some(rt) = js_runtime_arg(app) {
        cmd.args(["--js-runtimes", &rt]);
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        cmd.creation_flags(CREATE_NO_WINDOW);
    }
    Ok(cmd)
}

/// Turn yt-dlp's stderr into one short, human-readable message.
pub(crate) fn clean_error(stderr: &str) -> String {
    stderr
        .lines()
        .rev()
        .find(|l| l.starts_with("ERROR:"))
        .map(|l| {
            let msg = l.trim_start_matches("ERROR:").trim();
            // Strip the "[youtube] abc123: " extractor prefix.
            match msg.strip_prefix('[').and_then(|m| m.split_once("] ")) {
                Some((_, rest)) => rest
                    .split_once(": ")
                    .filter(|(id, _)| !id.contains(' '))
                    .map_or(rest, |(_, r)| r)
                    .to_string(),
                None => msg.to_string(),
            }
        })
        .unwrap_or_else(|| "yt-dlp failed".into())
}

// ---------- Setup ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    ytdlp: bool,
    ffmpeg: bool,
    needs_setup: bool,
}

#[tauri::command]
pub fn downloader_status(app: AppHandle) -> Result<Status, String> {
    let ytdlp = ytdlp_path(&app)?.is_file();
    let ffmpeg = ffmpeg_dir(&app).is_some();
    Ok(Status {
        ytdlp,
        ffmpeg,
        needs_setup: !ytdlp || (!ffmpeg && FFMPEG_ZIP_URL.is_some()),
    })
}

#[derive(Serialize, Clone)]
struct SetupProgress {
    stage: &'static str,
    received: u64,
    total: Option<u64>,
}

fn fetch_to_file(
    app: &AppHandle,
    stage: &'static str,
    url: &str,
    dest: &Path,
) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .user_agent("FocusTube")
        .timeout(None)
        .build()
        .map_err(|e| e.to_string())?;
    let mut res = client
        .get(url)
        .send()
        .and_then(|r| r.error_for_status())
        .map_err(|e| format!("Couldn't download {stage}: {e}"))?;
    let total = res.content_length();
    let tmp = dest.with_extension("part");
    let mut file = fs::File::create(&tmp).map_err(|e| e.to_string())?;
    let mut buf = vec![0u8; 64 * 1024];
    let mut received = 0u64;
    let mut last_emit = Instant::now();
    loop {
        let n = res.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        file.write_all(&buf[..n]).map_err(|e| e.to_string())?;
        received += n as u64;
        if last_emit.elapsed() > Duration::from_millis(120) {
            last_emit = Instant::now();
            let _ = app.emit("downloader-setup", SetupProgress { stage, received, total });
        }
    }
    drop(file);
    fs::rename(&tmp, dest).map_err(|e| e.to_string())?;
    let _ = app.emit("downloader-setup", SetupProgress { stage, received, total: Some(received) });
    Ok(())
}

fn install_blocking(app: &AppHandle) -> Result<(), String> {
    let dir = bin_dir(app)?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let ytdlp = ytdlp_path(app)?;
    if !ytdlp.is_file() {
        fetch_to_file(app, "yt-dlp", YTDLP_URL, &ytdlp)?;
        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            fs::set_permissions(&ytdlp, fs::Permissions::from_mode(0o755))
                .map_err(|e| e.to_string())?;
        }
    }

    if let (Some(url), None) = (FFMPEG_ZIP_URL, ffmpeg_dir(app)) {
        let zip_path = dir.join("ffmpeg.zip");
        fetch_to_file(app, "ffmpeg", url, &zip_path)?;
        let _ = app.emit("downloader-setup", SetupProgress { stage: "extract", received: 0, total: None });
        let file = fs::File::open(&zip_path).map_err(|e| e.to_string())?;
        let mut archive = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            let Some(name) = entry.enclosed_name().and_then(|p| {
                p.file_name().map(|n| n.to_string_lossy().into_owned())
            }) else {
                continue;
            };
            if name == format!("ffmpeg{EXE}") || name == format!("ffprobe{EXE}") {
                let mut out = fs::File::create(dir.join(&name)).map_err(|e| e.to_string())?;
                std::io::copy(&mut entry, &mut out).map_err(|e| e.to_string())?;
            }
        }
        let _ = fs::remove_file(&zip_path);
    }
    Ok(())
}

#[tauri::command]
pub async fn install_downloader(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || install_blocking(&app))
        .await
        .map_err(|e| e.to_string())?
}

/// yt-dlp breaks whenever YouTube changes things; keep it current, once per
/// app session, in the background.
fn self_update_once(app: &AppHandle, state: &Downloads) {
    if state.updated.swap(true, Ordering::SeqCst) {
        return;
    }
    if let Ok(mut cmd) = ytdlp_cmd(app) {
        thread::spawn(move || {
            let _ = cmd.arg("-U").stdout(Stdio::null()).stderr(Stdio::null()).status();
        });
    }
}

// ---------- Metadata ----------

/// Bytes for one format, falling back to bitrate × duration.
fn format_size(f: &Value, duration: Option<f64>) -> Option<f64> {
    let n = |k: &str| f.get(k).and_then(Value::as_f64);
    n("filesize")
        .or(n("filesize_approx"))
        .or_else(|| Some(n("tbr")? * 1000.0 / 8.0 * duration?))
}

/// Estimated download sizes for one video, mirroring the format choice made
/// by `build_args` (`-S res:H,ext:mp4:m4a` + best m4a audio): for every
/// available height the size of the video stream yt-dlp would pick plus the
/// audio stream.
fn estimate_sizes(v: &Value) -> Value {
    let duration = v.get("duration").and_then(Value::as_f64);
    let formats = v.get("formats").and_then(Value::as_array).cloned().unwrap_or_default();
    let s = |f: &Value, k: &str| f.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let is_none = |c: String| c.is_empty() || c == "none";

    let audio = formats
        .iter()
        .filter(|f| is_none(s(f, "vcodec")) && !is_none(s(f, "acodec")))
        .filter(|f| !s(f, "format_id").contains("drc"))
        .max_by(|a, b| {
            let key = |f: &Value| {
                (
                    s(f, "ext") == "m4a",
                    f.get("abr").and_then(Value::as_f64).unwrap_or(0.0),
                )
            };
            key(a).partial_cmp(&key(b)).unwrap_or(std::cmp::Ordering::Equal)
        })
        .and_then(|f| format_size(f, duration));

    let codec_rank = |c: &str| match c {
        c if c.starts_with("av01") => 4,
        c if c.starts_with("vp09") || c.starts_with("vp9") => 3,
        c if c.starts_with("hev") || c.starts_with("hvc") => 2,
        c if c.starts_with("avc") => 1,
        _ => 0,
    };
    let mut best_by_height: std::collections::BTreeMap<u64, (Value, f64)> = Default::default();
    for f in formats.iter().filter(|f| !is_none(s(f, "vcodec")) && is_none(s(f, "acodec"))) {
        let Some(h) = f.get("height").and_then(Value::as_u64) else { continue };
        let Some(size) = format_size(f, duration) else { continue };
        let key = |f: &Value| {
            (
                s(f, "ext") == "mp4",
                f.get("fps").and_then(Value::as_f64).unwrap_or(0.0) as i64,
                codec_rank(&s(f, "vcodec")),
                s(f, "protocol").starts_with("http"),
                f.get("tbr").and_then(Value::as_f64).unwrap_or(0.0) as i64,
            )
        };
        let better = best_by_height.get(&h).map_or(true, |(cur, _)| key(f) > key(cur));
        if better {
            best_by_height.insert(h, (f.clone(), size));
        }
    }
    let heights: Vec<Value> = best_by_height
        .iter()
        .map(|(h, (_, size))| json!({ "height": h, "size": size + audio.unwrap_or(0.0) }))
        .collect();

    // `--audio-quality 0` MP3s average roughly 245 kbps.
    let mp3 = duration.map(|d| d * 245_000.0 / 8.0);
    json!({ "heights": heights, "audio": audio, "mp3": mp3 })
}

#[tauri::command]
pub async fn fetch_info(
    app: AppHandle,
    state: State<'_, Downloads>,
    url: String,
) -> Result<Value, String> {
    self_update_once(&app, &state);
    tauri::async_runtime::spawn_blocking(move || {
        let out = ytdlp_cmd(&app)?
            .args(["-J", "--flat-playlist", "--yes-playlist", "--ignore-config", "--no-warnings", "--"])
            .arg(&url)
            .output()
            .map_err(|e| e.to_string())?;
        if !out.status.success() {
            return Err(clean_error(&String::from_utf8_lossy(&out.stderr)));
        }
        let v: Value = serde_json::from_slice(&out.stdout).map_err(|e| e.to_string())?;
        let s = |k: &str| v.get(k).and_then(Value::as_str);
        let channel = s("channel").or(s("uploader"));
        if s("_type") == Some("playlist") {
            let entries: Vec<Value> = v
                .get("entries")
                .and_then(Value::as_array)
                .map(|a| {
                    a.iter()
                        .map(|e| {
                            json!({
                                "id": e.get("id"),
                                "title": e.get("title"),
                                "duration": e.get("duration"),
                            })
                        })
                        .collect()
                })
                .unwrap_or_default();
            Ok(json!({
                "kind": "playlist",
                "title": s("title"),
                "channel": channel,
                "count": entries.len(),
                "entries": entries,
            }))
        } else {
            Ok(json!({
                "kind": "video",
                "id": s("id"),
                "title": s("title"),
                "channel": channel,
                "duration": v.get("duration"),
                "sizes": estimate_sizes(&v),
            }))
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone)]
struct SizeEvent {
    key: String,
    id: String,
    sizes: Option<Value>,
}

/// Size estimates for many videos (a playlist). Flat playlist data has no
/// formats, so each video must be extracted; a few yt-dlp processes work
/// through the list in parallel and stream results as `video-size` events.
#[tauri::command]
pub fn fetch_sizes(
    app: AppHandle,
    state: State<'_, Downloads>,
    key: String,
    ids: Vec<String>,
) -> Result<(), String> {
    const WORKERS: usize = 3;
    // Interleave so every worker starts near the top of the list.
    let mut chunks: Vec<Vec<String>> = vec![Vec::new(); WORKERS.min(ids.len())];
    for (i, id) in ids.into_iter().enumerate() {
        let n = chunks.len();
        chunks[i % n].push(id);
    }
    for chunk in chunks {
        let mut child = ytdlp_cmd(&app)?
            .args(["-j", "--skip-download", "--no-playlist", "--ignore-errors", "--ignore-config", "--no-warnings", "--"])
            .args(chunk.iter().map(|id| format!("https://www.youtube.com/watch?v={id}")))
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| e.to_string())?;
        let pid = child.id();
        state.size_pids.lock().unwrap().entry(key.clone()).or_default().push(pid);
        let stdout = child.stdout.take().unwrap();
        let app = app.clone();
        let key = key.clone();
        thread::spawn(move || {
            let mut pending: HashSet<String> = chunk.into_iter().collect();
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                let Ok(v) = serde_json::from_str::<Value>(&line) else { continue };
                let Some(id) = v.get("id").and_then(Value::as_str).map(String::from) else { continue };
                pending.remove(&id);
                let sizes = Some(estimate_sizes(&v));
                let _ = app.emit("video-size", SizeEvent { key: key.clone(), id, sizes });
            }
            let _ = child.wait();
            if let Some(pids) = app.state::<Downloads>().size_pids.lock().unwrap().get_mut(&key) {
                pids.retain(|p| *p != pid);
            }
            // Private / removed videos never produce a line.
            for id in pending {
                let _ = app.emit("video-size", SizeEvent { key: key.clone(), id, sizes: None });
            }
        });
    }
    Ok(())
}

#[tauri::command]
pub fn cancel_sizes(state: State<'_, Downloads>, key: String) {
    let pids = state.size_pids.lock().unwrap().remove(&key).unwrap_or_default();
    for pid in pids {
        kill_tree(pid);
    }
}

// ---------- Downloads ----------

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadArgs {
    id: String,
    url: String,
    dir: String,
    /// "video" | "audio"
    mode: String,
    /// Max video height; None = best available.
    quality: Option<u32>,
    playlist: bool,
    /// Playlist positions to fetch ("1,4,7"); None = the whole playlist.
    items: Option<String>,
    /// Number of videos that will be downloaded, for "3 of N" progress.
    count: Option<u32>,
    /// "off" | "file" (a `.srt` next to the video) | "embed" (inside the MP4).
    subs: Option<String>,
    /// Subtitle language code, e.g. "en".
    sub_lang: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(tag = "type", rename_all = "camelCase")]
enum DlEvent {
    Item { id: String, index: Option<u32>, count: Option<u32>, title: String },
    Progress { id: String, status: String, downloaded: f64, total: Option<f64>, speed: Option<f64>, eta: Option<f64> },
    Processing { id: String, step: String },
    Saved { id: String, path: String },
    Done { id: String, ok: bool, cancelled: bool, error: Option<String>, failures: u32 },
}

fn num(s: &str) -> Option<f64> {
    s.trim().parse::<f64>().ok().filter(|n| n.is_finite())
}

fn build_args(a: &DownloadArgs, ffmpeg: Option<&Path>) -> Result<Vec<String>, String> {
    let mut args: Vec<String> = [
        "--ignore-config",
        "--no-warnings",
        "--newline",
        "--progress",
        "--no-simulate",
        "--embed-metadata",
        "--progress-template",
        "download:FTP|%(progress.status)s|%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s",
        "--progress-template",
        "postprocess:FTPP|%(progress.postprocessor)s",
        "--print",
        "before_dl:FTITEM|%(playlist_index)s|%(n_entries)s|%(title)s",
        "--print",
        "after_move:FTSAVED|%(filepath)s",
        "-P",
    ]
    .iter()
    .map(|s| s.to_string())
    .collect();
    args.push(a.dir.clone());

    if a.playlist {
        args.extend(["--yes-playlist", "--ignore-errors", "-o"].map(String::from));
        args.push("%(playlist_title)s/%(playlist_index)03d - %(title)s.%(ext)s".into());
        if let Some(items) = &a.items {
            args.extend(["--playlist-items".into(), items.clone()]);
        }
    } else {
        args.extend(["--no-playlist", "-o", "%(title)s.%(ext)s"].map(String::from));
    }

    match (a.mode.as_str(), ffmpeg) {
        ("audio", Some(_)) => args.extend(
            ["-f", "ba/b", "-x", "--audio-format", "mp3", "--audio-quality", "0", "--embed-thumbnail"]
                .map(String::from),
        ),
        ("audio", None) => args.extend(["-f", "ba[ext=m4a]/ba"].map(String::from)),
        (_, Some(_)) => {
            let sort = match a.quality {
                Some(h) => format!("res:{h},ext:mp4:m4a"),
                None => "res,ext:mp4:m4a".into(),
            };
            args.extend(["-S".into(), sort, "--merge-output-format".into(), "mp4".into()]);
        }
        // YouTube no longer serves combined audio+video files, so every video
        // download has to merge two streams.
        (_, None) => return Err("Video downloads need FFmpeg. Install it and reopen FocusTube.".into()),
    }
    // Subtitles: manual ones are preferred, auto-generated ones fill in.
    let subs = a.subs.as_deref().unwrap_or("off");
    if a.mode == "video" && subs != "off" {
        let lang = a.sub_lang.clone().unwrap_or_else(|| "en".into());
        args.extend(["--write-subs", "--write-auto-subs", "--sub-langs"].map(String::from));
        // Exact code only: yt-dlp matches case-insensitively, and looser
        // patterns also pick up translated tracks such as "en-en".
        args.push(format!("^{}$", crate::subtitles::regex_escape(&lang)));
        if subs == "embed" {
            args.push("--embed-subs".into());
        } else if ffmpeg.is_some() {
            // SRT plays almost everywhere; VTT is kept when FFmpeg is missing.
            args.extend(["--convert-subs", "srt"].map(String::from));
        }
    }
    if let Some(dir) = ffmpeg {
        args.push("--ffmpeg-location".into());
        args.push(dir.to_string_lossy().into_owned());
    }
    args.push("--".into());
    args.push(a.url.clone());
    Ok(args)
}

fn kill_tree(pid: u32) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let _ = Command::new("taskkill")
            .args(["/T", "/F", "/PID", &pid.to_string()])
            .creation_flags(0x0800_0000)
            .status();
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = Command::new("kill").arg(pid.to_string()).status();
    }
}

#[tauri::command]
pub fn start_download(
    app: AppHandle,
    state: State<'_, Downloads>,
    args: DownloadArgs,
) -> Result<(), String> {
    let ffmpeg = ffmpeg_dir(&app);
    let mut child = ytdlp_cmd(&app)?
        .args(build_args(&args, ffmpeg.as_deref())?)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("Couldn't start yt-dlp: {e}"))?;
    let (id, playlist, count) = (args.id, args.playlist, args.count);
    state.pids.lock().unwrap().insert(id.clone(), child.id());

    let stderr = child.stderr.take().unwrap();
    let errors: Arc<Mutex<String>> = Arc::default();
    let err_sink = errors.clone();
    let err_thread = thread::spawn(move || {
        for line in BufReader::new(stderr).lines().map_while(Result::ok) {
            let mut e = err_sink.lock().unwrap();
            e.push_str(&line);
            e.push('\n');
        }
    });

    let stdout = child.stdout.take().unwrap();
    thread::spawn(move || {
        let emit = |ev: DlEvent| {
            let _ = app.emit("download-event", ev);
        };
        let mut last_progress = Instant::now() - Duration::from_secs(1);
        let mut started = 0u32;
        for line in BufReader::new(stdout).lines().map_while(Result::ok) {
            let parts: Vec<&str> = line.splitn(7, '|').collect();
            match parts.as_slice() {
                ["FTITEM", _index, n_entries, title @ ..] => {
                    started += 1;
                    emit(DlEvent::Item {
                        id: id.clone(),
                        index: playlist.then_some(started),
                        count: count.or_else(|| n_entries.parse().ok()),
                        title: title.join("|"),
                    })
                }
                ["FTP", status, downloaded, total, estimate, speed, eta] => {
                    let finished = *status == "finished";
                    if !finished && last_progress.elapsed() < Duration::from_millis(200) {
                        continue;
                    }
                    last_progress = Instant::now();
                    emit(DlEvent::Progress {
                        id: id.clone(),
                        status: status.to_string(),
                        downloaded: num(downloaded).unwrap_or(0.0),
                        total: num(total).or_else(|| num(estimate)),
                        speed: num(speed).filter(|s| *s > 0.0),
                        eta: num(eta),
                    });
                }
                ["FTPP", step] => emit(DlEvent::Processing { id: id.clone(), step: step.to_string() }),
                ["FTSAVED", path @ ..] => emit(DlEvent::Saved { id: id.clone(), path: path.join("|") }),
                _ => {}
            }
        }

        let ok = child.wait().map(|s| s.success()).unwrap_or(false);
        let _ = err_thread.join();
        let downloads = app.state::<Downloads>();
        downloads.pids.lock().unwrap().remove(&id);
        let cancelled = downloads.cancelled.lock().unwrap().remove(&id);
        let stderr = errors.lock().unwrap();
        let failures = stderr.lines().filter(|l| l.starts_with("ERROR:")).count() as u32;
        emit(DlEvent::Done {
            id: id.clone(),
            ok: ok && !cancelled,
            cancelled,
            error: (!ok && !cancelled).then(|| clean_error(&stderr)),
            failures,
        });
    });
    Ok(())
}

#[tauri::command]
pub fn cancel_download(state: State<'_, Downloads>, id: String) {
    let pid = state.pids.lock().unwrap().get(&id).copied();
    if let Some(pid) = pid {
        state.cancelled.lock().unwrap().insert(id);
        kill_tree(pid);
    }
}

/// Let the webview stream one user-chosen media file through the asset
/// protocol. The static scope is empty, so only files picked in the app (or
/// downloaded by it) are ever readable.
#[tauri::command]
pub fn allow_media(app: AppHandle, path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.is_file() {
        return Err("That file no longer exists.".into());
    }
    app.asset_protocol_scope()
        .allow_file(p)
        .map_err(|e| e.to_string())
}

/// Reveal a downloaded file (selected) or open a folder in the OS file manager.
#[tauri::command]
pub fn show_in_folder(path: String) -> Result<(), String> {
    let p = Path::new(&path);
    if !p.exists() {
        return Err("That file or folder no longer exists.".into());
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let mut cmd = Command::new("explorer");
        if p.is_file() {
            cmd.raw_arg(format!("/select,\"{path}\""));
        } else {
            cmd.arg(&path);
        }
        cmd.spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "macos")]
    {
        let mut cmd = Command::new("open");
        if p.is_file() {
            cmd.arg("-R");
        }
        cmd.arg(&path).spawn().map_err(|e| e.to_string())?;
    }
    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let dir = if p.is_file() { p.parent().unwrap_or(p) } else { p };
        Command::new("xdg-open").arg(dir).spawn().map_err(|e| e.to_string())?;
    }
    Ok(())
}
