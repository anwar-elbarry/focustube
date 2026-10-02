import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

export type Mode = "video" | "audio";

export type DownloaderStatus = {
  ytdlp: boolean;
  ffmpeg: boolean;
  needsSetup: boolean;
};

export type SetupProgress = {
  stage: "yt-dlp" | "ffmpeg" | "extract";
  received: number;
  total: number | null;
};

/** Estimated bytes per available video height (audio included) + audio-only. */
export type Sizes = {
  heights: { height: number; size: number }[];
  audio: number | null;
  mp3: number | null;
};

export type VideoInfo = {
  kind: "video";
  id: string;
  title: string;
  channel: string | null;
  duration: number | null;
  sizes: Sizes;
};

export type PlaylistEntry = { id: string; title: string | null; duration: number | null };

export type PlaylistInfo = {
  kind: "playlist";
  title: string;
  channel: string | null;
  count: number;
  entries: PlaylistEntry[];
};

export type Info = VideoInfo | PlaylistInfo;

export type JobStatus =
  | "starting"
  | "downloading"
  | "processing"
  | "done"
  | "failed"
  | "cancelled";

export type Job = {
  id: string;
  url: string;
  title: string;
  thumb: string | null;
  mode: Mode;
  playlist: boolean;
  dir: string;
  quality: number | null;
  /** Playlist positions to download ("1,4,7"); null = whole playlist. */
  items: string | null;
  /** How many videos `items` selects. */
  selected: number | null;
  /** Subtitles: "off" | "file" (.srt next to the video) | "embed". */
  subs: "off" | "file" | "embed";
  subLang: string | null;
  status: JobStatus;
  /** 0–1 for the current file, null when unknown. */
  progress: number | null;
  speed: number | null;
  eta: number | null;
  index: number | null;
  count: number | null;
  itemTitle: string | null;
  step: string | null;
  savedPath: string | null;
  error: string | null;
  failures: number;
};

type DlEvent =
  | { type: "item"; id: string; index: number | null; count: number | null; title: string }
  | {
      type: "progress";
      id: string;
      status: string;
      downloaded: number;
      total: number | null;
      speed: number | null;
      eta: number | null;
    }
  | { type: "processing"; id: string; step: string }
  | { type: "saved"; id: string; path: string }
  | {
      type: "done";
      id: string;
      ok: boolean;
      cancelled: boolean;
      error: string | null;
      failures: number;
    };

export const getStatus = () => invoke<DownloaderStatus>("downloader_status");
export const installDownloader = () => invoke<void>("install_downloader");
export const fetchInfo = (url: string) => invoke<Info>("fetch_info", { url });
export const showInFolder = (path: string) => invoke<void>("show_in_folder", { path });

/** Size of the file a download with these settings would produce. */
export function sizeFor(
  sizes: Sizes | null | undefined,
  mode: Mode,
  quality: number | null,
  hasFfmpeg: boolean
): number | null {
  if (!sizes) return null;
  if (mode === "audio") return hasFfmpeg ? sizes.mp3 : sizes.audio;
  const fits = sizes.heights.filter((h) => quality == null || h.height <= quality);
  // Nothing at or under the cap: yt-dlp falls back to the smallest stream.
  const pick = fits.length ? fits[fits.length - 1] : sizes.heights[0];
  return pick?.size ?? null;
}

type SizeEvent = { key: string; id: string; sizes: Sizes | null };

/**
 * Per-video size estimates for a playlist, streamed in from the backend.
 * `undefined` = still loading, `null` = unavailable (private/removed).
 */
export function useVideoSizes(key: string | null, ids: string[]) {
  const [sizes, setSizes] = useState<Record<string, Sizes | null>>({});

  useEffect(() => {
    setSizes({});
    if (!key || !ids.length) return;
    const unlisten = listen<SizeEvent>("video-size", ({ payload }) => {
      if (payload.key === key) setSizes((s) => ({ ...s, [payload.id]: payload.sizes }));
    });
    invoke("fetch_sizes", { key, ids }).catch(() => {});
    return () => {
      unlisten.then((f) => f());
      invoke("cancel_sizes", { key }).catch(() => {});
    };
    // `key` identifies the id list; ids is re-created on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  return sizes;
}

export type NewJob = Pick<
  Job,
  "url" | "title" | "thumb" | "mode" | "playlist" | "dir" | "quality" | "items" | "selected" | "subs" | "subLang"
>;

function apply(job: Job, ev: DlEvent): Job {
  switch (ev.type) {
    case "item":
      return {
        ...job,
        status: "downloading",
        index: ev.index,
        count: ev.count,
        itemTitle: ev.title,
        progress: 0,
        step: null,
      };
    case "progress": {
      const progress = ev.total ? Math.min(ev.downloaded / ev.total, 1) : null;
      return {
        ...job,
        status: "downloading",
        progress: ev.status === "finished" ? 1 : progress,
        speed: ev.speed,
        eta: ev.eta,
      };
    }
    case "processing":
      return { ...job, status: "processing", step: ev.step };
    case "saved":
      return { ...job, savedPath: ev.path };
    case "done":
      return {
        ...job,
        status: ev.cancelled ? "cancelled" : ev.ok || (job.playlist && job.savedPath) ? "done" : "failed",
        error: ev.error,
        failures: ev.failures,
        progress: ev.ok ? 1 : job.progress,
        speed: null,
        eta: null,
      };
  }
}

export function useDownloads() {
  const [jobs, setJobs] = useState<Job[]>([]);

  useEffect(() => {
    const unlisten = listen<DlEvent>("download-event", ({ payload }) => {
      setJobs((js) => js.map((j) => (j.id === payload.id ? apply(j, payload) : j)));
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  const start = useCallback(async (n: NewJob) => {
    const id = crypto.randomUUID();
    const job: Job = {
      ...n,
      id,
      status: "starting",
      progress: null,
      speed: null,
      eta: null,
      index: null,
      count: null,
      itemTitle: null,
      step: null,
      savedPath: null,
      error: null,
      failures: 0,
    };
    setJobs((js) => [job, ...js]);
    try {
      await invoke("start_download", {
        args: {
          id,
          url: n.url,
          dir: n.dir,
          mode: n.mode,
          quality: n.quality,
          playlist: n.playlist,
          items: n.items,
          count: n.selected,
          subs: n.subs,
          subLang: n.subLang,
        },
      });
    } catch (e) {
      setJobs((js) =>
        js.map((j) => (j.id === id ? { ...j, status: "failed", error: String(e) } : j))
      );
    }
  }, []);

  const cancel = useCallback((id: string) => {
    invoke("cancel_download", { id }).catch(() => {});
  }, []);

  const remove = useCallback((id: string) => {
    setJobs((js) => js.filter((j) => j.id !== id));
  }, []);

  const clearFinished = useCallback(() => {
    setJobs((js) => js.filter((j) => isActive(j)));
  }, []);

  return { jobs, start, cancel, remove, clearFinished };
}

export type Downloads = ReturnType<typeof useDownloads>;

export const isActive = (j: Job) =>
  j.status === "starting" || j.status === "downloading" || j.status === "processing";

/** Overall 0–1 progress; playlists count finished items. */
export function overallProgress(j: Job): number | null {
  if (j.status === "done") return 1;
  if (j.playlist && j.index && j.count) {
    return Math.min((j.index - 1 + (j.progress ?? 0)) / j.count, 1);
  }
  return j.progress;
}

export function formatBytes(n: number): string {
  const units = ["B", "KB", "MB", "GB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 10 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function formatDuration(sec: number): string {
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const mm = h ? String(m).padStart(2, "0") : String(m);
  return `${h ? `${h}:` : ""}${mm}:${String(s).padStart(2, "0")}`;
}
