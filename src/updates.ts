import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";

const REPO = "anwar-elbarry/focustube";
export const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const LAST_CHECK = "focustube.updateCheckedAt";
const CHECK_EVERY_MS = 12 * 60 * 60 * 1000;

export type UpdateInfo = { current: string; latest: string; url: string };

/** "v1.2.10" > "1.2.9" */
function newer(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(".").map(Number);
  const pb = b.replace(/^v/, "").split(".").map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d) return d > 0;
  }
  return false;
}

/** Ask GitHub for the latest release; null when up to date. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const current = await getVersion();
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!res.ok) throw new Error(`GitHub returned ${res.status}`);
  const release = await res.json();
  const latest = String(release.tag_name ?? "").replace(/^v/, "");
  return latest && newer(latest, current)
    ? { current, latest, url: release.html_url ?? RELEASES_URL }
    : null;
}

/** Checks at most every 12 hours, quietly ignoring network errors. */
export function useUpdateCheck() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    let last = 0;
    try {
      last = Number(localStorage.getItem(LAST_CHECK)) || 0;
    } catch {
      /* ignore */
    }
    if (Date.now() - last < CHECK_EVERY_MS) return;
    checkForUpdate()
      .then((u) => {
        try {
          localStorage.setItem(LAST_CHECK, String(Date.now()));
        } catch {
          /* ignore */
        }
        setUpdate(u);
      })
      .catch(() => {});
  }, []);

  return [update, setUpdate] as const;
}
