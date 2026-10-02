import { useCallback, useEffect, useRef, useState } from "react";
import Player, { PlaylistState } from "./Player";
import LocalPlayer, { fileName } from "./LocalPlayer";
import DownloadPanel from "./DownloadPanel";
import PlaylistPanel from "./PlaylistPanel";
import MoreMenu, { SPEEDS } from "./MoreMenu";
import CaptionsMenu, { Translating } from "./CaptionsMenu";
import AiSettingsPanel from "./AiSettingsPanel";
import SubtitleSearchPanel from "./SubtitleSearchPanel";
import SearchPanel, { SearchItem, itemUrl } from "./SearchPanel";
import type { Mode } from "./downloads";
import { translateCues, useAiConfig } from "./ai";
import CaptionOverlay from "./CaptionOverlay";
import TranscriptPanel from "./TranscriptPanel";
import { Icon, icons } from "./Icon";
import { formatDuration, getStatus, isActive, useDownloads } from "./downloads";
import {
  CaptionPrefs,
  CaptionSource,
  Cue,
  langName,
  loadCaptionPrefs,
  parseSubtitles,
  saveCaptionPrefs,
  useCaptions,
  usePlayerTime,
} from "./captions";
import { HistoryItem, loadHistory, removeHistory } from "./history";
import { chime, formatClock, useFocusTimer } from "./focusTimer";
import { checkForUpdate, useUpdateCheck } from "./updates";
import { parsePlaylistId, parseVideoId, thumbUrl } from "./youtube";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { register, unregister } from "@tauri-apps/plugin-global-shortcut";
import { open } from "@tauri-apps/plugin-shell";
import { open as openDialog } from "@tauri-apps/plugin-dialog";

const SITE = "https://focustube-puce.vercel.app";
const CLICK_THROUGH_KEY = "CommandOrControl+Alt+C";
const MEDIA_EXTS = ["mp4", "webm", "mkv", "mov", "m4v", "mp3", "m4a", "aac", "ogg", "opus", "wav", "flac"];
// 16:9 at the window's minimum height.
const MINI = { width: 427, height: 240, margin: 16 };
const MIN_SIZE = { width: 320, height: 240 };
// YouTube's embed rules require a visible player of at least 200×200, so a
// YouTube strip keeps the video beside the captions; local files can go thin.
const STRIP = { youtubeHeight: 200, youtubeMinWidth: 760, fileHeight: 96, fileMinWidth: 560 };

// AI translations made this session, keyed by video + track + language, so
// switching back and forth never pays for the same translation twice.
const translationCache = new Map<string, Cue[]>();

type Toast = {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
};

export default function App() {
  const [input, setInput] = useState("");
  const [videoId, setVideoId] = useState<string | null>(null);
  const [listId, setListId] = useState<string | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [playlist, setPlaylist] = useState<PlaylistState | null>(null);
  const [error, setError] = useState("");
  const [pinned, setPinned] = useState(true);
  const [opacity, setOpacity] = useState(1);
  const [sheet, setSheet] = useState<
    "downloads" | "playlist" | "transcript" | "ai" | "subsearch" | "search" | null
  >(null);
  /** What the search panel opens with. */
  const [searchSeed, setSearchSeed] = useState("");
  /** Set when the download panel is opened from a search result. */
  const [dlSeed, setDlSeed] = useState<{ url: string; mode?: Mode } | null>(null);
  /** Subtitle timing adjustment in seconds; positive = captions appear later. */
  const [subDelay, setSubDelay] = useState(0);
  const [translating, setTranslating] = useState<Translating>(null);
  const ai = useAiConfig();
  const [menuOpen, setMenuOpen] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [mini, setMini] = useState(false);
  const [clickThrough, setClickThrough] = useState(false);
  const [toast, setToast] = useState<Toast | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(loadHistory);
  const [update, setUpdate] = useUpdateCheck();
  const [capPrefs, setCapPrefsState] = useState<CaptionPrefs>(loadCaptionPrefs);
  const [capMenuOpen, setCapMenuOpen] = useState(false);
  const [strip, setStrip] = useState(false);
  const [toolsReady, setToolsReady] = useState(false);

  const downloads = useDownloads();
  const activeDownloads = downloads.jobs.filter(isActive).length;
  const playerRef = useRef<any>(null);
  const speedRef = useRef(1);
  const savedBounds = useRef<{ pos: PhysicalPosition; size: PhysicalSize } | null>(null);
  const appWindow = getCurrentWindow();
  const hasSource = !!(videoId || listId || filePath);
  const hasPlaylist = !!listId && !!playlist && playlist.ids.length > 1;

  // ---------- Captions ----------
  // The video actually playing (inside a playlist it changes as you go).
  const currentVideoId = playlist ? (playlist.ids[playlist.index] ?? videoId) : videoId;
  const capSource: CaptionSource = filePath
    ? { kind: "file", path: filePath }
    : currentVideoId
      ? { kind: "youtube", videoId: currentVideoId }
      : null;
  const capActive = capPrefs.enabled || sheet === "transcript" || strip;
  const captions = useCaptions(capSource, capActive, toolsReady, capPrefs);
  const time = usePlayerTime(playerRef, capActive && hasSource);
  const setCapPrefs = (p: CaptionPrefs) => {
    setCapPrefsState(p);
    saveCaptionPrefs(p);
  };

  const capSourceKey = filePath ?? currentVideoId ?? "";
  useEffect(() => {
    setTranslating(null);
    setSubDelay(0);
  }, [capSourceKey]);
  // The clock captions are matched against, after the timing adjustment.
  const capTime = time - subDelay;

  // yt-dlp may get installed from the downloads panel at any time.
  useEffect(() => {
    getStatus()
      .then((s) => setToolsReady(s.ytdlp))
      .catch(() => {});
  }, [sheet]);

  // ---------- Toasts ----------
  const toastTimer = useRef<number>();
  const showToast = useCallback((text: string, action?: Toast["action"], ms = 3500) => {
    window.clearTimeout(toastTimer.current);
    setToast({ id: Date.now(), text, action });
    if (ms > 0) toastTimer.current = window.setTimeout(() => setToast(null), ms);
  }, []);

  // ---------- Player wiring ----------
  const setPlayer = useCallback((p: any) => {
    playerRef.current = p;
    p?.setPlaybackRate?.(speedRef.current);
  }, []);

  const onResume = useCallback(
    (pos: number) =>
      showToast(`Resumed at ${formatDuration(pos)}`, {
        label: "Start over",
        run: () => playerRef.current?.seekTo?.(0, true),
      }),
    [showToast]
  );

  // YouTube can reset the rate when a playlist moves to the next video.
  useEffect(() => {
    playerRef.current?.setPlaybackRate?.(speedRef.current);
  }, [playlist?.index]);

  useEffect(() => {
    appWindow.setAlwaysOnTop(pinned);
  }, [pinned, appWindow]);

  useEffect(() => {
    const refresh = () => setHistory(loadHistory());
    window.addEventListener("focustube-history", refresh);
    return () => window.removeEventListener("focustube-history", refresh);
  }, []);

  useEffect(() => {
    if (update) {
      showToast(`FocusTube ${update.latest} is available`, { label: "Download", run: () => open(update.url) }, 0);
    }
  }, [update, showToast]);

  // ---------- Actions ----------
  function changeSpeed(s: number) {
    speedRef.current = s;
    setSpeed(s);
    playerRef.current?.setPlaybackRate?.(s);
    showToast(`Speed ${s}×`, undefined, 1200);
  }

  function stepSpeed(dir: 1 | -1) {
    const i = SPEEDS.indexOf(speedRef.current);
    const next = SPEEDS[Math.min(Math.max((i < 0 ? 1 : i) + dir, 0), SPEEDS.length - 1)];
    if (next !== speedRef.current) changeSpeed(next);
  }

  function playYouTube(vid: string | null, list: string | null, url: string) {
    setFilePath(null);
    setPlaylist(null);
    setVideoId(vid);
    setListId(list);
    setInput(url);
    setError("");
    setSheet(null);
  }

  function handleLoad() {
    const id = parseVideoId(input);
    const list = parsePlaylistId(input);
    if (!id && !list) {
      // Not a link: treat it as a search.
      if (input.trim()) openSearch(input.trim());
      else setError("Paste a YouTube link or type something to search.");
      return;
    }
    playYouTube(id, list, input);
  }

  function openSearch(seed = "") {
    setMenuOpen(false);
    setCapMenuOpen(false);
    setSearchSeed(seed);
    setSheet("search");
  }

  function playSearchResult(it: SearchItem) {
    const url = itemUrl(it);
    if (it.kind === "playlist") playYouTube(null, it.id, url);
    else playYouTube(it.id, null, url);
  }

  function downloadSearchResult(it: SearchItem) {
    setDlSeed({ url: itemUrl(it), mode: it.kind === "song" ? "audio" : undefined });
    setSheet("downloads");
  }

  function playFile(path: string) {
    setVideoId(null);
    setListId(null);
    setPlaylist(null);
    setFilePath(path);
    setInput("");
    setSheet(null);
  }

  async function openFile() {
    const picked = await openDialog({
      multiple: false,
      title: "Open a video or audio file",
      filters: [{ name: "Video & audio", extensions: MEDIA_EXTS }],
    });
    if (typeof picked === "string") playFile(picked);
  }

  function openRecent(item: HistoryItem) {
    if (item.kind === "file" && item.path) playFile(item.path);
    else if (item.kind === "playlist" && item.listId)
      playYouTube(null, item.listId, `https://www.youtube.com/playlist?list=${item.listId}`);
    else if (item.videoId) playYouTube(item.videoId, null, `https://www.youtube.com/watch?v=${item.videoId}`);
  }

  function reset() {
    if (strip) toggleStrip();
    setVideoId(null);
    setListId(null);
    setFilePath(null);
    setPlaylist(null);
    setSheet(null);
    setInput("");
  }

  async function restoreBounds() {
    const saved = savedBounds.current;
    savedBounds.current = null;
    if (saved) {
      await appWindow.setSize(saved.size);
      await appWindow.setPosition(saved.pos);
    }
  }

  async function toggleStrip() {
    if (strip) {
      await restoreBounds();
      await appWindow.setMinSize(new LogicalSize(MIN_SIZE.width, MIN_SIZE.height));
      setStrip(false);
      return;
    }
    if (!hasSource) return;
    const [pos, size, scale] = await Promise.all([
      appWindow.outerPosition(),
      appWindow.outerSize(),
      appWindow.scaleFactor(),
    ]);
    // Coming from mini mode, keep the original (pre-mini) bounds.
    if (!mini || !savedBounds.current) savedBounds.current = { pos, size };
    const isFile = !!filePath;
    const h = isFile ? STRIP.fileHeight : STRIP.youtubeHeight;
    const minW = isFile ? STRIP.fileMinWidth : STRIP.youtubeMinWidth;
    await appWindow.setMinSize(new LogicalSize(MIN_SIZE.width, Math.min(h, MIN_SIZE.height)));
    await appWindow.setSize(new PhysicalSize(Math.max(size.width, Math.round(minW * scale)), Math.round(h * scale)));
    setMini(false);
    setSheet(null);
    setCapMenuOpen(false);
    setMenuOpen(false);
    setPinned(true);
    if (!capPrefs.enabled) setCapPrefs({ ...capPrefs, enabled: true });
    setStrip(true);
  }

  async function toggleMini() {
    if (strip) {
      await toggleStrip();
      return;
    }
    if (!mini) {
      const [pos, size, monitor, scale] = await Promise.all([
        appWindow.outerPosition(),
        appWindow.outerSize(),
        currentMonitor(),
        appWindow.scaleFactor(),
      ]);
      savedBounds.current = { pos, size };
      const w = Math.round(MINI.width * scale);
      const h = Math.round(MINI.height * scale);
      const m = Math.round(MINI.margin * scale);
      await appWindow.setSize(new PhysicalSize(w, h));
      if (monitor) {
        // Keep clear of the taskbar / dock when the work area is known.
        const area = (monitor as any).workArea ?? { position: monitor.position, size: monitor.size };
        await appWindow.setPosition(
          new PhysicalPosition(
            area.position.x + area.size.width - w - m,
            area.position.y + area.size.height - h - m
          )
        );
      }
      setPinned(true);
      setSheet(null);
      setMini(true);
    } else {
      await restoreBounds();
      setMini(false);
    }
  }

  async function loadSubtitleFile() {
    const picked = await openDialog({
      multiple: false,
      title: "Load a subtitle file",
      filters: [{ name: "Subtitles", extensions: ["srt", "vtt"] }],
    });
    if (typeof picked === "string") {
      captions.addFile(picked);
      if (!capPrefs.enabled) setCapPrefs({ ...capPrefs, enabled: true });
    }
  }

  async function translateCaptions(lang: string) {
    const source = captions.primary;
    if (!source || !captions.cues.length) return;
    const videoKey = filePath ?? currentVideoId ?? "";
    const cacheKey = `${videoKey}|${source.id}|${lang}`;
    const track = (cues: Cue[]) => ({
      id: `ai:${lang}`,
      lang,
      label: `${langName(lang)} (AI)`,
      auto: true,
      cues,
    });
    const hit = translationCache.get(cacheKey);
    if (hit) {
      captions.addGenerated(track(hit));
      return;
    }
    setTranslating({ lang, done: 0, total: captions.cues.length });
    try {
      const cues = await translateCues(captions.cues, lang, (done, total) =>
        setTranslating({ lang, done, total })
      );
      translationCache.set(cacheKey, cues);
      captions.addGenerated(track(cues));
      setCapPrefs({ ...capPrefs, enabled: true, lang2: lang });
      setTranslating(null);
      showToast(`${langName(lang)} captions ready — shown under the original.`);
    } catch (e) {
      setTranslating({ lang, done: 0, total: 0, error: String(e) });
    }
  }

  function applyFoundSubtitles(text: string, label: string, lang: string) {
    const cues = parseSubtitles(text);
    if (!cues.length) {
      showToast("That subtitle file couldn't be read.");
      return;
    }
    captions.addGenerated({ id: `os:${label}`, lang, label, auto: false, cues }, "primary");
    setSubDelay(0);
    if (!capPrefs.enabled) setCapPrefs({ ...capPrefs, enabled: true });
  }

  function openSubtitleSearch() {
    setCapMenuOpen(false);
    setMenuOpen(false);
    setSheet("subsearch");
  }

  function changeDelay(next: number) {
    const d = Math.round(next * 100) / 100;
    setSubDelay(d);
    showToast(d === 0 ? "Subtitle timing reset" : `Subtitles ${d > 0 ? "later" : "earlier"} by ${Math.abs(d).toFixed(2)}s`, undefined, 1500);
  }

  function openAiSettings() {
    setCapMenuOpen(false);
    setMenuOpen(false);
    setSheet("ai");
  }

  function openTranscript() {
    setCapMenuOpen(false);
    setSheet((s) => (s === "transcript" ? null : "transcript"));
  }

  const setClickThroughMode = useCallback(
    async (on: boolean) => {
      await appWindow.setIgnoreCursorEvents(on);
      setClickThrough(on);
      setMenuOpen(false);
      if (on) {
        // The window can't be clicked any more, so a global shortcut is the
        // way back. It's only registered while click-through is on.
        await register(CLICK_THROUGH_KEY, (e: any) => {
          if (e?.state === "Pressed") setClickThroughRef.current(false);
        }).catch(() => {});
        showToast("Click-through on — press Ctrl+Alt+C to turn it off", undefined, 5000);
      } else {
        await unregister(CLICK_THROUGH_KEY).catch(() => {});
        showToast("Click-through off", undefined, 1500);
      }
    },
    [appWindow, showToast]
  );
  const setClickThroughRef = useRef(setClickThroughMode);
  setClickThroughRef.current = setClickThroughMode;

  // ---------- Focus timer ----------
  const focus = useFocusTimer((next, preset) => {
    chime();
    if (next === "break") {
      playerRef.current?.pauseVideo?.();
      showToast(`Break time — ${preset.break} min. Video paused.`, undefined, 8000);
    } else {
      showToast(
        "Break's over — back to focus.",
        { label: "Resume video", run: () => playerRef.current?.playVideo?.() },
        10000
      );
    }
  });

  async function manualUpdateCheck() {
    try {
      const u = await checkForUpdate();
      if (u) setUpdate(u);
      else showToast("You're on the latest version.");
    } catch {
      showToast("Couldn't check for updates right now.");
    }
  }

  // ---------- Keyboard ----------
  // Handlers read the latest state through this ref.
  const toggleCaptions = () => setCapPrefs({ ...capPrefs, enabled: !capPrefs.enabled });
  const keyActions = {
    toggleMini,
    openFile,
    stepSpeed,
    setClickThroughMode,
    clickThrough,
    toggleCaptions,
    openTranscript,
    toggleStrip,
    hasSource,
    subDelay,
    changeDelay,
    openSearch,
  };
  const actions = useRef(keyActions);
  actions.current = keyActions;

  useEffect(() => {
    const playPause = () => {
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

    // Space is handled only while the window is focused; registering it as a
    // global shortcut would swallow Space system-wide in every other app.
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const a = actions.current;
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && !e.shiftKey && !e.altKey && e.code === "KeyK") {
        e.preventDefault();
        a.openSearch();
        return;
      }
      if (ctrl && !e.shiftKey && e.code === "KeyO") {
        e.preventDefault();
        a.openFile();
        return;
      }
      if (ctrl && !e.shiftKey && !e.altKey && e.code === "KeyM") {
        e.preventDefault();
        a.toggleMini();
        return;
      }

      const el = e.target as HTMLElement | null;
      const isTextField =
        el?.tagName === "TEXTAREA" ||
        el?.isContentEditable ||
        (el?.tagName === "INPUT" && (el as HTMLInputElement).type !== "range");
      if (isTextField) return;
      // AltGr arrives as Ctrl+Alt on Windows; AltGr+C types a letter on
      // some layouts, so it must not trigger click-through.
      if (ctrl && e.altKey && e.code === "KeyC" && !e.getModifierState("AltGraph")) {
        e.preventDefault();
        a.setClickThroughMode(!a.clickThrough);
        return;
      }
      // YouTube's own shortcuts: Shift+N / Shift+P, Shift+> / Shift+<.
      // Captions: C (like YouTube), Shift+T transcript, Shift+S strip.
      if (a.hasSource && !ctrl && !e.altKey) {
        if (!e.shiftKey && e.code === "KeyC") {
          e.preventDefault();
          a.toggleCaptions();
          return;
        }
        if (e.shiftKey && e.code === "KeyT") {
          e.preventDefault();
          a.openTranscript();
          return;
        }
        if (e.shiftKey && e.code === "KeyS") {
          e.preventDefault();
          a.toggleStrip();
          return;
        }
        // Subtitle timing, like VLC: G = earlier, H = later.
        if (!e.shiftKey && (e.code === "KeyG" || e.code === "KeyH")) {
          e.preventDefault();
          a.changeDelay(a.subDelay + (e.code === "KeyH" ? 0.25 : -0.25));
          return;
        }
      }
      if (e.shiftKey && (e.code === "KeyN" || e.code === "KeyP")) {
        e.preventDefault();
        if (e.code === "KeyN") playerRef.current?.nextVideo?.();
        else playerRef.current?.previousVideo?.();
        return;
      }
      if (e.key === ">" || e.key === "<") {
        e.preventDefault();
        a.stepSpeed(e.key === ">" ? 1 : -1);
        return;
      }
      if (e.code !== "Space" || el?.closest(".dl-sheet, .menu")) return;
      e.preventDefault();
      playPause();
    };
    window.addEventListener("keydown", onKeyDown);

    register("MediaPlayPause", fire(playPause)).catch(() => {});

    return () => {
      window.removeEventListener("keydown", onKeyDown);
      unregister("MediaPlayPause").catch(() => {});
      unregister(CLICK_THROUGH_KEY).catch(() => {});
    };
  }, []);

  const timer = focus.timer;

  return (
    <div
      className={`app ${mini ? "is-mini" : ""} ${strip ? `is-strip ${filePath ? "strip-file" : "strip-youtube"}` : ""}`}
      style={{ opacity }}
    >
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
          {timer && (
            <button
              className={`timer-pill is-${timer.phase} ${timer.paused ? "is-paused" : ""}`}
              onClick={focus.togglePause}
              title={timer.paused ? "Resume timer" : "Pause timer"}
            >
              <span className={`timer-dot is-${timer.phase}`} />
              {formatClock(timer.remaining)}
            </button>
          )}
        </div>

        <div className="actions">
          <input
            className="opacity-slider"
            type="range"
            min={0.2}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => setOpacity(parseFloat(e.target.value))}
            title="Transparency"
          />
          <button
            className={`iconbtn hide-mini ${pinned ? "is-active" : ""}`}
            onClick={() => setPinned((v) => !v)}
            title={pinned ? "On top: on" : "On top: off"}
          >
            <Icon d={icons.pin} />
          </button>
          {hasPlaylist && (
            <>
              <button
                className={`iconbtn ${sheet === "playlist" ? "is-active" : ""}`}
                onClick={() => setSheet((s) => (s === "playlist" ? null : "playlist"))}
                title={`Playlist (${playlist!.index + 1} of ${playlist!.ids.length})`}
              >
                <Icon d={icons.list} />
              </button>
              <button
                className="iconbtn"
                onClick={() => playerRef.current?.nextVideo?.()}
                disabled={playlist!.index >= playlist!.ids.length - 1}
                title="Next video (Shift+N)"
              >
                <Icon d={icons.next} />
              </button>
            </>
          )}
          <button
            className={`iconbtn ${sheet === "search" ? "is-active" : ""}`}
            onClick={() => (sheet === "search" ? setSheet(null) : openSearch())}
            title="Search YouTube (Ctrl+K)"
          >
            <Icon d={icons.search} />
          </button>
          <button
            className={`iconbtn hide-mini ${sheet === "downloads" ? "is-active" : ""}`}
            onClick={() => setSheet((s) => (s === "downloads" ? null : "downloads"))}
            title={activeDownloads ? `Downloads (${activeDownloads} in progress)` : "Download video or playlist"}
          >
            <Icon d={icons.download} />
            {activeDownloads > 0 && <span className="iconbtn-badge">{activeDownloads}</span>}
          </button>
          {hasSource && (
            <button
              className={`iconbtn cc-btn ${capPrefs.enabled ? "is-active" : ""}`}
              onClick={() => {
                setMenuOpen(false);
                setCapMenuOpen((v) => !v);
              }}
              title="Captions (C)"
            >
              <Icon d={icons.cc} />
            </button>
          )}
          {hasSource && (
            <button className="iconbtn hide-mini" onClick={reset} title="New video">
              <Icon d={icons.plus} />
            </button>
          )}
          {strip && (
            <button className="iconbtn" onClick={toggleStrip} title="Exit caption strip (Shift+S)">
              <Icon d={icons.expand} />
            </button>
          )}
          {mini && (
            <button className="iconbtn" onClick={toggleMini} title="Exit mini player (Ctrl+M)">
              <Icon d={icons.expand} />
            </button>
          )}
          <button
            className={`iconbtn more-btn ${menuOpen ? "is-active" : ""}`}
            onClick={() => {
              setCapMenuOpen(false);
              setMenuOpen((v) => !v);
            }}
            title="More"
          >
            <Icon d={icons.more} size={18} />
            {update && <span className="iconbtn-dot" />}
          </button>
          <button className="iconbtn" onClick={() => appWindow.minimize()} title="Minimize">
            <Icon d={icons.minimize} />
          </button>
          <button className="iconbtn iconbtn-close" onClick={() => appWindow.close()} title="Close">
            <Icon d={icons.close} />
          </button>
        </div>
      </header>

      {menuOpen && (
        <MoreMenu
          speed={speed}
          onSpeed={changeSpeed}
          mini={mini}
          onToggleMini={toggleMini}
          onClickThrough={() => setClickThroughMode(true)}
          timer={timer}
          onStartTimer={(p) => {
            focus.start(p);
            showToast(`Focus for ${p.focus} minutes. You've got this.`);
          }}
          onPauseTimer={focus.togglePause}
          onSkipTimer={focus.skip}
          onStopTimer={focus.stop}
          onOpenFile={openFile}
          update={update}
          onCheckUpdate={manualUpdateCheck}
          onOpenUpdate={() => update && open(update.url)}
          onWebsite={() => open(SITE)}
          aiReady={ai.ready}
          onOpenAi={openAiSettings}
          onClose={() => setMenuOpen(false)}
        />
      )}

      {capMenuOpen && hasSource && (
        <CaptionsMenu
          captions={captions}
          prefs={capPrefs}
          onPrefs={setCapPrefs}
          isFile={!!filePath}
          strip={strip}
          onToggleStrip={() => {
            setCapMenuOpen(false);
            toggleStrip();
          }}
          onOpenTranscript={openTranscript}
          onLoadFile={loadSubtitleFile}
          onSetup={() => {
            setCapMenuOpen(false);
            setSheet("downloads");
          }}
          aiReady={ai.ready}
          translating={translating}
          onTranslate={translateCaptions}
          onOpenAiSettings={openAiSettings}
          delay={subDelay}
          onDelay={changeDelay}
          onFindOnline={openSubtitleSearch}
          onClose={() => setCapMenuOpen(false)}
        />
      )}
      {sheet === "ai" && <AiSettingsPanel onClose={() => setSheet(null)} />}
      {sheet === "search" && (
        <SearchPanel
          initialQuery={searchSeed}
          onPlay={playSearchResult}
          onDownload={downloadSearchResult}
          onSetup={() => setSheet("downloads")}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "subsearch" && hasSource && (
        <SubtitleSearchPanel
          source={
            filePath
              ? { kind: "file", path: filePath }
              : {
                  kind: "youtube",
                  title: (playerRef.current?.getVideoData?.()?.title as string | undefined) ?? "",
                }
          }
          defaultLang={capPrefs.lang}
          onApply={applyFoundSubtitles}
          onClose={() => setSheet(null)}
        />
      )}

      {sheet === "downloads" && (
        <DownloadPanel
          initialUrl={dlSeed?.url ?? input}
          initialMode={dlSeed?.mode}
          downloads={downloads}
          onPlayFile={playFile}
          defaultSubLang={capPrefs.lang}
          onClose={() => {
            setDlSeed(null);
            setSheet(null);
          }}
        />
      )}
      {sheet === "transcript" && hasSource && (
        <TranscriptPanel
          captions={captions}
          time={capTime}
          notesKey={filePath ? `f:${filePath}` : currentVideoId ? `v:${currentVideoId}` : null}
          title={
            filePath
              ? fileName(filePath)
              : (playerRef.current?.getVideoData?.()?.title as string | undefined) || "YouTube video"
          }
          url={!filePath && currentVideoId ? `https://www.youtube.com/watch?v=${currentVideoId}` : null}
          onSeek={(t) => playerRef.current?.seekTo?.(Math.max(0, t + subDelay), true)}
          onSetup={() => setSheet("downloads")}
          aiReady={ai.ready}
          onOpenAiSettings={openAiSettings}
          onClose={() => setSheet(null)}
        />
      )}
      {sheet === "playlist" && hasPlaylist && (
        <PlaylistPanel
          listId={listId!}
          playlist={playlist!}
          onPlayAt={(i) => playerRef.current?.playVideoAt?.(i)}
          onPrev={() => playerRef.current?.previousVideo?.()}
          onNext={() => playerRef.current?.nextVideo?.()}
          onClose={() => setSheet(null)}
        />
      )}

      <main className="content">
        {filePath ? (
          <LocalPlayer path={filePath} onPlayer={setPlayer} onResume={onResume} />
        ) : hasSource ? (
          <Player
            videoId={videoId}
            listId={listId}
            onPlayer={setPlayer}
            onPlaylist={setPlaylist}
            onResume={onResume}
          />
        ) : null}
        {hasSource && (capPrefs.enabled || strip) && (
          <CaptionOverlay cues={captions.cues} cues2={captions.cues2} time={capTime} prefs={capPrefs} strip={strip} />
        )}
        {!hasSource && (
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
            <h1 className="empty-title">Search or paste a YouTube link</h1>
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
                placeholder="Search videos & music, or paste a link"
              />
              <button type="submit" className="bar-go">
                {input.trim() && !parseVideoId(input) && !parsePlaylistId(input) ? "Search" : "Load"}
              </button>
            </form>

            {error && <p className="error">{error}</p>}

            <p className="empty-hint">
              <kbd>↵</kbd> play · <kbd>Ctrl</kbd>+<kbd>K</kbd> search ·{" "}
              <button className="linkbtn" onClick={openFile}>
                open a file
              </button>
            </p>

            {history.length > 0 && <RecentList items={history.slice(0, 4)} onOpen={openRecent} />}
          </div>
        )}
      </main>

      {toast && (
        <div className="toast" key={toast.id} role="status">
          <span>{toast.text}</span>
          {toast.action && (
            <button
              className="toast-action"
              onClick={() => {
                toast.action!.run();
                setToast(null);
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="toast-close" onClick={() => setToast(null)} title="Dismiss">
            <Icon d={icons.close} size={12} />
          </button>
        </div>
      )}

      {clickThrough && <div className="click-through-badge">Click-through · Ctrl+Alt+C</div>}
    </div>
  );
}

function RecentList({ items, onOpen }: { items: HistoryItem[]; onOpen: (i: HistoryItem) => void }) {
  return (
    <section className="recent">
      <div className="recent-head">
        <Icon d={icons.history} size={13} />
        Continue watching
      </div>
      {items.map((item) => {
        const pct = item.duration ? Math.min(item.position / item.duration, 1) : 0;
        const sub =
          item.kind === "playlist"
            ? `Playlist${item.index != null && item.count ? ` · ${item.index + 1} of ${item.count}` : ""}`
            : item.kind === "file"
              ? "Local file"
              : item.channel ?? "";
        return (
          <div className="recent-row" key={item.key}>
            <button className="recent-open" onClick={() => onOpen(item)} title={item.title}>
              <span className="recent-thumb">
                {item.videoId ? (
                  <img src={thumbUrl(item.videoId)} alt="" />
                ) : (
                  <Icon d={/\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(item.path ?? "") ? icons.audio : icons.video} />
                )}
                {pct > 0 && (
                  <span className="recent-progress">
                    <span style={{ width: `${pct * 100}%` }} />
                  </span>
                )}
              </span>
              <span className="recent-text">
                <span className="recent-title">{item.kind === "file" ? fileName(item.path ?? "") : item.title}</span>
                <span className="recent-sub">
                  {sub}
                  {item.position > 0 && item.duration ? ` · ${formatDuration(item.position)} / ${formatDuration(item.duration)}` : ""}
                </span>
              </span>
            </button>
            <button className="iconbtn recent-remove" onClick={() => removeHistory(item.key)} title="Remove from list">
              <Icon d={icons.close} size={12} />
            </button>
          </div>
        );
      })}
    </section>
  );
}
