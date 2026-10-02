import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// ---------- Parsing ----------

export type Cue = { start: number; end: number; text: string };

function toSeconds(stamp: string): number {
  // "01:02:03.450", "02:03.450" or SRT's "01:02:03,450"
  const parts = stamp.trim().replace(",", ".").split(":").map(Number);
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

const TIMING = /(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}\s*-->\s*(\d{1,2}:)?\d{1,2}:\d{2}[.,]\d{1,3}/;

function decodeEntities(s: string) {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&nbsp;/g, " ");
}

/** Parses WebVTT or SRT into clean, non-overlapping-ish cues. */
export function parseSubtitles(raw: string): Cue[] {
  const blocks = raw.replace(/\r/g, "").split(/\n{2,}/);
  const cues: Cue[] = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    const ti = lines.findIndex((l) => TIMING.test(l));
    if (ti < 0) continue;
    const [a, b] = lines[ti].split("-->");
    const start = toSeconds(a);
    const end = toSeconds(b.trim().split(/\s+/)[0]);
    const textLines = lines
      .slice(ti + 1)
      .map((l) => decodeEntities(l.replace(/<[^>]+>/g, "")).trim())
      .filter(Boolean);
    if (!textLines.length || end - start < 0.05) continue;
    cues.push({ start, end, text: textLines.join("\n") });
  }
  return dedupeRolling(cues);
}

/**
 * YouTube's auto-captions "roll": each cue repeats the previous line above
 * the new one. Keep only the new text so the transcript reads naturally.
 */
function dedupeRolling(cues: Cue[]): Cue[] {
  const out: Cue[] = [];
  for (const c of cues) {
    const prev = out[out.length - 1];
    let lines = c.text.split("\n");
    if (prev) {
      const prevLines = prev.text.split("\n");
      const last = prevLines[prevLines.length - 1];
      if (lines.length > 1 && lines[0] === last) lines = lines.slice(1);
      if (lines.join("\n") === prev.text) {
        prev.end = Math.max(prev.end, c.end);
        continue;
      }
    }
    out.push({ ...c, text: lines.join("\n") });
  }
  return out;
}

/** Index of the cue showing at time t, or -1. Cues are sorted by start. */
export function cueIndexAt(cues: Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found >= 0 && t < cues[found].end ? found : -1;
}

/** The latest cue that has started (for transcript highlighting). */
export function lastStartedIndex(cues: Cue[], t: number): number {
  let lo = 0;
  let hi = cues.length - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (cues[mid].start <= t) {
      found = mid;
      lo = mid + 1;
    } else hi = mid - 1;
  }
  return found;
}

// ---------- Tracks ----------

export type Track = {
  /** Stable id within the current source. */
  id: string;
  lang: string;
  label: string;
  auto: boolean;
  /** YouTube */
  url?: string | null;
  /** Local file */
  path?: string;
  /** Generated in the app (AI translation): cues are already in hand. */
  cues?: Cue[];
};

const displayNames = (() => {
  try {
    return new Intl.DisplayNames([navigator.language || "en"], { type: "language" });
  } catch {
    return null;
  }
})();

export function langName(code: string): string {
  if (!code) return "Subtitles";
  const base = code.replace(/-orig$/, "");
  try {
    return displayNames?.of(base) ?? code;
  } catch {
    return code;
  }
}

type RawYtTrack = { lang: string; name: string | null; auto: boolean; url: string | null };

function ytTracks(raw: RawYtTrack[]): Track[] {
  return raw.map((t) => ({
    id: `${t.auto ? "a" : "m"}:${t.lang}`,
    lang: t.lang,
    label: `${t.name || langName(t.lang)}${t.auto ? " (auto)" : ""}`,
    auto: t.auto,
    url: t.url,
  }));
}

type Sidecar = { path: string; tag: string };

function fileTracks(found: Sidecar[]): Track[] {
  return found.map((f) => ({
    id: `f:${f.path}`,
    lang: f.tag.split(".").pop() ?? "",
    label: f.tag ? langName(f.tag.split(".").pop()!) : "Subtitles",
    auto: false,
    path: f.path,
  }));
}

/** Best track for a preferred language: manual > auto in that language. */
export function pickTrack(tracks: Track[], lang: string | null): Track | null {
  if (!tracks.length) return null;
  const base = (l: string) => l.toLowerCase().split("-")[0];
  if (lang) {
    const same = tracks.filter((t) => base(t.lang) === base(lang));
    const best = same.find((t) => !t.auto) ?? same.find((t) => t.lang.endsWith("-orig")) ?? same[0];
    if (best) return best;
  }
  return tracks.find((t) => !t.auto) ?? tracks.find((t) => t.lang.endsWith("-orig")) ?? tracks[0];
}

// ---------- Preferences ----------

export type CaptionPrefs = {
  enabled: boolean;
  lang: string | null;
  /** Second language for dual subtitles; null = off. */
  lang2: string | null;
  size: "s" | "m" | "l";
  background: boolean;
  position: "bottom" | "top";
};

const PREFS = "focustube.captions";
const DEFAULT_PREFS: CaptionPrefs = {
  enabled: false,
  lang: (navigator.language || "en").split("-")[0],
  lang2: null,
  size: "m",
  background: true,
  position: "bottom",
};

export function loadCaptionPrefs(): CaptionPrefs {
  try {
    return { ...DEFAULT_PREFS, ...JSON.parse(localStorage.getItem(PREFS) || "{}") };
  } catch {
    return DEFAULT_PREFS;
  }
}

export function saveCaptionPrefs(p: CaptionPrefs) {
  try {
    localStorage.setItem(PREFS, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

// ---------- Loading ----------

export type CaptionSource =
  | { kind: "youtube"; videoId: string }
  | { kind: "file"; path: string }
  | null;

export type CaptionStatus = "idle" | "loading" | "ready" | "none" | "needs-setup" | "error";

// Per-session caches: track lists per video, cue lists per track.
const trackCache = new Map<string, Promise<Track[]>>();
const cueCache = new Map<string, Promise<Cue[]>>();

function cached<T>(map: Map<string, Promise<T>>, key: string, load: () => Promise<T>): Promise<T> {
  let p = map.get(key);
  if (!p) {
    p = load();
    map.set(key, p);
    p.catch(() => map.delete(key));
  }
  return p;
}

function loadTracks(src: NonNullable<CaptionSource>): Promise<Track[]> {
  if (src.kind === "youtube") {
    return cached(trackCache, `yt:${src.videoId}`, () =>
      invoke<RawYtTrack[]>("subtitle_tracks", { videoId: src.videoId }).then(ytTracks)
    );
  }
  // Sidecar files can appear (e.g. a download just finished): don't cache.
  return invoke<Sidecar[]>("find_sidecar_subtitles", { path: src.path }).then(fileTracks);
}

function loadCues(src: NonNullable<CaptionSource>, track: Track): Promise<Cue[]> {
  if (track.cues) return Promise.resolve(track.cues);
  const key = src.kind === "youtube" ? `yt:${src.videoId}:${track.id}` : track.id;
  return cached(cueCache, key, () =>
    (track.path
      ? invoke<string>("read_subtitle_file", { path: track.path })
      : invoke<string>("fetch_subtitle", {
          videoId: (src as { videoId: string }).videoId,
          lang: track.lang,
          auto: track.auto,
          url: track.url ?? null,
        })
    ).then(parseSubtitles)
  );
}

/**
 * Tracks and cues for the current video. Only does work while `active`
 * (captions, transcript or strip mode are in use).
 */
export function useCaptions(
  source: CaptionSource,
  active: boolean,
  canFetchYouTube: boolean,
  prefs: CaptionPrefs
) {
  const [tracks, setTracks] = useState<Track[]>([]);
  const [extra, setExtra] = useState<Track[]>([]);
  const [status, setStatus] = useState<CaptionStatus>("idle");
  const [error, setError] = useState("");
  const [primaryId, setPrimaryId] = useState<string | null>(null);
  const [secondaryId, setSecondaryId] = useState<string | null>(null);
  const [cues, setCues] = useState<Cue[]>([]);
  const [cues2, setCues2] = useState<Cue[]>([]);
  const srcKey = source ? (source.kind === "youtube" ? source.videoId : source.path) : "";
  const prefsRef = useRef(prefs);
  prefsRef.current = prefs;

  // New video: forget the previous video's tracks.
  useEffect(() => {
    setTracks([]);
    setExtra([]);
    setPrimaryId(null);
    setSecondaryId(null);
    setCues([]);
    setCues2([]);
    setStatus("idle");
  }, [srcKey]);

  // Track list.
  useEffect(() => {
    if (!source || !active) return;
    if (source.kind === "youtube" && !canFetchYouTube) {
      setStatus("needs-setup");
      return;
    }
    let cancelled = false;
    setStatus("loading");
    loadTracks(source)
      .then((list) => {
        if (cancelled) return;
        setTracks(list);
        const p = prefsRef.current;
        const first = pickTrack(list, p.lang);
        setPrimaryId((cur) => cur ?? first?.id ?? null);
        const second = p.lang2 ? pickTrack(list.filter((t) => t.id !== first?.id), p.lang2) : null;
        setSecondaryId((cur) => cur ?? (second && second.lang.split("-")[0] === p.lang2 ? second.id : null));
        if (!list.length) setStatus("none");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey, active, canFetchYouTube]);

  const all = [...tracks, ...extra];
  const primary = all.find((t) => t.id === primaryId) ?? null;
  const secondary = all.find((t) => t.id === secondaryId) ?? null;

  // Cues for the chosen tracks.
  useEffect(() => {
    if (!source || !active || !primary) {
      setCues([]);
      return;
    }
    let cancelled = false;
    setStatus("loading");
    loadCues(source, primary)
      .then((c) => {
        if (cancelled) return;
        setCues(c);
        setStatus(c.length ? "ready" : "none");
      })
      .catch((e) => {
        if (cancelled) return;
        setError(String(e));
        setStatus("error");
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey, active, primary?.id]);

  useEffect(() => {
    if (!source || !active || !secondary) {
      setCues2([]);
      return;
    }
    let cancelled = false;
    loadCues(source, secondary)
      .then((c) => !cancelled && setCues2(c))
      .catch(() => !cancelled && setCues2([]));
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [srcKey, active, secondary?.id]);

  /** Add a subtitle file the user picked and switch to it. */
  function addFile(path: string) {
    const name = path.split(/[\\/]/).pop() ?? path;
    const track: Track = { id: `f:${path}`, lang: "", label: name, auto: false, path };
    setExtra((x) => [...x.filter((t) => t.id !== track.id), track]);
    setPrimaryId(track.id);
  }

  /**
   * Add a track whose cues are already in hand: an AI translation (shown as
   * the second line) or subtitles found online (shown as the main line).
   */
  function addGenerated(track: Track, slot: "primary" | "secondary" = "secondary") {
    setExtra((x) => [...x.filter((t) => t.id !== track.id), track]);
    if (slot === "primary") setPrimaryId(track.id);
    else setSecondaryId(track.id);
  }

  return {
    tracks: all,
    status,
    error,
    primary,
    secondary,
    cues,
    cues2,
    setPrimaryId,
    setSecondaryId,
    addFile,
    addGenerated,
  };
}

export type Captions = ReturnType<typeof useCaptions>;

/** Polls the player's clock while something needs it. */
export function usePlayerTime(playerRef: React.MutableRefObject<any>, active: boolean) {
  const [time, setTime] = useState(0);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => {
      const now = playerRef.current?.getCurrentTime?.();
      if (typeof now === "number" && Number.isFinite(now)) setTime(now);
    }, 200);
    return () => clearInterval(t);
  }, [active, playerRef]);
  return time;
}

export const formatStamp = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
};
