import { useEffect, useState } from "react";
import { formatStamp } from "./captions";

export type Note = {
  id: string;
  /** Seconds into the video. */
  t: number;
  /** The caption line the note was taken from. */
  quote: string;
  /** The user's own words. */
  text: string;
};

export type NoteBook = { title: string; url: string | null; notes: Note[] };

const STORE = "focustube.notes";

function loadAll(): Record<string, NoteBook> {
  try {
    return JSON.parse(localStorage.getItem(STORE) || "{}");
  } catch {
    return {};
  }
}

function saveAll(all: Record<string, NoteBook>) {
  try {
    localStorage.setItem(STORE, JSON.stringify(all));
  } catch {
    /* storage unavailable */
  }
}

/** Timestamp notes for one video ("v:<id>" or "f:<path>"). */
export function useNotes(key: string | null, title: string, url: string | null) {
  const [notes, setNotes] = useState<Note[]>([]);

  useEffect(() => {
    setNotes(key ? (loadAll()[key]?.notes ?? []) : []);
  }, [key]);

  function commit(next: Note[]) {
    if (!key) return;
    setNotes(next);
    const all = loadAll();
    if (next.length) all[key] = { title, url, notes: next };
    else delete all[key];
    saveAll(all);
  }

  return {
    notes,
    add: (t: number, quote: string) =>
      commit(
        [...notes, { id: crypto.randomUUID(), t, quote, text: "" }].sort((a, b) => a.t - b.t)
      ),
    update: (id: string, text: string) => commit(notes.map((n) => (n.id === id ? { ...n, text } : n))),
    remove: (id: string) => commit(notes.filter((n) => n.id !== id)),
  };
}

/** Notes as Markdown, with timestamps that link back into the video. */
export function notesToMarkdown(title: string, url: string | null, notes: Note[]): string {
  const link = (t: number) => (url ? `${url}${url.includes("?") ? "&" : "?"}t=${Math.floor(t)}s` : null);
  const lines = [`# Notes — ${title}`, ""];
  if (url) lines.push(url, "");
  for (const n of notes) {
    const stamp = formatStamp(n.t);
    const l = link(n.t);
    lines.push(`- ${l ? `[${stamp}](${l})` : stamp}${n.quote ? ` — ${n.quote.replace(/\n/g, " ")}` : ""}`);
    if (n.text.trim()) lines.push(...n.text.trim().split("\n").map((t) => `  > ${t}`));
  }
  lines.push("", `_Exported from FocusTube_`, "");
  return lines.join("\n");
}
