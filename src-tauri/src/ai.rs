//! Bring-your-own-key AI: each user connects their own provider account.
//! Keys live in the app's config folder and never leave the Rust side except
//! in requests to the provider the user chose.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

const ANTHROPIC_VERSION: &str = "2023-06-01";
// Server-side refusal fallback for current Claude models: if a safety
// classifier declines, Anthropic re-runs the request on another model.
const FALLBACK_BETA: &str = "server-side-fallback-2026-07-01";
const FALLBACK_MODELS: [&str; 5] = [
    "claude-fable-5-1",
    "claude-opus-5-5",
    "claude-opus-5",
    "claude-sonnet-5-5",
    "claude-mythos-5-1",
];

#[derive(Serialize, Deserialize, Default, Clone)]
#[serde(rename_all = "camelCase")]
struct Stored {
    provider: String,
    model: String,
    /// Only used by the "custom" provider (Ollama, LM Studio, Groq, …).
    base_url: String,
    /// One key per provider, so switching back and forth keeps them.
    keys: HashMap<String, String>,
}

/// What the page is allowed to see: never the keys themselves.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PublicConfig {
    provider: String,
    model: String,
    base_url: String,
    /// Provider → masked key ("sk-…a1b2").
    key_hints: HashMap<String, String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnectionArgs {
    provider: String,
    model: Option<String>,
    base_url: Option<String>,
    /// None = use the stored key; Some("") = remove it.
    api_key: Option<String>,
}

#[derive(Serialize)]
pub struct ModelInfo {
    id: String,
    name: String,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_config_dir().map_err(|e| e.to_string())?.join("ai.json"))
}

fn load(app: &AppHandle) -> Stored {
    config_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn store(app: &AppHandle, cfg: &Stored) -> Result<(), String> {
    let path = config_path(app)?;
    if let Some(dir) = path.parent() {
        fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    }
    fs::write(&path, serde_json::to_vec_pretty(cfg).map_err(|e| e.to_string())?)
        .map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let _ = fs::set_permissions(&path, fs::Permissions::from_mode(0o600));
    }
    Ok(())
}

fn mask(key: &str) -> String {
    let k: Vec<char> = key.chars().collect();
    if k.len() <= 8 {
        return "••••".into();
    }
    let head: String = k[..k.len().min(4)].iter().collect();
    let tail: String = k[k.len() - 4..].iter().collect();
    format!("{head}…{tail}")
}

fn base_url(provider: &str, custom: &str) -> Result<String, String> {
    Ok(match provider {
        "anthropic" => "https://api.anthropic.com/v1".into(),
        "openai" => "https://api.openai.com/v1".into(),
        "gemini" => "https://generativelanguage.googleapis.com/v1beta/openai".into(),
        "openrouter" => "https://openrouter.ai/api/v1".into(),
        "custom" => {
            let u = custom.trim().trim_end_matches('/');
            if !(u.starts_with("http://") || u.starts_with("https://")) {
                return Err("Enter the server address, e.g. http://localhost:11434/v1".into());
            }
            u.to_string()
        }
        other => return Err(format!("Unknown provider: {other}")),
    })
}

fn client() -> Result<reqwest::blocking::Client, String> {
    reqwest::blocking::Client::builder()
        .user_agent("FocusTube")
        // Long transcripts on large models can take a while.
        .timeout(Duration::from_secs(600))
        .build()
        .map_err(|e| e.to_string())
}

/// A short, human message from any provider's error body.
fn provider_error(status: reqwest::StatusCode, body: &str) -> String {
    let v: Value = serde_json::from_str(body).unwrap_or(Value::Null);
    let obj = if v.is_array() { v.get(0).cloned().unwrap_or(Value::Null) } else { v };
    let msg = obj
        .pointer("/error/message")
        .or_else(|| obj.get("message"))
        .and_then(Value::as_str)
        .map(String::from);
    let hint = match status.as_u16() {
        401 | 403 => "The API key was rejected. Check it in AI settings.",
        402 => "Your provider account needs billing set up or more credit.",
        404 => "That model wasn't found. Pick another one in AI settings.",
        429 => "Rate limit or quota reached. Try again in a moment.",
        500..=599 => "The AI provider is having trouble. Try again shortly.",
        _ => "",
    };
    match (msg, hint) {
        (Some(m), "") => m,
        (Some(m), h) => format!("{h} ({m})"),
        (None, "") => format!("Request failed ({status})"),
        (None, h) => h.to_string(),
    }
}

struct Conn {
    provider: String,
    model: String,
    base: String,
    key: Option<String>,
}

fn resolve(app: &AppHandle, args: Option<ConnectionArgs>) -> Result<Conn, String> {
    let saved = load(app);
    let (provider, model, custom, key) = match args {
        Some(a) => {
            let key = match a.api_key {
                Some(k) if !k.trim().is_empty() => Some(k.trim().to_string()),
                Some(_) => None,
                None => saved.keys.get(&a.provider).cloned(),
            };
            (
                a.provider,
                a.model.unwrap_or_default(),
                a.base_url.unwrap_or(saved.base_url.clone()),
                key,
            )
        }
        None => {
            let key = saved.keys.get(&saved.provider).cloned();
            (saved.provider, saved.model, saved.base_url, key)
        }
    };
    if provider.is_empty() {
        return Err("Add your AI provider and key in AI settings first.".into());
    }
    // Local servers (Ollama, LM Studio) usually need no key.
    if key.is_none() && provider != "custom" {
        return Err("Add your API key in AI settings first.".into());
    }
    Ok(Conn { base: base_url(&provider, &custom)?, provider, model, key })
}

fn complete(conn: &Conn, system: &str, prompt: &str) -> Result<String, String> {
    if conn.model.trim().is_empty() {
        return Err("Choose a model in AI settings first.".into());
    }
    let http = client()?;

    if conn.provider == "anthropic" {
        let mut body = json!({
            "model": conn.model,
            "max_tokens": 16000,
            "system": system,
            "messages": [{ "role": "user", "content": prompt }],
        });
        let mut req = http
            .post(format!("{}/messages", conn.base))
            .header("x-api-key", conn.key.as_deref().unwrap_or(""))
            .header("anthropic-version", ANTHROPIC_VERSION);
        if FALLBACK_MODELS.contains(&conn.model.as_str()) {
            body["fallbacks"] = json!("default");
            req = req.header("anthropic-beta", FALLBACK_BETA);
        }
        let res = req.json(&body).send().map_err(|e| format!("Couldn't reach Anthropic: {e}"))?;
        let status = res.status();
        let text = res.text().map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(provider_error(status, &text));
        }
        let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        if v.get("stop_reason").and_then(Value::as_str) == Some("refusal") {
            return Err("The model declined this request.".into());
        }
        let out: String = v
            .get("content")
            .and_then(Value::as_array)
            .map(|blocks| {
                blocks
                    .iter()
                    .filter(|b| b.get("type").and_then(Value::as_str) == Some("text"))
                    .filter_map(|b| b.get("text").and_then(Value::as_str))
                    .collect::<Vec<_>>()
                    .join("")
            })
            .unwrap_or_default();
        return if out.trim().is_empty() { Err("The model returned an empty answer.".into()) } else { Ok(out) };
    }

    // OpenAI-compatible: OpenAI, Gemini, OpenRouter, Ollama, LM Studio, Groq, …
    let mut req = http.post(format!("{}/chat/completions", conn.base)).json(&json!({
        "model": conn.model,
        "messages": [
            { "role": "system", "content": system },
            { "role": "user", "content": prompt },
        ],
    }));
    if let Some(k) = &conn.key {
        req = req.bearer_auth(k);
    }
    if conn.provider == "openrouter" {
        req = req.header("X-Title", "FocusTube");
    }
    let res = req.send().map_err(|e| format!("Couldn't reach the AI provider: {e}"))?;
    let status = res.status();
    let text = res.text().map_err(|e| e.to_string())?;
    if !status.is_success() {
        return Err(provider_error(status, &text));
    }
    let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
    let out = v
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    if out.trim().is_empty() {
        Err("The model returned an empty answer.".into())
    } else {
        Ok(out)
    }
}

// ---------- Commands ----------

#[tauri::command]
pub fn ai_get_config(app: AppHandle) -> PublicConfig {
    let s = load(&app);
    PublicConfig {
        provider: s.provider,
        model: s.model,
        base_url: s.base_url,
        key_hints: s.keys.iter().map(|(p, k)| (p.clone(), mask(k))).collect(),
    }
}

#[tauri::command]
pub fn ai_save_config(app: AppHandle, args: ConnectionArgs) -> Result<PublicConfig, String> {
    let mut s = load(&app);
    s.provider = args.provider.clone();
    s.model = args.model.unwrap_or_default().trim().to_string();
    if let Some(u) = args.base_url {
        s.base_url = u.trim().to_string();
    }
    match args.api_key {
        Some(k) if k.trim().is_empty() => {
            s.keys.remove(&args.provider);
        }
        Some(k) => {
            s.keys.insert(args.provider.clone(), k.trim().to_string());
        }
        None => {}
    }
    store(&app, &s)?;
    Ok(ai_get_config(app))
}

/// Turn AI features off and forget every stored key.
#[tauri::command]
pub fn ai_forget(app: AppHandle) -> Result<(), String> {
    let path = config_path(&app)?;
    if path.exists() {
        fs::remove_file(path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn ai_list_models(app: AppHandle, args: ConnectionArgs) -> Result<Vec<ModelInfo>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = resolve(&app, Some(args))?;
        let http = client()?;
        let req = if conn.provider == "anthropic" {
            http.get(format!("{}/models?limit=100", conn.base))
                .header("x-api-key", conn.key.as_deref().unwrap_or(""))
                .header("anthropic-version", ANTHROPIC_VERSION)
        } else {
            let r = http.get(format!("{}/models", conn.base));
            match &conn.key {
                Some(k) => r.bearer_auth(k),
                None => r,
            }
        };
        let res = req.send().map_err(|e| format!("Couldn't reach the provider: {e}"))?;
        let status = res.status();
        let text = res.text().map_err(|e| e.to_string())?;
        if !status.is_success() {
            return Err(provider_error(status, &text));
        }
        let v: Value = serde_json::from_str(&text).map_err(|e| e.to_string())?;
        let list = v
            .get("data")
            .or_else(|| v.get("models"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut models: Vec<ModelInfo> = list
            .iter()
            .filter_map(|m| {
                // Gemini's compatible endpoint prefixes ids with "models/".
                let id = m.get("id").and_then(Value::as_str)?.trim_start_matches("models/").to_string();
                let name = m
                    .get("display_name")
                    .or_else(|| m.get("name"))
                    .and_then(Value::as_str)
                    .map(|n| n.trim_start_matches("models/").to_string())
                    .unwrap_or_else(|| id.clone());
                Some(ModelInfo { id, name })
            })
            .collect();
        models.sort_by(|a, b| a.id.cmp(&b.id));
        models.dedup_by(|a, b| a.id == b.id);
        Ok(models)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// A tiny request to check the key and model work.
#[tauri::command]
pub async fn ai_test(app: AppHandle, args: ConnectionArgs) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = resolve(&app, Some(args))?;
        complete(&conn, "You are a connection test.", "Reply with the single word: OK")
            .map(|t| t.trim().chars().take(40).collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Run one prompt with the saved provider, model and key.
#[tauri::command]
pub async fn ai_complete(app: AppHandle, system: String, prompt: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let conn = resolve(&app, None)?;
        complete(&conn, &system, &prompt)
    })
    .await
    .map_err(|e| e.to_string())?
}
