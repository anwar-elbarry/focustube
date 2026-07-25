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

  return (
    <div className="app" style={{ opacity }}>
      <header className="titlebar">
        <div className="drag" data-tauri-drag-region />
        <div className="brand">
          <span className="logo" title="FocusTube">
            <svg viewBox="0 0 512 512" width="20" height="20" aria-hidden="true">
              <rect x="24" y="24" width="464" height="464" rx="104" fill="#141318" />
              <rect x="24.5" y="24.5" width="463" height="463" rx="103.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.25" strokeWidth="3" />
              <g stroke="#FFFFFF" strokeWidth="26" strokeLinecap="round" strokeLinejoin="round" fill="none">
                <path d="M 110 160 L 110 110 L 160 110" />
                <path d="M 352 110 L 402 110 L 402 160" />
                <path d="M 110 352 L 110 402 L 160 402" />
                <path d="M 402 352 L 402 402 L 352 402" />
              </g>
              <circle cx="110" cy="110" r="7" fill="#FF6A3D" />
              <circle cx="402" cy="110" r="7" fill="#FF6A3D" />
              <circle cx="110" cy="402" r="7" fill="#FF6A3D" />
              <circle cx="402" cy="402" r="7" fill="#FF6A3D" />
              <path d="M 214 180 C 214 171.5 223.3 166.3 230.5 170.7 L 338.5 246.7 C 345.5 251 345.5 261 338.5 265.3 L 230.5 341.3 C 223.3 345.7 214 340.5 214 332 Z" fill="#FF6A3D" />
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
            onClick={() => open("https://focustube-puce.vercel.app")}
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
            className="iconbtn iconbtn-close"
            onClick={() => appWindow.close()}
            title="Close"
          >
            <Icon d="M18 6L6 18M6 6l12 12" />
          </button>
        </div>
      </header>

      <main className="content">
        {!videoId ? (
          <div className="empty">
            <div className="empty-glow" />
            <div className="empty-mark">
              <svg viewBox="0 0 512 512" width="48" height="48" aria-hidden="true">
                <rect x="24" y="24" width="464" height="464" rx="104" fill="#141318" />
                <rect x="24.5" y="24.5" width="463" height="463" rx="103.5" fill="none" stroke="#FFFFFF" strokeOpacity="0.25" strokeWidth="3" />
                <g stroke="#FFFFFF" strokeWidth="24" strokeLinecap="round" strokeLinejoin="round" fill="none">
                  <path d="M 104 156 L 104 104 L 156 104" />
                  <path d="M 356 104 L 408 104 L 408 156" />
                  <path d="M 104 356 L 104 408 L 168 408" />
                  <path d="M 408 356 L 408 408 L 356 408" />
                </g>
                <circle cx="104" cy="104" r="7" fill="#FF6A3D" />
                <circle cx="408" cy="104" r="7" fill="#FF6A3D" />
                <circle cx="104" cy="408" r="7" fill="#FF6A3D" />
                <circle cx="408" cy="408" r="7" fill="#FF6A3D" />
                <path d="M 214 180 C 214 171.5 223.3 166.3 230.5 170.7 L 338.5 246.7 C 345.5 251 345.5 261 338.5 265.3 L 230.5 341.3 C 223.3 345.7 214 340.5 214 332 Z" fill="#FF6A3D" />
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
