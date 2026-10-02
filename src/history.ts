// Watch history: powers "continue where you left off" and the recent list.
// Per-viewer convenience data, so localStorage is the right home; every
// access is guarded because storage can be unavailable.

export type HistoryKind = "video" | "playlist" | "file";

export type HistoryItem = {
  /** "v:<videoId>" | "p:<listId>" | "f:<path>" */
  key: string;
  kind: HistoryKind;
  videoId: string | null;
  listId: string | null;
  path: string | null;
  title: string;
  channel: string | null;
  /** Seconds into the current video. */
  position: number;
  duration: number | null;
  /** Position within a playlist (0-based). */
  index: number | null;
  count: number | null;
  updatedAt: number;
};

const STORE = "focustube.history";
const MAX = 30;

export function loadHistory(): HistoryItem[] {
  try {
    const items = JSON.parse(localStorage.getItem(STORE) || "[]");
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

function saveHistory(items: HistoryItem[]) {
  try {
    localStorage.setItem(STORE, JSON.stringify(items.slice(0, MAX)));
  } catch {
    /* storage unavailable — history just won't persist */
  }
  window.dispatchEvent(new Event("focustube-history"));
}

export const historyKey = (s: { videoId?: string | null; listId?: string | null; path?: string | null }) =>
  s.path ? `f:${s.path}` : s.listId ? `p:${s.listId}` : `v:${s.videoId}`;

export function getHistoryItem(key: string): HistoryItem | undefined {
  return loadHistory().find((i) => i.key === key);
}

/** Insert or update an entry and move it to the front. */
export function recordHistory(item: Omit<HistoryItem, "updatedAt">) {
  const rest = loadHistory().filter((i) => i.key !== item.key);
  saveHistory([{ ...item, updatedAt: Date.now() }, ...rest]);
}

export function removeHistory(key: string) {
  saveHistory(loadHistory().filter((i) => i.key !== key));
}

/** Worth resuming: past the intro and not basically finished. */
export function resumable(position: number, duration: number | null): boolean {
  return position > 15 && (duration == null || position < duration - 20);
}
