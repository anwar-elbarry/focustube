import { useEffect, useRef, useState } from "react";

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

export default function Player({
  videoId,
  onPlayer,
}: {
  videoId: string;
  onPlayer?: (player: any) => void;
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
    loadYouTubeAPI()
      .then(() => {
        if (cancelled || !containerRef.current) return;
        playerRef.current = new window.YT.Player(containerRef.current, {
          videoId,
          playerVars: {
            rel: 0,
            modestbranding: 1,
            controls: 1,
            iv_load_policy: 3,
            fs: 0,
          },
          events: {
            onReady: () => {
              if (cancelled) return;
              setStatus("ready");
              onPlayer?.(playerRef.current);
            },
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
      playerRef.current?.destroy?.();
      playerRef.current = null;
    };
  }, [videoId, attempt, onPlayer]);

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
