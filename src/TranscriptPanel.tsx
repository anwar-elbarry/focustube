import { useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Icon, icons } from "./Icon";
import { Captions, formatStamp, lastStartedIndex } from "./captions";
import { notesToMarkdown, useNotes } from "./notes";
import { askVideo, summarize } from "./ai";
import AiMarkdown from "./AiMarkdown";

type QA = { q: string; a: string | null; error?: string };
// Per-video results for this session, so reopening the panel costs nothing.
const aiCache = new Map<string, { summary?: string; qa: QA[] }>();

function AiTab({
  cacheKey,
  title,
  captions: c,
  ready,
  onOpenSettings,
  onSeek,
  onSetup,
}: {
  cacheKey: string | null;
  title: string;
  captions: Captions;
  ready: boolean;
  onOpenSettings: () => void;
  onSeek: (t: number) => void;
  onSetup: () => void;
}) {
  const key = cacheKey ?? "";
  const cached = aiCache.get(key);
  const [summary, setSummary] = useState<string | undefined>(cached?.summary);
  const [qa, setQa] = useState<QA[]>(cached?.qa ?? []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");

  useEffect(() => {
    aiCache.set(key, { summary, qa });
  }, [key, summary, qa]);

  if (!ready) {
    return (
      <div className="tr-empty">
        <div className="dl-setup-icon">
          <Icon d={icons.sparkle} size={20} />
        </div>
        <p>
          <b>Summaries and answers with your own AI key.</b>
          <br />
          Connect Claude, OpenAI, Gemini, OpenRouter or a local model. Nothing is sent anywhere until you do.
        </p>
        <button className="btn-primary" onClick={onOpenSettings}>
          Add your API key
        </button>
      </div>
    );
  }

  if (!c.cues.length) {
    return (
      <div className="tr-empty">
        {c.status === "needs-setup" ? (
          <>
            <p>AI features read the video’s captions, which need the downloader tools.</p>
            <button className="btn-primary" onClick={onSetup}>
              Set up now
            </button>
          </>
        ) : c.status === "loading" ? (
          <>
            <div className="spinner small" />
            <p>Loading the transcript…</p>
          </>
        ) : (
          <p>AI features need captions, and this video has none.</p>
        )}
      </div>
    );
  }

  async function doSummary() {
    setBusy(true);
    setError("");
    try {
      setSummary(await summarize(c.cues, title));
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  }

  async function ask() {
    const q = question.trim();
    if (!q || busy) return;
    setQuestion("");
    setBusy(true);
    setQa((list) => [...list, { q, a: null }]);
    try {
      const a = await askVideo(c.cues, title, q);
      setQa((list) => list.map((x, i) => (i === list.length - 1 ? { q, a } : x)));
    } catch (e) {
      setQa((list) => list.map((x, i) => (i === list.length - 1 ? { q, a: null, error: String(e) } : x)));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ai-tab">
      <div className="ai-scroll">
        {summary ? (
          <section className="ai-card">
            <div className="ai-card-head">
              <span>Summary</span>
              <button className="linkbtn" onClick={doSummary} disabled={busy}>
                Regenerate
              </button>
            </div>
            <AiMarkdown text={summary} onSeek={onSeek} />
          </section>
        ) : (
          <button className="ai-summarize" onClick={doSummary} disabled={busy}>
            {busy && !qa.some((x) => x.a === null && !x.error) ? (
              <>
                <span className="spinner tiny" /> Summarizing…
              </>
            ) : (
              <>
                <Icon d={icons.sparkle} size={16} /> Summarize this video
              </>
            )}
          </button>
        )}
        {error && <p className="error">{error}</p>}

        {qa.map((x, i) => (
          <section className="ai-card" key={i}>
            <div className="ai-q">{x.q}</div>
            {x.a ? (
              <AiMarkdown text={x.a} onSeek={onSeek} />
            ) : x.error ? (
              <p className="error">{x.error}</p>
            ) : (
              <p className="ai-thinking">
                <span className="spinner tiny" /> Thinking…
              </p>
            )}
          </section>
        ))}
      </div>

      <form
        className="ai-ask"
        onSubmit={(e) => {
          e.preventDefault();
          ask();
        }}
      >
        <div className="bar">
          <input
            value={question}
            onChange={(e) => setQuestion(e.target.value)}
            placeholder="Ask about this video…"
            disabled={busy}
          />
          <button type="submit" className="bar-go" disabled={busy || !question.trim()}>
            Ask
          </button>
        </div>
      </form>
    </div>
  );
}

function Highlight({ text, query }: { text: string; query: string }) {
  if (!query) return <>{text}</>;
  const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "ig"));
  return (
    <>
      {parts.map((p, i) => (i % 2 ? <mark key={i}>{p}</mark> : p))}
    </>
  );
}

export default function TranscriptPanel({
  captions: c,
  time,
  notesKey,
  title,
  url,
  onSeek,
  onSetup,
  aiReady,
  onOpenAiSettings,
  onClose,
}: {
  aiReady: boolean;
  onOpenAiSettings: () => void;
  captions: Captions;
  time: number;
  /** "v:<videoId>" | "f:<path>" */
  notesKey: string | null;
  title: string;
  /** Video URL for note links; null for local files. */
  url: string | null;
  onSeek: (t: number) => void;
  onSetup: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"transcript" | "notes" | "ai">("transcript");
  const [query, setQuery] = useState("");
  const [follow, setFollow] = useState(true);
  const [exported, setExported] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const activeRef = useRef<HTMLLIElement>(null);
  const notes = useNotes(notesKey, title, url);

  const current = lastStartedIndex(c.cues, time);
  const q = query.trim().toLowerCase();
  const rows = useMemo(
    () => c.cues.map((cue, i) => ({ cue, i })).filter(({ cue }) => !q || cue.text.toLowerCase().includes(q)),
    [c.cues, q]
  );

  // Follow playback, unless the user is searching or scrolled away.
  useEffect(() => {
    if (tab === "transcript" && follow && !q) activeRef.current?.scrollIntoView({ block: "center" });
  }, [current, follow, q, tab]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function exportNotes() {
    const safe = title.replace(/[\\/:*?"<>|]+/g, " ").trim().slice(0, 80) || "FocusTube";
    const path = await saveDialog({
      title: "Export notes",
      defaultPath: `${safe} - notes.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    });
    if (!path) return;
    try {
      await invoke("write_text_file", { path, contents: notesToMarkdown(title, url, notes.notes) });
      setExported("Saved");
    } catch (e) {
      setExported(String(e));
    }
    setTimeout(() => setExported(""), 2500);
  }

  const body =
    c.status === "needs-setup" ? (
      <div className="tr-empty">
        <p>Transcripts for YouTube videos use the downloader tools.</p>
        <button className="btn-primary" onClick={onSetup}>
          Set up now
        </button>
      </div>
    ) : c.status === "loading" && !c.cues.length ? (
      <div className="tr-empty">
        <div className="spinner small" />
        <p>Loading transcript…</p>
      </div>
    ) : !c.cues.length ? (
      <div className="tr-empty">
        <p>{c.status === "error" ? c.error || "Couldn’t load the transcript." : "No transcript for this video."}</p>
      </div>
    ) : (
      <ul
        className="tr-list"
        ref={listRef}
        onWheel={() => setFollow(false)}
        onTouchMove={() => setFollow(false)}
      >
        {rows.map(({ cue, i }) => (
          <li
            key={i}
            ref={i === current ? activeRef : undefined}
            className={`tr-row ${i === current ? "is-current" : ""} ${i < current ? "is-past" : ""}`}
          >
            <button className="tr-time" onClick={() => onSeek(cue.start)}>
              {formatStamp(cue.start)}
            </button>
            <button className="tr-text" onClick={() => onSeek(cue.start)}>
              <Highlight text={cue.text} query={query.trim()} />
            </button>
            <button
              className="iconbtn tr-note-btn"
              title="Add to notes"
              onClick={() => {
                notes.add(cue.start, cue.text);
                setTab("notes");
              }}
            >
              <Icon d={icons.bookmark} size={13} />
            </button>
          </li>
        ))}
        {!rows.length && <li className="tr-none">No lines match “{query}”.</li>}
      </ul>
    );

  return (
    <div className="dl-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="dl-sheet tr-sheet" role="dialog" aria-label="Transcript and notes">
        <header className="dl-head">
          <div className="segmented tr-tabs">
            <button className={tab === "transcript" ? "is-on" : ""} onClick={() => setTab("transcript")}>
              Transcript
            </button>
            <button className={tab === "notes" ? "is-on" : ""} onClick={() => setTab("notes")}>
              Notes{notes.notes.length ? ` (${notes.notes.length})` : ""}
            </button>
            <button className={tab === "ai" ? "is-on" : ""} onClick={() => setTab("ai")}>
              AI
            </button>
          </div>
          <button className="iconbtn" onClick={onClose} title="Close (Esc)">
            <Icon d={icons.close} />
          </button>
        </header>

        {tab === "ai" ? (
          <AiTab
            cacheKey={notesKey}
            title={title}
            captions={c}
            ready={aiReady}
            onOpenSettings={onOpenAiSettings}
            onSeek={onSeek}
            onSetup={onSetup}
          />
        ) : tab === "transcript" ? (
          <>
            {c.cues.length > 0 && (
              <div className="tr-tools">
                <div className="bar tr-search">
                  <Icon d={icons.search} size={14} />
                  <input
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search the transcript"
                    spellCheck={false}
                  />
                  {query && (
                    <button className="iconbtn" onClick={() => setQuery("")} title="Clear">
                      <Icon d={icons.close} size={12} />
                    </button>
                  )}
                </div>
                {q ? (
                  <span className="tr-count">{rows.length} found</span>
                ) : (
                  !follow && (
                    <button className="linkbtn accent" onClick={() => setFollow(true)}>
                      Follow video
                    </button>
                  )
                )}
              </div>
            )}
            {body}
          </>
        ) : (
          <div className="tr-notes">
            {notes.notes.length === 0 ? (
              <div className="tr-empty">
                <p>
                  No notes yet. Hover a transcript line and press <Icon d={icons.bookmark} size={12} /> to save
                  it with its timestamp, or add one at the current moment.
                </p>
              </div>
            ) : (
              <ul className="note-list">
                {notes.notes.map((n) => (
                  <li key={n.id} className="note">
                    <div className="note-head">
                      <button className="tr-time" onClick={() => onSeek(n.t)}>
                        {formatStamp(n.t)}
                      </button>
                      {n.quote && <span className="note-quote">{n.quote}</span>}
                      <button className="iconbtn" title="Delete note" onClick={() => notes.remove(n.id)}>
                        <Icon d={icons.trash} size={13} />
                      </button>
                    </div>
                    <textarea
                      className="note-text"
                      value={n.text}
                      placeholder="Your note…"
                      rows={2}
                      onChange={(e) => notes.update(n.id, e.target.value)}
                    />
                  </li>
                ))}
              </ul>
            )}
            <footer className="note-foot">
              <button
                className="menu-chip"
                onClick={() => {
                  const i = lastStartedIndex(c.cues, time);
                  notes.add(time, i >= 0 ? c.cues[i].text : "");
                }}
              >
                <Icon d={icons.note} size={14} /> Note at {formatStamp(time)}
              </button>
              <button className="menu-chip" disabled={!notes.notes.length} onClick={exportNotes}>
                <Icon d={icons.download} size={14} /> {exported || "Export .md"}
              </button>
            </footer>
          </div>
        )}
      </aside>
    </div>
  );
}
