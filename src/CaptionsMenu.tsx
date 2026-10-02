import { useEffect, useRef, useState } from "react";
import { Icon, icons } from "./Icon";
import { CaptionPrefs, Captions, Track, langName } from "./captions";

const TRANSLATE_LANGS = ["ar", "en", "fr", "es", "de", "it", "pt", "ru", "tr", "hi", "ja", "ko", "zh", "nl", "pl", "id"];

export type Translating = { lang: string; done: number; total: number; error?: string } | null;

const baseLang = (t: Track | null) => (t?.lang ? t.lang.split("-")[0] : null);

function TrackOptions({ tracks }: { tracks: Track[] }) {
  const manual = tracks.filter((t) => !t.auto);
  const auto = tracks.filter((t) => t.auto);
  const opt = (t: Track) => (
    <option key={t.id} value={t.id}>
      {t.label}
    </option>
  );
  if (!manual.length || !auto.length) return <>{tracks.map(opt)}</>;
  return (
    <>
      <optgroup label="Subtitles">{manual.map(opt)}</optgroup>
      <optgroup label="Auto-generated">{auto.map(opt)}</optgroup>
    </>
  );
}

export default function CaptionsMenu({
  captions: c,
  prefs,
  onPrefs,
  isFile,
  strip,
  onToggleStrip,
  onOpenTranscript,
  onLoadFile,
  onSetup,
  aiReady,
  translating,
  onTranslate,
  onOpenAiSettings,
  delay,
  onDelay,
  onFindOnline,
  onClose,
}: {
  delay: number;
  onDelay: (d: number) => void;
  onFindOnline: () => void;
  aiReady: boolean;
  translating: Translating;
  onTranslate: (lang: string) => void;
  onOpenAiSettings: () => void;
  captions: Captions;
  prefs: CaptionPrefs;
  onPrefs: (p: CaptionPrefs) => void;
  isFile: boolean;
  strip: boolean;
  onToggleStrip: () => void;
  onOpenTranscript: () => void;
  onLoadFile: () => void;
  onSetup: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const userLang = (navigator.language || "en").split("-")[0];
  const [target, setTarget] = useState(prefs.lang2 ?? (userLang !== "en" ? userLang : "ar"));
  const targetLangs = [target, ...TRANSLATE_LANGS.filter((l) => l !== target)];

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".cc-btn")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const set = (patch: Partial<CaptionPrefs>) => onPrefs({ ...prefs, ...patch });

  const statusLine =
    c.status === "loading"
      ? "Loading captions…"
      : c.status === "none"
        ? isFile
          ? "No subtitle file found next to this video."
          : "This video has no captions."
        : c.status === "error"
          ? c.error || "Couldn’t load captions."
          : null;

  return (
    <div className="menu captions-menu" ref={ref} role="menu">
      <div className="menu-section">
        <label className="menu-switch">
          <span>
            <b>Captions</b>
            <small>
              Press <kbd>C</kbd> to toggle
            </small>
          </span>
          <input
            type="checkbox"
            role="switch"
            checked={prefs.enabled}
            onChange={(e) => set({ enabled: e.target.checked })}
          />
        </label>

        {c.status === "needs-setup" ? (
          <div className="menu-note">
            YouTube captions use the downloader tools.
            <button className="linkbtn accent" onClick={onSetup}>
              Set up now
            </button>
          </div>
        ) : (
          statusLine && (
            <div className={`menu-note ${c.status === "error" ? "is-error" : ""}`}>
              {c.status === "loading" && <span className="spinner tiny" />}
              {statusLine}
            </div>
          )
        )}

        {c.tracks.length > 0 && (
          <>
            <label className="menu-field">
              <span>Language</span>
              <select
                className="dl-select"
                value={c.primary?.id ?? ""}
                onChange={(e) => {
                  const t = c.tracks.find((x) => x.id === e.target.value) ?? null;
                  c.setPrimaryId(t?.id ?? null);
                  set({ enabled: true, lang: baseLang(t) ?? prefs.lang });
                }}
              >
                <TrackOptions tracks={c.tracks} />
              </select>
            </label>
            <label className="menu-field">
              <span>Second language</span>
              <select
                className="dl-select"
                value={c.secondary?.id ?? ""}
                onChange={(e) => {
                  const t = c.tracks.find((x) => x.id === e.target.value) ?? null;
                  c.setSecondaryId(t?.id ?? null);
                  set({ lang2: baseLang(t) });
                }}
              >
                <option value="">Off</option>
                <TrackOptions tracks={c.tracks.filter((t) => t.id !== c.primary?.id)} />
              </select>
            </label>
          </>
        )}

        {c.cues.length > 0 && (
          <div className="menu-field">
            <span>
              AI translation <Icon d={icons.sparkle} size={11} />
            </span>
            {!aiReady ? (
              <div className="menu-note">
                Translate captions into any language with your own AI key.
                <button className="linkbtn accent" onClick={onOpenAiSettings}>
                  Add key
                </button>
              </div>
            ) : translating && !translating.error ? (
              <div className="ai-progress">
                <div className="progress">
                  <div
                    className="progress-fill"
                    style={{ width: `${translating.total ? (translating.done / translating.total) * 100 : 0}%` }}
                  />
                </div>
                <span>
                  Translating to {langName(translating.lang)}… {translating.done} / {translating.total} lines
                </span>
              </div>
            ) : (
              <>
                <div className="ai-translate-row">
                  <select className="dl-select" value={target} onChange={(e) => setTarget(e.target.value)}>
                    {targetLangs.map((l) => (
                      <option key={l} value={l}>
                        {langName(l)}
                      </option>
                    ))}
                  </select>
                  <button className="menu-chip" onClick={() => onTranslate(target)}>
                    Translate
                  </button>
                </div>
                {translating?.error && <div className="menu-note is-error">{translating.error}</div>}
              </>
            )}
          </div>
        )}

        {c.cues.length > 0 && (
          <div className="menu-field">
            <span>
              Timing <kbd>G</kbd> <kbd>H</kbd>
            </span>
            <div className="delay-row">
              <button className="menu-chip" onClick={() => onDelay(delay - 0.25)} title="Earlier (G)">
                −0.25s
              </button>
              <span className={`delay-value ${delay ? "is-set" : ""}`}>
                {delay === 0 ? "In sync" : `${delay > 0 ? "+" : ""}${delay.toFixed(2)}s`}
              </span>
              <button className="menu-chip" onClick={() => onDelay(delay + 0.25)} title="Later (H)">
                +0.25s
              </button>
              {delay !== 0 && (
                <button className="linkbtn" onClick={() => onDelay(0)}>
                  Reset
                </button>
              )}
            </div>
          </div>
        )}

        <button className="menu-chip" onClick={onFindOnline}>
          <Icon d={icons.search} size={14} /> Find subtitles online…
        </button>

        {isFile && (
          <button className="menu-chip" onClick={onLoadFile}>
            <Icon d={icons.folder} size={14} /> Load a subtitle file…
          </button>
        )}
      </div>

      <div className="menu-sep" />

      <div className="menu-section">
        <div className="menu-label">Style</div>
        <div className="menu-style-row">
          <div className="segmented">
            {(["s", "m", "l"] as const).map((s) => (
              <button key={s} className={prefs.size === s ? "is-on" : ""} onClick={() => set({ size: s })}>
                {s === "s" ? "Small" : s === "m" ? "Medium" : "Large"}
              </button>
            ))}
          </div>
        </div>
        <div className="menu-style-row">
          <div className="segmented">
            {(["bottom", "top"] as const).map((p) => (
              <button key={p} className={prefs.position === p ? "is-on" : ""} onClick={() => set({ position: p })}>
                {p === "bottom" ? "Bottom" : "Top"}
              </button>
            ))}
          </div>
          <label className="check">
            <input type="checkbox" checked={prefs.background} onChange={(e) => set({ background: e.target.checked })} />
            <span>Background</span>
          </label>
        </div>
      </div>

      <div className="menu-sep" />

      <button className="menu-item" onClick={onOpenTranscript} role="menuitem">
        <Icon d={icons.transcript} />
        <span>
          Transcript &amp; notes
          <small>Search, jump to any line, take notes</small>
        </span>
        <kbd>Shift+T</kbd>
      </button>
      <button className="menu-item" onClick={onToggleStrip} role="menuitem">
        <Icon d={icons.strip} />
        <span>
          {strip ? "Exit caption strip" : "Caption strip"}
          <small>Shrink to a thin bar of live captions</small>
        </span>
        <kbd>Shift+S</kbd>
      </button>
    </div>
  );
}
