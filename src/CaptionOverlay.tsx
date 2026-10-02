import { CaptionPrefs, Cue, cueIndexAt } from "./captions";

/** FocusTube's own caption renderer, drawn over the player. */
export default function CaptionOverlay({
  cues,
  cues2,
  time,
  prefs,
  strip,
}: {
  cues: Cue[];
  cues2: Cue[];
  time: number;
  prefs: CaptionPrefs;
  /** Caption strip mode: fills the whole (tiny) window. */
  strip?: boolean;
}) {
  const i = cueIndexAt(cues, time);
  const j = cueIndexAt(cues2, time);
  const line1 = i >= 0 ? cues[i].text : "";
  const line2 = j >= 0 ? cues2[j].text : "";

  if (strip) {
    return (
      <div className="caption-strip" data-tauri-drag-region>
        {line1 || line2 ? (
          <>
            {line1 && <p className="cap-line" data-tauri-drag-region>{line1}</p>}
            {line2 && <p className="cap-line is-second" data-tauri-drag-region>{line2}</p>}
          </>
        ) : (
          <p className="cap-line is-idle" data-tauri-drag-region>
            {cues.length ? "…" : "No captions for this video"}
          </p>
        )}
      </div>
    );
  }

  if (!line1 && !line2) return null;
  return (
    <div
      className={`caption-overlay is-${prefs.position} size-${prefs.size} ${prefs.background ? "has-bg" : ""}`}
      aria-live="off"
    >
      {line1 && <span className="cap-line">{line1}</span>}
      {line2 && <span className="cap-line is-second">{line2}</span>}
    </div>
  );
}
