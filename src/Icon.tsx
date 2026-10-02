export const Icon = ({
  d,
  size = 16,
  fill = "none",
}: {
  d: string;
  size?: number;
  fill?: string;
}) => (
  <svg
    viewBox="0 0 24 24"
    width={size}
    height={size}
    fill={fill}
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden
  >
    <path d={d} />
  </svg>
);

export const icons = {
  download: "M12 4v11 M7 10.5l5 5 5-5 M5 20h14",
  close: "M18 6L6 18M6 6l12 12",
  folder: "M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z",
  retry: "M4 12a8 8 0 1 0 2.5-5.8 M4 4v4h4",
  video: "M4 6h11a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1z M16 10l5-3v10l-5-3",
  audio: "M9 18V6l11-2v12 M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0z M20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z",
  check: "M5 12.5l4.5 4.5L19 7.5",
  list: "M4 6h11 M4 12h11 M4 18h7 M17 15v6l4-3z",
  next: "M6 6l8 6-8 6z M18 6v12",
  prev: "M18 6l-8 6 8 6z M6 6v12",
  play: "M7 5l12 7-12 7z",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  mini: "M3 5h18v14H3z M12 12h7v5h-7z",
  expand: "M15 3h6v6 M9 21H3v-6 M21 3l-7 7 M3 21l7-7",
  pointer: "M5 3l14 7-6 2-2 6z M13 13l6 6",
  timer: "M12 8v5l3 2 M9 2h6 M12 22a8 8 0 1 0 0-16 8 8 0 0 0 0 16z",
  external: "M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6 M15 3h6v6 M10 14L21 3",
  pin: "M12 3l2 6h-4z M12 9v8 M9.5 12.5h5",
  plus: "M12 5v14M5 12h14",
  minimize: "M5 12h14",
  history: "M3 12a9 9 0 1 0 3-6.7 M3 4v5h5 M12 7v5l3 2",
  cc: "M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z M10.5 10a2.2 2.2 0 1 0 0 4 M17 10a2.2 2.2 0 1 0 0 4",
  transcript: "M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5",
  strip: "M3 9h18v6H3z M7 12h6",
  note: "M12 5v14M5 12h14",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M21 21l-5-5",
  trash: "M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13",
  bookmark: "M6 3h12v18l-6-4-6 4z",
  sparkle: "M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8z M19 17l.7 1.8 1.8.7-1.8.7L19 22l-.7-1.8-1.8-.7 1.8-.7z",
};
