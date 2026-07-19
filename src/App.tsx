import { useCallback, useEffect, useRef, useState } from "react";
import Player from "./Player";
import { parseVideoId } from "./youtube";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { register } from "@tauri-apps/plugin-global-shortcut";
import { open } from "@tauri-apps/plugin-shell";

const Icon = ({
  d,
  size = 16,
  fill = "none",
}: {
  d: string;
  size?: number;
  fill?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill={fill}
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={d} />
  </svg>
);

export default function App() {
  const [input, setInput] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [pinned, setPinned] = useState(true);
  const [opacity, setOpacity] = useState(1);
  const playerRef = useRef<any>(null);
  const appWindow = getCurrentWindow();
  const setPlayer = useCallback((p: any) => {
    playerRef.current = p;
  }, []);

  useEffect(() => {
    appWindow.setAlwaysOnTop(pinned);
  }, [pinned, appWindow]);

  useEffect(() => {
    const playPause = () => {
      const el = document.activeElement;
      if (el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA")) return;
      const p = playerRef.current;
      if (!p) return;
      if (p.getPlayerState() === 1) p.pauseVideo();
      else p.playVideo();
    };
    const nudge = (d: number) => nudgeOpacity(d);
    const fire = (fn: () => void) => (e: any) => {
      const st = typeof e === "string" ? "Pressed" : e?.state;
      if (st && st !== "Pressed") return;
      fn();
    };

    register("Space", fire(playPause)).catch(() => {});
    register("MediaPlayPause", fire(playPause)).catch(() => {});

    return () => {
      import("@tauri-apps/plugin-global-shortcut").then((m) => {
        m.unregister("Space").catch(() => {});
        m.unregister("MediaPlayPause").catch(() => {});
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleLoad() {
    const id = parseVideoId(input);
    if (!id) {
      setError("That doesn't look like a YouTube link.");
      return;
    }
    setError("");
    setVideoId(id);
  }

  function reset() {
    setVideoId(null);
    setInput("");
  }

  function changeOpacity(v: number) {
    setOpacity(v);
  }

  function nudgeOpacity(delta: number) {
    setOpacity((v) => Math.min(1, Math.max(0.2, Math.round((v + delta) * 100) / 100)));
  }

  return (
    <div className="app" style={{ opacity }}>
      <header className="titlebar">
        <div className="drag" data-tauri-drag-region />
        <div className="brand">
          <span className="logo">
            <svg viewBox="0 0 24 24" width="11" height="11" aria-hidden>
              <path d="M8 5v14l11-7z" fill="#fff" />
            </svg>
          </span>
          <span className="wordmark">FocusTube</span>
        </div>

        <div className="actions">
          <input
            className="opacity-slider"
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => changeOpacity(parseFloat(e.target.value))}
            title="Transparency"
          />
          <button
            className={`iconbtn ${pinned ? "is-active" : ""}`}
            onClick={() => setPinned((v) => !v)}
            title={pinned ? "On top: on" : "On top: off"}
          >
            <Icon d="M12 3l2 6h-4z M12 9v8 M9.5 12.5h5" />
          </button>
          {videoId && (
            <button className="iconbtn" onClick={reset} title="New video">
              <Icon d="M12 5v14M5 12h14" />
            </button>
          )}
          <button
            className="iconbtn"
            onClick={() => open("https://focustube.com")}
            title="More info — visit the FocusTube website"
          >
            <Icon d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3" />
          </button>
          <button
            className="iconbtn"
            onClick={() => appWindow.minimize()}
            title="Minimize"
          >
            <Icon d="M5 12h14" />
          </button>
          <button
            className="iconbtn danger"
            onClick={() => appWindow.close()}
            title="Close"
          >
            <Icon d="M6 6l12 12M18 6L6 18" />
          </button>
        </div>
      </header>

      <main className="content">
        {!videoId ? (
          <div className="empty">
            <div className="empty-glow" />
            <div className="empty-mark">
              <svg
                viewBox="0 0 24 24"
                width="26"
                height="26"
                fill="none"
                stroke="currentColor"
                strokeWidth={1.6}
                aria-hidden
              >
                <circle cx="12" cy="12" r="9" />
                <path d="M10 8.5v7l5.5-3.5z" fill="currentColor" stroke="none" />
              </svg>
            </div>
            <h1 className="empty-title">Paste a YouTube link</h1>
            <p className="empty-sub">
              Watch it in a clean, always-on-top window — no comments, no clutter.
            </p>

            <form
              className="bar"
              onSubmit={(e) => {
                e.preventDefault();
                handleLoad();
              }}
            >
              <Icon
                d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.5 1.5M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.5-1.5"
                size={16}
              />
              <input
                autoFocus
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="https://youtube.com/watch?v=…"
              />
              <button type="submit" className="bar-go">
                Load
              </button>
            </form>

            {error && <p className="error">{error}</p>}

            <p className="empty-hint">
              <kbd>↵</kbd> play · <kbd>Space</kbd> pause
            </p>
          </div>
        ) : (
          <Player videoId={videoId} onPlayer={setPlayer} />
        )}
      </main>
    </div>
  );
}
