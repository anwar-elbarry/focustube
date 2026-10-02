import { useEffect, useRef } from "react";
import { Icon, icons } from "./Icon";
import { PRESETS, Preset, TimerState, formatClock } from "./focusTimer";
import type { UpdateInfo } from "./updates";

export const SPEEDS = [0.75, 1, 1.25, 1.5, 2];

const mod = /Mac/i.test(navigator.platform) ? "⌘" : "Ctrl";

export default function MoreMenu({
  speed,
  onSpeed,
  mini,
  onToggleMini,
  onClickThrough,
  timer,
  onStartTimer,
  onPauseTimer,
  onSkipTimer,
  onStopTimer,
  onOpenFile,
  update,
  onCheckUpdate,
  onOpenUpdate,
  onWebsite,
  aiReady,
  onOpenAi,
  onClose,
}: {
  speed: number;
  onSpeed: (s: number) => void;
  mini: boolean;
  onToggleMini: () => void;
  onClickThrough: () => void;
  timer: TimerState | null;
  onStartTimer: (p: Preset) => void;
  onPauseTimer: () => void;
  onSkipTimer: () => void;
  onStopTimer: () => void;
  onOpenFile: () => void;
  update: UpdateInfo | null;
  onCheckUpdate: () => void;
  onOpenUpdate: () => void;
  onWebsite: () => void;
  aiReady: boolean;
  onOpenAi: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node) && !(e.target as Element).closest?.(".more-btn")) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const act = (fn: () => void) => () => {
    fn();
    onClose();
  };

  return (
    <div className="menu" ref={ref} role="menu">
      <div className="menu-section">
        <div className="menu-label">
          Playback speed <kbd>Shift</kbd>+<kbd>&lt;</kbd> <kbd>&gt;</kbd>
        </div>
        <div className="segmented menu-speeds">
          {SPEEDS.map((s) => (
            <button key={s} className={s === speed ? "is-on" : ""} onClick={() => onSpeed(s)}>
              {s}×
            </button>
          ))}
        </div>
      </div>

      <div className="menu-sep" />

      <button className="menu-item" onClick={act(onToggleMini)} role="menuitem">
        <Icon d={mini ? icons.expand : icons.mini} />
        <span>{mini ? "Exit mini player" : "Mini player"}</span>
        <kbd>{mod}+M</kbd>
      </button>
      <button className="menu-item" onClick={act(onClickThrough)} role="menuitem">
        <Icon d={icons.pointer} />
        <span>
          Click-through
          <small>Clicks pass to the window behind</small>
        </span>
        <kbd>{mod}+Alt+C</kbd>
      </button>
      <button className="menu-item" onClick={act(onOpenAi)} role="menuitem">
        <Icon d={icons.sparkle} />
        <span>
          AI features
          <small>{aiReady ? "Connected with your key" : "Use your own API key"}</small>
        </span>
      </button>
      <button className="menu-item" onClick={act(onOpenFile)} role="menuitem">
        <Icon d={icons.folder} />
        <span>Open a file…</span>
        <kbd>{mod}+O</kbd>
      </button>

      <div className="menu-sep" />

      <div className="menu-section">
        <div className="menu-label">Focus timer</div>
        {timer ? (
          <div className="menu-timer">
            <span className={`timer-dot is-${timer.phase}`} />
            <span className="menu-timer-text">
              {timer.phase === "focus" ? "Focus" : "Break"} · {formatClock(timer.remaining)}
              {timer.paused && " (paused)"}
            </span>
            <button className="linkbtn" onClick={onPauseTimer}>
              {timer.paused ? "Resume" : "Pause"}
            </button>
            <button className="linkbtn" onClick={onSkipTimer}>
              Skip
            </button>
            <button className="linkbtn" onClick={act(onStopTimer)}>
              Stop
            </button>
          </div>
        ) : (
          <div className="menu-presets">
            {PRESETS.map((p) => (
              <button key={p.label} className="menu-chip" onClick={act(() => onStartTimer(p))}>
                <Icon d={icons.timer} size={14} />
                {p.label} min
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="menu-sep" />

      {update ? (
        <button className="menu-item is-accent" onClick={act(onOpenUpdate)} role="menuitem">
          <Icon d={icons.download} />
          <span>
            Update to {update.latest}
            <small>You have {update.current}</small>
          </span>
        </button>
      ) : (
        <button className="menu-item" onClick={act(onCheckUpdate)} role="menuitem">
          <Icon d={icons.retry} />
          <span>Check for updates</span>
        </button>
      )}
      <button className="menu-item" onClick={act(onWebsite)} role="menuitem">
        <Icon d={icons.external} />
        <span>FocusTube website</span>
      </button>
    </div>
  );
}
