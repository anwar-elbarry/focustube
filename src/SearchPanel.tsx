import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Icon, icons } from "./Icon";
import { formatDuration, getStatus } from "./downloads";
import { thumbUrl } from "./youtube";

export type SearchKind = "videos" | "music" | "playlists";

export type SearchItem = {
  kind: "video" | "playlist" | "song";
  id: string;
  title: string;
  channel: string | null;
  duration: number | null;
  views: number | null;
  thumb: string | null;
};

const PAGE = 20;
const RECENT_KEY = "focustube.recentSearches";
// Results per kind + query for this session: tab switches are instant.
const cache = new Map<string, SearchItem[]>();

function loadRecent(): string[] {
  try {
    const v = JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, 8)));
  } catch {
    /* ignore */
  }
}

const compact = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

export const itemUrl = (it: SearchItem) =>
  it.kind === "playlist"
    ? `https://www.youtube.com/playlist?list=${it.id}`
    : `https://www.youtube.com/watch?v=${it.id}`;

export default function SearchPanel({
  initialQuery,
  onPlay,
  onDownload,
  onSetup,
  onClose,
}: {
  initialQuery: string;
  onPlay: (item: SearchItem) => void;
  onDownload: (item: SearchItem) => void;
  onSetup: () => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState(initialQuery);
  const [submitted, setSubmitted] = useState(initialQuery.trim());
  const [kind, setKind] = useState<SearchKind>("videos");
  const [limit, setLimit] = useState(PAGE);
  const [items, setItems] = useState<SearchItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [ready, setReady] = useState<boolean | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [recent, setRecent] = useState<string[]>(loadRecent);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    getStatus()
      .then((s) => setReady(s.ytdlp))
      .catch(() => setReady(false));
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  useEffect(() => {
    const q = submitted;
    if (!q || !ready) return;
    const key = `${kind}|${q.toLowerCase()}|${limit}`;
    const hit = cache.get(key);
    if (hit) {
      setItems(hit);
      setError("");
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError("");
    if (limit === PAGE) setItems(null);
    invoke<SearchItem[]>("yt_search", { kind, query: q, limit })
      .then((r) => {
        if (cancelled) return;
        cache.set(key, r);
        setItems(r);
      })
      .catch((e) => !cancelled && setError(String(e)))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [submitted, kind, limit, ready, attempt]);

  function run(q: string) {
    const t = q.trim();
    if (!t) return;
    setQuery(t);
    setSubmitted(t);
    setLimit(PAGE);
    const next = [t, ...recent.filter((r) => r.toLowerCase() !== t.toLowerCase())].slice(0, 8);
    setRecent(next);
    saveRecent(next);
  }

  const showRecent = !submitted && recent.length > 0;
  const canLoadMore = !!items && items.length >= limit && limit < 100;

  return (
    <div className="dl-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="dl-sheet search-sheet" role="dialog" aria-label="Search YouTube">
        <header className="dl-head search-head">
          <form
            className="bar search-bar"
            onSubmit={(e) => {
              e.preventDefault();
              run(query);
            }}
          >
            <Icon d={icons.search} size={15} />
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search videos, music, playlists"
              spellCheck={false}
            />
            {query && (
              <button type="button" className="iconbtn" onClick={() => setQuery("")} title="Clear">
                <Icon d={icons.close} size={12} />
              </button>
            )}
          </form>
          <button className="iconbtn" onClick={onClose} title="Close (Esc)">
            <Icon d={icons.close} />
          </button>
        </header>

        <div className="search-tabs">
          <div className="segmented">
            {(
              [
                ["videos", "Videos", icons.video],
                ["music", "Music", icons.audio],
                ["playlists", "Playlists", icons.list],
              ] as const
            ).map(([k, label, icon]) => (
              <button
                key={k}
                className={kind === k ? "is-on" : ""}
                onClick={() => {
                  setKind(k);
                  setLimit(PAGE);
                }}
              >
                <Icon d={icon} size={14} />
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="search-body">
          {ready === false ? (
            <div className="tr-empty">
              <div className="dl-setup-icon">
                <Icon d={icons.search} size={20} />
              </div>
              <p>
                <b>Search needs the one-time downloader setup.</b>
                <br />
                Until then you can still paste any YouTube link.
              </p>
              <button className="btn-primary" onClick={onSetup}>
                Set up now
              </button>
            </div>
          ) : showRecent ? (
            <section className="search-recent">
              <div className="recent-head">
                <Icon d={icons.history} size={13} /> Recent searches
                <button
                  className="linkbtn"
                  onClick={() => {
                    setRecent([]);
                    saveRecent([]);
                  }}
                >
                  Clear
                </button>
              </div>
              {recent.map((r) => (
                <button key={r} className="search-recent-item" onClick={() => run(r)}>
                  <Icon d={icons.search} size={13} /> {r}
                </button>
              ))}
            </section>
          ) : !submitted ? (
            <div className="tr-empty">
              <p>Search YouTube without leaving FocusTube. Results open right here in the player.</p>
            </div>
          ) : error ? (
            <div className="tr-empty">
              <p className="error">{error}</p>
              <button className="menu-chip" onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
            </div>
          ) : !items ? (
            <ul className="search-list">
              {Array.from({ length: 6 }, (_, i) => (
                <li key={i} className="search-item is-skeleton">
                  <div className="search-thumb skeleton" />
                  <div className="search-text">
                    <div className="skeleton line" />
                    <div className="skeleton line short" />
                  </div>
                </li>
              ))}
            </ul>
          ) : items.length === 0 ? (
            <div className="tr-empty">
              <p>No {kind} found for “{submitted}”.</p>
            </div>
          ) : (
            <>
              <ul className="search-list">
                {items.map((it) => (
                  <li key={`${it.kind}-${it.id}`} className="search-item">
                    <button className="search-open" onClick={() => onPlay(it)} title={it.title}>
                      <span className={`search-thumb ${it.kind === "song" ? "is-square" : ""}`}>
                        <img
                          src={it.kind === "playlist" ? (it.thumb ?? "") : thumbUrl(it.id)}
                          alt=""
                          loading="lazy"
                        />
                        {it.kind === "playlist" ? (
                          <span className="dl-thumb-badge search-pl-badge">
                            <Icon d={icons.list} size={11} /> Playlist
                          </span>
                        ) : it.duration ? (
                          <span className="dl-thumb-badge">{formatDuration(it.duration)}</span>
                        ) : null}
                        <span className="search-play">
                          <Icon d={icons.play} size={18} fill="currentColor" />
                        </span>
                      </span>
                      <span className="search-text">
                        <span className="search-title">{it.title}</span>
                        <span className="search-sub">
                          {[it.channel, it.views != null ? `${compact.format(it.views)} views` : null]
                            .filter(Boolean)
                            .join(" · ")}
                        </span>
                      </span>
                    </button>
                    <button
                      className="iconbtn search-dl"
                      onClick={() => onDownload(it)}
                      title={it.kind === "song" ? "Download as audio" : "Download"}
                    >
                      <Icon d={icons.download} size={14} />
                    </button>
                  </li>
                ))}
              </ul>
              {canLoadMore && (
                <button className="menu-chip search-more" disabled={loading} onClick={() => setLimit((l) => l + PAGE)}>
                  {loading ? <span className="spinner tiny" /> : "Load more"}
                </button>
              )}
            </>
          )}
        </div>
      </aside>
    </div>
  );
}
