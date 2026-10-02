import { useEffect, useRef, useState } from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { getHistoryItem, historyKey, recordHistory, resumable } from "./history";

export const fileName = (path: string) => path.split(/[\\/]/).pop() ?? path;

/**
 * Plays a file from disk (offline). Exposes the same small control surface
 * as the YouTube player (play/pause, speed, seek) so shortcuts work on both.
 */
export default function LocalPlayer({
  path,
  onPlayer,
  onResume,
}: {
  path: string;
  onPlayer?: (player: any) => void;
  onResume?: (position: number) => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [error, setError] = useState("");
  const isAudio = /\.(mp3|m4a|aac|ogg|opus|wav|flac)$/i.test(path);

  // Files are only served after the backend allows this exact path.
  useEffect(() => {
    let cancelled = false;
    setSrc(null);
    setError("");
    invoke("allow_media", { path })
      .then(() => !cancelled && setSrc(convertFileSrc(path)))
      .catch((e) => !cancelled && setError(String(e)));
    return () => {
      cancelled = true;
    };
  }, [path]);

  useEffect(() => {
    const v = ref.current;
    if (!v || !src) return;
    const key = historyKey({ path });
    const saved = getHistoryItem(key);
    let started = false;

    const save = () =>
      recordHistory({
        key,
        kind: "file",
        videoId: null,
        listId: null,
        path,
        title: fileName(path),
        channel: null,
        position: v.ended ? 0 : v.currentTime,
        duration: Number.isFinite(v.duration) ? v.duration : null,
        index: null,
        count: null,
      });

    const onLoaded = () => {
      if (saved && resumable(saved.position, v.duration)) {
        v.currentTime = saved.position;
        onResume?.(saved.position);
      }
    };
    const onPlay = () => {
      started = true;
      save();
    };
    const onPauseOrEnd = () => started && save();
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPauseOrEnd);
    v.addEventListener("ended", onPauseOrEnd);
    const t = setInterval(() => !v.paused && save(), 5000);

    // Same method names as the YouTube IFrame player.
    onPlayer?.({
      getPlayerState: () => (v.ended ? 0 : v.paused ? 2 : 1),
      playVideo: () => v.play(),
      pauseVideo: () => v.pause(),
      seekTo: (s: number) => {
        v.currentTime = s;
      },
      setPlaybackRate: (r: number) => {
        v.playbackRate = r;
      },
      getCurrentTime: () => v.currentTime,
    });

    return () => {
      clearInterval(t);
      if (started) save();
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPauseOrEnd);
      v.removeEventListener("ended", onPauseOrEnd);
      onPlayer?.(null);
    };
  }, [src, path, onPlayer, onResume]);

  if (error) {
    return (
      <div className="player-loading error">
        <p className="label">Couldn’t open this file.</p>
        <p className="label dim">{error}</p>
      </div>
    );
  }

  return (
    <div className={`local-player ${isAudio ? "is-audio" : ""}`}>
      {isAudio && <div className="local-audio-title">{fileName(path)}</div>}
      {src && (
        <video
          ref={ref}
          src={src}
          controls
          autoPlay
          onError={() => setError("This file’s format can’t be played here. Try MP4, WebM or MP3.")}
        />
      )}
    </div>
  );
}
