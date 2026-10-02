import { useEffect, useRef, useState } from "react";
import { Icon, icons } from "./Icon";
import { PlaylistEntry, fetchInfo, formatDuration, getStatus } from "./downloads";
import { thumbUrl } from "./youtube";
import type { PlaylistState } from "./Player";

type Meta = { title: string | null; entries: Map<string, PlaylistEntry> };

// Titles are fetched once per playlist per session.
const metaCache = new Map<string, Promise<Meta | null>>();

function loadMeta(listId: string): Promise<Meta | null> {
  let p = metaCache.get(listId);
  if (!p) {
    p = getStatus()
      .then((s) => (s.ytdlp ? fetchInfo(`https://www.youtube.com/playlist?list=${listId}`) : null))
      .then((info) =>
        info?.kind === "playlist"
          ? { title: info.title, entries: new Map(info.entries.map((e) => [e.id, e])) }
          : null
      )
      .catch(() => null);
    metaCache.set(listId, p);
    p.then((m) => m || metaCache.delete(listId));
  }
  return p;
}

export default function PlaylistPanel({
  listId,
  playlist,
  onPlayAt,
  onPrev,
  onNext,
  onClose,
}: {
  listId: string;
  playlist: PlaylistState;
  onPlayAt: (index: number) => void;
  onPrev: () => void;
  onNext: () => void;
  onClose: () => void;
}) {
  const [meta, setMeta] = useState<Meta | null | undefined>(undefined);
  const currentRef = useRef<HTMLLIElement>(null);

  useEffect(() => {
    let cancelled = false;
    loadMeta(listId).then((m) => !cancelled && setMeta(m));
    return () => {
      cancelled = true;
    };
  }, [listId]);

  useEffect(() => {
    currentRef.current?.scrollIntoView({ block: "nearest" });
  }, [playlist.index]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { ids, index } = playlist;

  return (
    <div className="dl-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="dl-sheet" role="dialog" aria-label="Playlist">
        <header className="dl-head">
          <div className="pl-head-text">
            <h2 title={meta?.title ?? undefined}>{meta?.title ?? "Playlist"}</h2>
            <small>
              {index + 1} / {ids.length}
            </small>
          </div>
          <div className="pl-head-actions">
            <button className="iconbtn" onClick={onPrev} disabled={index <= 0} title="Previous (Shift+P)">
              <Icon d={icons.prev} />
            </button>
            <button
              className="iconbtn"
              onClick={onNext}
              disabled={index >= ids.length - 1}
              title="Next (Shift+N)"
            >
              <Icon d={icons.next} />
            </button>
            <button className="iconbtn" onClick={onClose} title="Close (Esc)">
              <Icon d={icons.close} />
            </button>
          </div>
        </header>

        <ul className="pl-list">
          {ids.map((id, i) => {
            const entry = meta?.entries.get(id);
            const current = i === index;
            return (
              <li key={`${id}-${i}`} ref={current ? currentRef : undefined}>
                <button
                  className={`pl-item ${current ? "is-current" : ""}`}
                  onClick={() => onPlayAt(i)}
                  aria-current={current}
                >
                  <span className="pl-num">{current ? <Icon d={icons.play} size={11} fill="currentColor" /> : i + 1}</span>
                  <span className="pl-item-thumb">
                    <img src={thumbUrl(id)} alt="" loading="lazy" />
                    {entry?.duration ? <span className="dl-thumb-badge">{formatDuration(entry.duration)}</span> : null}
                  </span>
                  <span className="pl-text">
                    <span className="pl-title">
                      {entry?.title ?? (meta === undefined ? "" : `Video ${i + 1}`)}
                      {meta === undefined && <span className="skeleton line" />}
                    </span>
                    {current && <span className="pl-meta pl-now">Now playing</span>}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
        {meta === null && (
          <p className="dl-hint pl-foot">Set up downloads (the ↓ button) to see video titles here.</p>
        )}
      </aside>
    </div>
  );
}
