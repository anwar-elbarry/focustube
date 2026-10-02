import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { downloadDir } from "@tauri-apps/api/path";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { Icon, icons } from "./Icon";
import { parsePlaylistId, parseVideoId, thumbUrl } from "./youtube";
import {
  DownloaderStatus,
  Downloads,
  Info,
  Job,
  Mode,
  PlaylistEntry,
  SetupProgress,
  fetchInfo,
  formatBytes,
  formatDuration,
  getStatus,
  installDownloader,
  isActive,
  overallProgress,
  showInFolder,
  sizeFor,
  useVideoSizes,
} from "./downloads";

const QUALITIES: { label: string; value: number | null }[] = [
  { label: "Best available", value: null },
  { label: "2160p (4K)", value: 2160 },
  { label: "1440p", value: 1440 },
  { label: "1080p", value: 1080 },
  { label: "720p", value: 720 },
  { label: "480p", value: 480 },
  { label: "360p", value: 360 },
];

const PREFS_KEY = "focustube.download";
type Prefs = { dir?: string; mode?: Mode; quality?: number | null };

function loadPrefs(): Prefs {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) || "{}");
  } catch {
    return {};
  }
}

function savePrefs(p: Prefs) {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ ...loadPrefs(), ...p }));
  } catch {
    /* storage unavailable — prefs just won't persist */
  }
}

const folderName = (dir: string) => dir.split(/[\\/]/).filter(Boolean).pop() ?? dir;

export default function DownloadPanel({
  initialUrl,
  downloads,
  onPlayFile,
  onClose,
}: {
  initialUrl: string;
  downloads: Downloads;
  onPlayFile: (path: string) => void;
  onClose: () => void;
}) {
  const [status, setStatus] = useState<DownloaderStatus | null>(null);

  const refreshStatus = () => getStatus().then(setStatus).catch(() => {});
  useEffect(() => {
    refreshStatus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="dl-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <aside className="dl-sheet" role="dialog" aria-label="Download">
        <header className="dl-head">
          <h2>Download</h2>
          <button className="iconbtn" onClick={onClose} title="Close (Esc)">
            <Icon d={icons.close} />
          </button>
        </header>

        <div className="dl-body">
          {!status ? (
            <div className="dl-center">
              <div className="spinner small" />
            </div>
          ) : status.needsSetup ? (
            <SetupCard onDone={refreshStatus} />
          ) : (
            <DownloadForm initialUrl={initialUrl} hasFfmpeg={status.ffmpeg} downloads={downloads} />
          )}

          <JobList downloads={downloads} onPlayFile={onPlayFile} />
        </div>
      </aside>
    </div>
  );
}

// ---------- One-time setup ----------

function SetupCard({ onDone }: { onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<SetupProgress | null>(null);
  const [error, setError] = useState("");

  async function install() {
    setBusy(true);
    setError("");
    const unlisten = await listen<SetupProgress>("downloader-setup", (e) => setProgress(e.payload));
    try {
      await installDownloader();
      onDone();
    } catch (e) {
      setError(String(e));
    } finally {
      unlisten();
      setBusy(false);
      setProgress(null);
    }
  }

  const label =
    progress?.stage === "extract"
      ? "Unpacking FFmpeg…"
      : progress
        ? `Downloading ${progress.stage === "ffmpeg" ? "FFmpeg" : "yt-dlp"}… ${formatBytes(progress.received)}${
            progress.total ? ` of ${formatBytes(progress.total)}` : ""
          }`
        : "Preparing…";
  const pct = progress?.total ? progress.received / progress.total : null;

  return (
    <section className="dl-card dl-setup">
      <div className="dl-setup-icon">
        <Icon d={icons.download} size={20} />
      </div>
      <h3>One-time setup</h3>
      <p>
        FocusTube downloads with <b>yt-dlp</b>, plus <b>FFmpeg</b> for HD video and MP3. They’re
        fetched once (up to about 200&nbsp;MB) and kept up to date automatically.
      </p>
      {busy ? (
        <div className="dl-setup-progress">
          <Progress value={pct} />
          <span>{label}</span>
        </div>
      ) : (
        <button className="btn-primary" onClick={install}>
          {error ? "Try again" : "Set up downloads"}
        </button>
      )}
      {error && <p className="error">{error}</p>}
    </section>
  );
}

// ---------- Form ----------

type InfoState =
  | { state: "idle" }
  | { state: "loading" }
  | { state: "error"; error: string }
  | { state: "ready"; info: Info };

function DownloadForm({
  initialUrl,
  hasFfmpeg,
  downloads,
}: {
  initialUrl: string;
  hasFfmpeg: boolean;
  downloads: Downloads;
}) {
  const prefs = useRef(loadPrefs()).current;
  const [url, setUrl] = useState(initialUrl);
  const [info, setInfo] = useState<InfoState>({ state: "idle" });
  const [scope, setScope] = useState<"video" | "playlist">("video");
  const [mode, setMode] = useState<Mode>(hasFfmpeg ? (prefs.mode ?? "video") : "audio");
  const [quality, setQuality] = useState<number | null>(prefs.quality ?? null);
  const [dir, setDir] = useState(prefs.dir ?? "");
  const [justAdded, setJustAdded] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const videoId = parseVideoId(url);
  const listId = parsePlaylistId(url);
  const valid = !!(videoId || listId);

  useEffect(() => {
    if (!dir) downloadDir().then(setDir).catch(() => {});
  }, [dir]);

  useEffect(() => {
    if (!valid) {
      setInfo({ state: "idle" });
      return;
    }
    let cancelled = false;
    setInfo({ state: "loading" });
    const t = setTimeout(() => {
      fetchInfo(url.trim())
        .then((i) => {
          if (cancelled) return;
          setInfo({ state: "ready", info: i });
          setScope(i.kind === "playlist" && !videoId ? "playlist" : "video");
          setSelected(new Set(i.kind === "playlist" ? i.entries.map((e) => e.id) : []));
        })
        .catch((e) => !cancelled && setInfo({ state: "error", error: String(e) }));
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  const ready = info.state === "ready" ? info.info : null;
  const playlist = ready?.kind === "playlist" ? ready : null;
  const canChooseScope = !!playlist && !!videoId;
  const isPlaylist = scope === "playlist" && !!playlist;

  const videoTitle =
    ready?.kind === "video"
      ? ready.title
      : playlist?.entries.find((e) => e.id === videoId)?.title ?? null;
  const thumbId = videoId ?? playlist?.entries[0]?.id ?? null;
  const title = isPlaylist ? playlist!.title : videoTitle ?? "YouTube video";

  // Sizes: a plain video link already carries them; for anything inside a
  // playlist they are fetched per video (only the current one in "This video").
  const sizeIds = !playlist ? [] : isPlaylist ? playlist.entries.map((e) => e.id) : videoId ? [videoId] : [];
  const sizeKey = !playlist ? null : isPlaylist ? `p:${listId}` : `v:${videoId}`;
  const entrySizes = useVideoSizes(sizeKey, sizeIds);
  const singleSizes = ready?.kind === "video" ? ready.sizes : videoId ? entrySizes[videoId] : undefined;

  const chosen = isPlaylist ? playlist!.entries.filter((e) => selected.has(e.id)) : [];
  /** Total bytes for the current selection, plus how many sizes are still unknown. */
  function estimate(q: number | null) {
    if (!isPlaylist) {
      const b = sizeFor(singleSizes, mode, q, hasFfmpeg);
      return { bytes: b ?? 0, pending: singleSizes === undefined ? 1 : 0, known: b != null };
    }
    let bytes = 0;
    let pending = 0;
    for (const e of chosen) {
      if (!(e.id in entrySizes)) pending++;
      else bytes += sizeFor(entrySizes[e.id], mode, q, hasFfmpeg) ?? 0;
    }
    return { bytes, pending, known: chosen.length > 0 };
  }
  const total = estimate(mode === "video" ? quality : null);
  const sizeLabel = !total.known
    ? ""
    : total.pending
      ? isPlaylist && total.bytes
        ? ` · ≈ ${formatBytes(total.bytes)}+`
        : ""
      : ` · ≈ ${formatBytes(total.bytes)}`;

  // For a single video, only offer heights it actually has.
  const maxHeight = singleSizes?.heights.length ? singleSizes.heights[singleSizes.heights.length - 1].height : null;
  const qualityOptions = QUALITIES.filter(
    (q) => isPlaylist || q.value == null || maxHeight == null || q.value <= maxHeight
  );

  async function pickFolder() {
    const picked = await openDialog({ directory: true, defaultPath: dir || undefined, title: "Save downloads to" });
    if (typeof picked === "string") {
      setDir(picked);
      savePrefs({ dir: picked });
    }
  }

  function submit() {
    if (!ready || !dir || (isPlaylist && !chosen.length)) return;
    const all = isPlaylist && chosen.length === playlist!.entries.length;
    const positions = isPlaylist
      ? playlist!.entries.flatMap((e, i) => (selected.has(e.id) ? [i + 1] : []))
      : [];
    downloads.start({
      url: url.trim(),
      title,
      thumb: thumbId ? thumbUrl(thumbId) : null,
      mode,
      playlist: isPlaylist,
      dir,
      quality: mode === "video" ? quality : null,
      items: isPlaylist && !all ? toRanges(positions) : null,
      selected: isPlaylist ? chosen.length : null,
    });
    setJustAdded(true);
    setTimeout(() => setJustAdded(false), 1600);
  }

  const n = playlist?.count ?? 0;
  const k = chosen.length;
  const cta =
    (isPlaylist
      ? `Download ${k} ${mode === "audio" ? (k === 1 ? "track" : "tracks") : k === 1 ? "video" : "videos"}`
      : mode === "audio"
        ? "Download audio"
        : "Download video") + sizeLabel;

  return (
    <section className="dl-form">
      <label className="dl-field">
        <span className="dl-label">Link</span>
        <div className="bar dl-url">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="Paste a YouTube video or playlist link"
            autoFocus={!initialUrl}
            spellCheck={false}
          />
        </div>
      </label>

      {url.trim() && !valid && <p className="dl-hint">That doesn’t look like a YouTube video or playlist link.</p>}

      {info.state === "loading" && (
        <div className="dl-preview is-loading">
          <div className="dl-thumb skeleton" />
          <div className="dl-preview-text">
            <div className="skeleton line" />
            <div className="skeleton line short" />
          </div>
        </div>
      )}
      {info.state === "error" && <p className="error">{info.error}</p>}

      {ready && (
        <div className="dl-preview">
          <div className="dl-thumb">
            {thumbId && <img src={thumbUrl(thumbId)} alt="" />}
            {isPlaylist && <span className="dl-thumb-badge">{n}</span>}
            {!isPlaylist && ready.kind === "video" && ready.duration ? (
              <span className="dl-thumb-badge">{formatDuration(ready.duration)}</span>
            ) : null}
          </div>
          <div className="dl-preview-text">
            <div className="dl-preview-title" title={title}>
              {title}
            </div>
            <div className="dl-preview-sub">
              {isPlaylist ? `Playlist · ${n} ${n === 1 ? "video" : "videos"}` : ready.channel ?? ""}
            </div>
          </div>
        </div>
      )}

      {canChooseScope && (
        <Segmented
          value={scope}
          onChange={setScope}
          options={[
            { value: "video", label: "This video" },
            { value: "playlist", label: `Playlist (${n})` },
          ]}
        />
      )}

      <div className="dl-row">
        <div className="dl-field grow">
          <span className="dl-label">Format</span>
          <Segmented
            value={mode}
            onChange={(m) => {
              setMode(m);
              savePrefs({ mode: m });
            }}
            options={[
              { value: "video", label: "Video", icon: icons.video, disabled: !hasFfmpeg },
              { value: "audio", label: hasFfmpeg ? "Audio (MP3)" : "Audio (M4A)", icon: icons.audio },
            ]}
          />
        </div>
        {mode === "video" && (
          <label className="dl-field">
            <span className="dl-label">Quality</span>
            <select
              className="dl-select"
              value={quality ?? ""}
              onChange={(e) => {
                const q = e.target.value ? Number(e.target.value) : null;
                setQuality(q);
                savePrefs({ quality: q });
              }}
            >
              {qualityOptions.map((q) => {
                const est = estimate(q.value);
                return (
                  <option key={q.label} value={q.value ?? ""}>
                    {q.label}
                    {est.known && !est.pending ? ` · ≈ ${formatBytes(est.bytes)}` : ""}
                  </option>
                );
              })}
            </select>
          </label>
        )}
      </div>

      {!hasFfmpeg && (
        <p className="dl-hint">
          Video downloads and MP3 need FFmpeg, which wasn’t found. Install it (e.g.{" "}
          <code>brew install ffmpeg</code>) and reopen FocusTube. Audio still works as M4A.
        </p>
      )}

      <div className="dl-field">
        <span className="dl-label">Save to</span>
        <button className="dl-folder" onClick={pickFolder} title={dir}>
          <Icon d={icons.folder} />
          <span className="dl-folder-text">
            <b>{dir ? folderName(dir) : "Choose a folder"}</b>
            {dir && <small>{dir}</small>}
          </span>
          <span className="dl-folder-change">Change</span>
        </button>
      </div>

      {isPlaylist && (
        <PlaylistPicker
          entries={playlist!.entries}
          selected={selected}
          onChange={setSelected}
          sizeOf={(id) =>
            id in entrySizes ? sizeFor(entrySizes[id], mode, mode === "video" ? quality : null, hasFfmpeg) : undefined
          }
          total={total}
        />
      )}

      <button className="btn-primary dl-go" disabled={!ready || !dir || (isPlaylist && !k)} onClick={submit}>
        {justAdded ? (
          <>
            <Icon d={icons.check} /> Added to downloads
          </>
        ) : (
          <>
            <Icon d={icons.download} /> {cta}
          </>
        )}
      </button>
    </section>
  );
}

/** [1,2,3,5,7,8] → "1-3,5,7-8" for yt-dlp's --playlist-items. */
function toRanges(nums: number[]): string {
  const out: string[] = [];
  for (let i = 0; i < nums.length; i++) {
    const start = nums[i];
    while (i + 1 < nums.length && nums[i + 1] === nums[i] + 1) i++;
    out.push(start === nums[i] ? `${start}` : `${start}-${nums[i]}`);
  }
  return out.join(",");
}

function PlaylistPicker({
  entries,
  selected,
  onChange,
  sizeOf,
  total,
}: {
  entries: PlaylistEntry[];
  selected: Set<string>;
  onChange: (s: Set<string>) => void;
  /** undefined = still measuring, null = unavailable. */
  sizeOf: (id: string) => number | null | undefined;
  total: { bytes: number; pending: number };
}) {
  const all = selected.size === entries.length;
  const none = selected.size === 0;
  const toggle = (id: string) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onChange(next);
  };

  return (
    <div className="dl-field">
      <div className="pl-pick-head">
        <label className="check">
          <input
            type="checkbox"
            checked={all}
            ref={(el) => {
              if (el) el.indeterminate = !all && !none;
            }}
            onChange={() => onChange(new Set(all ? [] : entries.map((e) => e.id)))}
          />
          <span>Select all</span>
        </label>
        <span className="pl-pick-sum">
          {selected.size} of {entries.length}
          {!none && (total.bytes > 0 || !total.pending) && ` · ≈ ${formatBytes(total.bytes)}`}
          {!none && total.pending > 0 && (
            <span className="pl-measuring" title="Measuring the remaining videos">
              <span className="spinner tiny" /> {total.pending} left
            </span>
          )}
        </span>
      </div>
      <ul className="pl-pick">
        {entries.map((e, i) => {
          const size = sizeOf(e.id);
          return (
            <li key={`${e.id}-${i}`}>
              <label className={`pl-pick-row ${selected.has(e.id) ? "is-on" : ""}`}>
                <input type="checkbox" checked={selected.has(e.id)} onChange={() => toggle(e.id)} />
                <span className="pl-num">{i + 1}</span>
                <img className="pl-thumb" src={thumbUrl(e.id)} alt="" loading="lazy" />
                <span className="pl-text">
                  <span className="pl-title" title={e.title ?? ""}>
                    {e.title ?? "Untitled video"}
                  </span>
                  <span className="pl-meta">
                    {e.duration ? formatDuration(e.duration) : ""}
                    {e.duration && size !== undefined ? " · " : ""}
                    {size === undefined ? "" : size === null ? "unavailable" : `≈ ${formatBytes(size)}`}
                  </span>
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function Segmented<T extends string>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: string; disabled?: boolean }[];
}) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          role="radio"
          aria-checked={value === o.value}
          className={value === o.value ? "is-on" : ""}
          disabled={o.disabled}
          onClick={() => onChange(o.value)}
        >
          {o.icon && <Icon d={o.icon} size={14} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------- Job list ----------

function JobList({ downloads, onPlayFile }: { downloads: Downloads; onPlayFile: (path: string) => void }) {
  const { jobs, clearFinished } = downloads;
  if (!jobs.length) return null;
  const hasFinished = jobs.some((j) => !isActive(j));
  return (
    <section className="dl-jobs">
      <div className="dl-jobs-head">
        <span className="dl-label">Downloads</span>
        {hasFinished && (
          <button className="linkbtn" onClick={clearFinished}>
            Clear finished
          </button>
        )}
      </div>
      {jobs.map((j) => (
        <JobRow key={j.id} job={j} downloads={downloads} onPlayFile={onPlayFile} />
      ))}
    </section>
  );
}

const STEP_LABELS: Record<string, string> = {
  Merger: "Merging audio and video…",
  ExtractAudio: "Converting to MP3…",
  EmbedThumbnail: "Adding cover art…",
  Metadata: "Writing metadata…",
  FFmpegMetadata: "Writing metadata…",
  MoveFiles: "Finishing…",
};

function jobDetail(j: Job): string {
  const counter = j.playlist && j.index && j.count ? `${j.index} of ${j.count}` : null;
  switch (j.status) {
    case "starting":
      return "Starting…";
    case "downloading": {
      const parts = [
        counter ?? (j.progress != null ? `${Math.round(j.progress * 100)}%` : null),
        j.speed ? `${formatBytes(j.speed)}/s` : null,
        j.eta != null && !j.playlist ? `${formatDuration(j.eta)} left` : null,
      ];
      return parts.filter(Boolean).join(" · ") || "Downloading…";
    }
    case "processing": {
      const step = (j.step && STEP_LABELS[j.step]) ?? "Processing…";
      return counter ? `${counter} · ${step}` : step;
    }
    case "done":
      return j.failures > 0
        ? `Saved · ${j.failures} unavailable ${j.failures === 1 ? "video" : "videos"} skipped`
        : "Saved";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return j.error ?? "Download failed";
  }
}

function JobRow({
  job: j,
  downloads,
  onPlayFile,
}: {
  job: Job;
  downloads: Downloads;
  onPlayFile: (path: string) => void;
}) {
  const active = isActive(j);
  const [revealError, setRevealError] = useState("");
  const reveal = () =>
    showInFolder(j.savedPath ?? j.dir).catch((e) => setRevealError(String(e)));
  const retry = () => {
    downloads.remove(j.id);
    downloads.start(j);
  };

  return (
    <div className={`dl-job is-${j.status}`}>
      <div className="dl-job-thumb">
        {j.thumb && <img src={j.thumb} alt="" />}
        <span className="dl-job-kind" title={j.mode === "audio" ? "Audio" : "Video"}>
          <Icon d={j.mode === "audio" ? icons.audio : icons.video} size={11} />
        </span>
      </div>
      <div className="dl-job-main">
        <div className="dl-job-title" title={j.itemTitle && j.playlist ? j.itemTitle : j.title}>
          {j.title}
        </div>
        <div className="dl-job-detail" title={j.status === "failed" ? (j.error ?? "") : undefined}>
          {revealError || jobDetail(j)}
        </div>
        {(active || j.status === "done") && <Progress value={overallProgress(j)} done={j.status === "done"} />}
      </div>
      <div className="dl-job-actions">
        {active && (
          <button className="iconbtn" onClick={() => downloads.cancel(j.id)} title="Cancel">
            <Icon d={icons.close} size={14} />
          </button>
        )}
        {j.status === "done" && !j.playlist && j.savedPath && (
          <button className="iconbtn" onClick={() => onPlayFile(j.savedPath!)} title="Play in FocusTube">
            <Icon d={icons.play} size={13} />
          </button>
        )}
        {j.status === "done" && (
          <button className="iconbtn" onClick={reveal} title="Show in folder">
            <Icon d={icons.folder} size={14} />
          </button>
        )}
        {(j.status === "failed" || j.status === "cancelled") && (
          <button className="iconbtn" onClick={retry} title="Retry">
            <Icon d={icons.retry} size={14} />
          </button>
        )}
        {!active && (
          <button className="iconbtn" onClick={() => downloads.remove(j.id)} title="Remove from list">
            <Icon d={icons.close} size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

function Progress({ value, done }: { value: number | null; done?: boolean }) {
  return (
    <div className={`progress ${value == null ? "is-indeterminate" : ""} ${done ? "is-done" : ""}`}>
      <div className="progress-fill" style={value == null ? undefined : { width: `${value * 100}%` }} />
    </div>
  );
}
