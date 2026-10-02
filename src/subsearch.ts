import { invoke } from "@tauri-apps/api/core";

export const OS_KEY_URL = "https://www.opensubtitles.com/api";
export const OS_SIGNUP_URL = "https://www.opensubtitles.com/users/sign_up";

export type OsConfig = { hasKey: boolean; keyHint: string; username: string; signedIn: boolean };

export type SubResult = {
  fileId: number;
  fileName: string;
  language: string;
  release: string;
  title: string;
  year: number | null;
  season: number | null;
  episode: number | null;
  downloads: number;
  hearingImpaired: boolean;
  machineTranslated: boolean;
  trusted: boolean;
  /** Made for this exact file: timing should already be right. */
  exactMatch: boolean;
  fps: number | null;
};

export type Downloaded = { text: string; fileName: string; remaining: number | null; resetTime: string | null };

export const osGetConfig = () => invoke<OsConfig>("os_get_config");
export const osSaveKey = (apiKey: string) => invoke<OsConfig>("os_save_key", { apiKey });
export const osLogin = (username: string, password: string) => invoke<OsConfig>("os_login", { username, password });
export const osLogout = () => invoke<OsConfig>("os_logout");
export const osSearch = (args: { query?: string; path?: string; languages: string }) =>
  invoke<SubResult[]>("os_search", { args });
export const osDownload = (fileId: number) => invoke<Downloaded>("os_download", { fileId });
export const osSaveBeside = (videoPath: string, lang: string, contents: string) =>
  invoke<string>("os_save_beside", { videoPath, lang, contents });

const JUNK =
  /\b(2160p|1080p|720p|480p|4k|uhd|hdr|bluray|blu-ray|brrip|bdrip|web-?dl|webrip|web|hdtv|dvdrip|x264|x265|h\.?264|h\.?265|hevc|aac|ac3|dts|ddp?5\.1|10bit|proper|repack|extended|remastered)\b/i;

/**
 * A search query from a release file name:
 * "The.Movie.2019.1080p.BluRay.x264-GRP.mkv" → "The Movie 2019",
 * "Show.Name.S02E05.720p.WEB.mkv" → "Show Name S02E05".
 */
export function queryFromFileName(name: string): string {
  let s = name.replace(/\.[a-z0-9]{2,4}$/i, "").replace(/[._]+/g, " ").replace(/\s+/g, " ").trim();
  const episode = s.match(/^(.*?\bS\d{1,2}E\d{1,3})\b/i);
  if (episode) return episode[1].trim();
  const year = s.match(/^(.*?\b(19|20)\d{2})\b/);
  if (year && year[1].length > 4) return year[1].replace(/[([]+\s*((19|20)\d{2})$/, "$1").trim();
  const junk = s.search(JUNK);
  if (junk > 0) s = s.slice(0, junk);
  return s.replace(/[-([\s]+$/, "").trim();
}

/** A short label for a result, e.g. "S02E05" or "2019". */
export function resultTag(r: SubResult): string {
  if (r.season != null && r.episode != null)
    return `S${String(r.season).padStart(2, "0")}E${String(r.episode).padStart(2, "0")}`;
  return r.year ? String(r.year) : "";
}
