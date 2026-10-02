import { useEffect, useRef, useState } from "react";
import { getHistoryItem, historyKey, recordHistory, resumable } from "./history";

declare global {
  interface Window {
    YT: any;
    onYouTubeIframeAPIReady: () => void;
  }
}

let apiReady: Promise<void> | null = null;

function loadYouTubeAPI(): Promise<void> {
  if (apiReady) return apiReady;
  apiReady = new Promise((resolve, reject) => {
    if (window.YT && window.YT.Player) {
      resolve();
      return;
    }
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.onerror = () => reject(new Error("failed to load YouTube API"));
    window.onYouTubeIframeAPIReady = () => resolve();
    document.head.appendChild(tag);
  });
  return apiReady;
}

export type PlaylistState = { ids: string[]; index: number };

export default function Player({
  videoId,
  listId,
  onPlayer,
  onPlaylist,
  onResume,
}: {
  videoId: string | null;
  listId?: string | null;
  onPlayer?: (player: any) => void;
  /** Fired whenever the playlist or the position in it changes. */
  onPlaylist?: (state: PlaylistState) => void;
  /** Fired when playback picks up from a saved position (seconds). */
  onResume?: (position: number) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading"
  );
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    // The IFrame API's playlist is the source of truth for order and
    // position; it only becomes available some time after load.
    const reportPlaylist = () => {
      const p = playerRef.current;
      const ids: string[] | null = p?.getPlaylist?.();
      if (cancelled || !ids?.length) return;
      onPlaylist?.({ ids, index: p.getPlaylistIndex() });
    };

    // ---- Continue where you left off ----
    const key = historyKey({ videoId, listId });
    const saved = getHistoryItem(key);
    const canResume = !!saved && resumable(saved.position, saved.duration);
    // A link to a specific video inside a playlist wins over the saved spot.
    const resumeList =
      !!listId && !!saved && saved.index != null && (!videoId || saved.videoId === videoId) &&
      (saved.index > 0 || canResume);
    const resumeVideo = !listId && canResume;
    let started = false;

    const save = () => {
      const p = playerRef.current;
      const data = p?.getVideoData?.();
      if (!data?.video_id) return;
      const ended = p.getPlayerState?.() === 0;
      recordHistory({
        key,
        kind: listId ? "playlist" : "video",
        videoId: data.video_id,
        listId: listId ?? null,
        path: null,
        title: data.title || "YouTube video",
        channel: data.author || null,
        position: ended ? 0 : p.getCurrentTime?.() ?? 0,
        duration: p.getDuration?.() || null,
        index: listId ? (p.getPlaylistIndex?.() ?? null) : null,
        count: listId ? (p.getPlaylist?.()?.length ?? null) : null,
      });
    };
    const saveTimer = setInterval(() => {
      if (playerRef.current?.getPlayerState?.() === 1) save();
    }, 5000);
    const onStateChange = (e: { data: number }) => {
      reportPlaylist();
      // Only record once something has actually played, so a saved
      // position is never overwritten by the 0:00 of a fresh load.
      if (e.data === 1) started = true;
      if (started && (e.data === 0 || e.data === 1 || e.data === 2)) save();
    };

    loadYouTubeAPI()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        playerRef.current = new window.YT.Player(containerRef.current, {
          ...(videoId ? { videoId } : {}),
          playerVars: {
            rel: 0,
            modestbranding: 1,
            controls: 1,
            iv_load_policy: 3,
            fs: 0,
            ...(listId ? { listType: "playlist", list: listId } : {}),
            ...(resumeVideo ? { start: Math.floor(saved!.position) } : {}),
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              setStatus("ready");
              onPlayer?.(playerRef.current);
              reportPlaylist();
              if (resumeList) {
                playerRef.current.cuePlaylist({
                  listType: "playlist",
                  list: listId,
                  index: saved!.index,
                  startSeconds: canResume ? Math.floor(saved!.position) : 0,
                });
              }
              if ((resumeVideo || resumeList) && canResume) onResume?.(saved!.position);
            },
            onStateChange,
            onError: () => {
              if (!cancelled) setStatus("error");
            },
          },
        });
      })
      .catch(() => {
        if (!cancelled) setStatus("error");
      });
    return () => {
      cancelled = true;
      clearInterval(saveTimer);
      if (started) save();
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [videoId, listId, attempt, onPlayer, onPlaylist, onResume]);

  return (
    <div className="player-wrap">
      <div className="player" ref={containerRef} />
      {status !== "ready" && (
        <div className={`player-loading ${status === "error" ? "error" : ""}`}>
          {status === "error" ? (
            <>
              <p className="label">Couldn’t load this video.</p>
              <button className="retry" onClick={() => setAttempt((a) => a + 1)}>
                Try again
              </button>
            </>
          ) : (
            <>
              <div className="spinner" />
              <p className="label">Loading video…</p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
