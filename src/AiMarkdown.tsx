import { Fragment, ReactNode } from "react";

const STAMP = /^\[(\d{1,2}:)?\d{1,2}:\d{2}\]$/;
const INLINE = /(\*\*[^*]+\*\*|`[^`]+`|\[(?:\d{1,2}:)?\d{1,2}:\d{2}\])/g;

const toSeconds = (stamp: string) =>
  stamp
    .slice(1, -1)
    .split(":")
    .map(Number)
    .reduce((acc, n) => acc * 60 + n, 0);

function inline(text: string, onSeek: (t: number) => void): ReactNode[] {
  return text.split(INLINE).map((part, i) => {
    if (!part) return null;
    if (STAMP.test(part)) {
      return (
        <button key={i} className="ai-stamp" onClick={() => onSeek(toSeconds(part))}>
          {part.slice(1, -1)}
        </button>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i}>{part.slice(1, -1)}</code>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}

/**
 * A small, safe Markdown renderer for model output (headings, lists, bold,
 * code) that turns [m:ss] timestamps into buttons that seek the video.
 * Builds React elements only, never HTML strings.
 */
export default function AiMarkdown({ text, onSeek }: { text: string; onSeek: (t: number) => void }) {
  const blocks: ReactNode[] = [];
  let list: { ordered: boolean; items: ReactNode[] } | null = null;
  const flush = () => {
    if (!list) return;
    const Tag = list.ordered ? "ol" : "ul";
    blocks.push(<Tag key={blocks.length}>{list.items}</Tag>);
    list = null;
  };

  for (const raw of text.replace(/\r/g, "").split("\n")) {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-*•]\s+(.*)$/);
    const numbered = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const heading = line.match(/^#{1,6}\s+(.*)$/);
    if (bullet || numbered) {
      const ordered = !bullet;
      if (list && list.ordered !== ordered) flush();
      if (!list) list = { ordered, items: [] };
      list.items.push(<li key={list.items.length}>{inline((bullet ?? numbered)![1], onSeek)}</li>);
      continue;
    }
    flush();
    if (heading) blocks.push(<h4 key={blocks.length}>{inline(heading[1], onSeek)}</h4>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line, onSeek)}</p>);
  }
  flush();
  return <div className="ai-md">{blocks}</div>;
}
