import { useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-shell";
import { Icon, icons } from "./Icon";
import { langName } from "./captions";
import {
  OS_KEY_URL,
  OS_SIGNUP_URL,
  OsConfig,
  SubResult,
  osDownload,
  osGetConfig,
  osLogin,
  osLogout,
  osSaveBeside,
  osSaveKey,
  osSearch,
  queryFromFileName,
  resultTag,
} from "./subsearch";

const LANGS = ["en", "ar", "fr", "es", "de", "it", "pt-pt", "pt-br", "ru", "tr", "nl", "pl", "ro", "el", "he", "fa", "hi", "id", "ja", "ko", "zh-cn", "zh-tw", "sv", "da", "fi", "no", "cs", "hu", "uk", "vi"];

export type SubSearchSource = { kind: "file"; path: string } | { kind: "youtube"; title: string };

export default function SubtitleSearchPanel({
  source,
  defaultLang,
  onApply,
  onClose,
}: {
  source: SubSearchSource;
  defaultLang: string | null;
  /** Called with the downloaded subtitle text once the user picks one. */
  onApply: (text: string, label: string, lang: string) => void;
  onClose: () => void;
}) {
  const [cfg, setCfg] = useState<OsConfig | null>(null);
  const initialQuery =
    source.kind === "file" ? queryFromFileName(source.path.split(/[\\/]/).pop() ?? "") : source.title;
  const [query, setQuery] = useState(initialQuery);
  const [lang, setLang] = useState(() => {
    const l = (defaultLang ?? "en").toLowerCase();
    return LANGS.includes(l) ? l : l === "pt" ? "pt-br" : l === "zh" ? "zh-cn" : "en";
  });
  const [results, setResults] = useState<SubResult[] | null>(null);
  const [busy, setBusy] = useState<"search" | number | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saveBeside, setSaveBeside] = useState(true);
  const autoSearched = useRef(false);

  useEffect(() => {
    osGetConfig()
      .then(setCfg)
      .catch(() => setCfg({ hasKey: false, keyHint: "", username: "", signedIn: false }));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function search() {
    setBusy("search");
    setError("");
    try {
      setResults(
        await osSearch({
          query: query.trim() || undefined,
          path: source.kind === "file" ? source.path : undefined,
          languages: lang,
        })
      );
    } catch (e) {
      setError(String(e));
      setResults(null);
    } finally {
      setBusy(null);
    }
  }

  // Search straight away once a key is available: local files often match
  // exactly by their hash, so the right subtitle is usually the first row.
  useEffect(() => {
    if (cfg?.hasKey && !autoSearched.current && (query.trim() || source.kind === "file")) {
      autoSearched.current = true;
      search();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg?.hasKey]);

  async function use(r: SubResult) {
    setBusy(r.fileId);
    setError("");
    try {
      const d = await osDownload(r.fileId);
      const code = (r.language || lang).toLowerCase();
      const label = `${langName(code.split("-")[0])} · ${r.release || r.title || d.fileName}`.slice(0, 80);
      onApply(d.text, label, code);
      let msg = "Subtitles applied.";
      if (source.kind === "file" && saveBeside) {
        await osSaveBeside(source.path, code, d.text).then(
          () => (msg += " Saved next to the video, so they'll load automatically next time."),
          () => {}
        );
      }
      if (d.remaining != null) msg += ` ${d.remaining} downloads left today.`;
      setNotice(msg);
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="dl-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="dl-sheet ss-sheet" role="dialog" aria-label="Find subtitles">
        <header className="dl-head">
          <h2>Find subtitles</h2>
          <button className="iconbtn" onClick={onClose} title="Close (Esc)">
            <Icon d={icons.close} />
          </button>
        </header>

        <div className="dl-body">
          {!cfg ? (
            <div className="dl-center">
              <div className="spinner small" />
            </div>
          ) : !cfg.hasKey ? (
            <KeySetup onSaved={setCfg} />
          ) : (
            <>
              <form
                className="ss-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  search();
                }}
              >
                <div className="bar ss-query">
                  <Icon d={icons.search} size={14} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Movie or show, e.g. “Show Name S02E05”"
                    spellCheck={false}
                  />
                </div>
                <div className="ss-row">
                  <select className="dl-select" value={lang} onChange={(e) => setLang(e.target.value)}>
                    {LANGS.map((l) => (
                      <option key={l} value={l}>
                        {l.includes("-") ? `${langName(l.split("-")[0])} (${l.split("-")[1].toUpperCase()})` : langName(l)}
                      </option>
                    ))}
                  </select>
                  <button className="btn-primary" type="submit" disabled={busy !== null}>
                    {busy === "search" ? <span className="spinner tiny" /> : <Icon d={icons.search} size={14} />}
                    Search
                  </button>
                </div>
                {source.kind === "file" ? (
                  <label className="check ss-save">
                    <input type="checkbox" checked={saveBeside} onChange={(e) => setSaveBeside(e.target.checked)} />
                    <span>Save next to the video (loads automatically next time)</span>
                  </label>
                ) : (
                  <p className="dl-hint">
                    Subtitle sites mostly cover movies and TV episodes. For YouTube videos, the CC captions usually work
                    better.
                  </p>
                )}
              </form>

              {notice && (
                <p className="ai-status is-ok">
                  <Icon d={icons.check} size={13} /> {notice}
                </p>
              )}
              {error && <p className="ai-status is-error">{error}</p>}

              {results && results.length === 0 && !error && (
                <p className="dl-hint ss-empty">
                  Nothing found in {langName(lang.split("-")[0])}. Try a shorter title, add the year, or pick another
                  language.
                </p>
              )}

              {results && results.length > 0 && (
                <ul className="ss-results">
                  {results.map((r) => (
                    <li key={r.fileId} className={`ss-item ${r.exactMatch ? "is-exact" : ""}`}>
                      <div className="ss-main">
                        <div className="ss-title" title={r.release || r.fileName}>
                          {r.release || r.fileName || r.title}
                        </div>
                        <div className="ss-meta">
                          {r.exactMatch && <span className="ss-badge is-exact">Exact match</span>}
                          {r.trusted && <span className="ss-badge">Trusted</span>}
                          {r.hearingImpaired && <span className="ss-badge" title="Hearing impaired">HI</span>}
                          {r.machineTranslated && <span className="ss-badge is-warn">Machine-translated</span>}
                          <span>
                            {[r.title, resultTag(r), langName(r.language.split("-")[0]), `${r.downloads.toLocaleString()} downloads`]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </div>
                      </div>
                      <button className="menu-chip ss-use" onClick={() => use(r)} disabled={busy !== null}>
                        {busy === r.fileId ? <span className="spinner tiny" /> : "Use"}
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <Account cfg={cfg} onChange={setCfg} />
            </>
          )}
        </div>
      </aside>
    </div>
  );
}

function KeySetup({ onSaved }: { onSaved: (c: OsConfig) => void }) {
  const [key, setKey] = useState("");
  const [error, setError] = useState("");
  return (
    <section className="dl-card dl-setup">
      <div className="dl-setup-icon">
        <Icon d={icons.cc} size={20} />
      </div>
      <h3>Connect OpenSubtitles</h3>
      <p>
        Search millions of subtitles on <b>OpenSubtitles.com</b> and apply them in one click. It needs your own free API
        key: create an account, then add an API consumer to get the key.
      </p>
      <button className="linkbtn accent" onClick={() => open(OS_KEY_URL)}>
        Get a free API key →
      </button>
      <div className="bar dl-url ss-keybar">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="Paste your API key"
          autoComplete="off"
          spellCheck={false}
        />
      </div>
      <button
        className="btn-primary"
        disabled={!key.trim()}
        onClick={() =>
          osSaveKey(key)
            .then(onSaved)
            .catch((e) => setError(String(e)))
        }
      >
        Save key
      </button>
      {error && <p className="error">{error}</p>}
      <p className="ss-fine">The key is stored only on this computer and sent only to OpenSubtitles.</p>
    </section>
  );
}

function Account({ cfg, onChange }: { cfg: OsConfig; onChange: (c: OsConfig) => void }) {
  const [openForm, setOpenForm] = useState(false);
  const [user, setUser] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function login() {
    setBusy(true);
    setError("");
    try {
      onChange(await osLogin(user, pass));
      setOpenForm(false);
      setPass("");
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="ss-account">
      {cfg.signedIn ? (
        <div className="ss-account-row">
          <span>
            <Icon d={icons.check} size={12} /> Signed in as <b>{cfg.username}</b>
          </span>
          <button className="linkbtn" onClick={() => osLogout().then(onChange)}>
            Sign out
          </button>
        </div>
      ) : openForm ? (
        <form
          className="ss-login"
          onSubmit={(e) => {
            e.preventDefault();
            login();
          }}
        >
          <div className="bar dl-url">
            <input value={user} onChange={(e) => setUser(e.target.value)} placeholder="OpenSubtitles username" />
          </div>
          <div className="bar dl-url">
            <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} placeholder="Password" />
          </div>
          <div className="ss-row">
            <button className="menu-chip" type="button" onClick={() => setOpenForm(false)}>
              Cancel
            </button>
            <button className="btn-primary" type="submit" disabled={busy || !user.trim() || !pass}>
              {busy ? <span className="spinner tiny" /> : "Sign in"}
            </button>
          </div>
          {error && <p className="error">{error}</p>}
          <p className="ss-fine">
            Your password is only used to sign in and is never stored.{" "}
            <button type="button" className="linkbtn accent" onClick={() => open(OS_SIGNUP_URL)}>
              Create an account
            </button>
          </p>
        </form>
      ) : (
        <div className="ss-account-row">
          <span>Sign in for more downloads per day.</span>
          <button className="linkbtn accent" onClick={() => setOpenForm(true)}>
            Sign in
          </button>
        </div>
      )}
      <div className="ss-account-row ss-fine">
        <span>API key {cfg.keyHint}</span>
        <button className="linkbtn" onClick={() => osSaveKey("").then(onChange)}>
          Remove key
        </button>
      </div>
    </section>
  );
}
