export function parseVideoId(input: string): string | null {
  const url = input.trim();
  if (!url) return null;

  let m = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];

  m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];

  m = url.match(/\/(embed|shorts)\/([A-Za-z0-9_-]{11})/);
  if (m) return m[2];

  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;

  return null;
}

export function parsePlaylistId(input: string): string | null {
  const m = input.trim().match(/[?&]list=([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

export const thumbUrl = (videoId: string) =>
  `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;
