// ---- Single source of truth: your GitHub repo ----
const REPO = "anwar-elbarry/focustube";
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

// Enable JS-only reveal styles
document.documentElement.classList.add("js");

// Keep GitHub links in sync with REPO
document.querySelectorAll('a[href*="anwar-elbarry/focustube"]').forEach((a) => {
  a.href = a.href.replace("anwar-elbarry/focustube", REPO);
});

// Badge image URLs too
document.querySelectorAll('img[src*="anwar-elbarry/focustube"]').forEach((img) => {
  img.src = img.src.replace("anwar-elbarry/focustube", REPO);
  img.alt = img.alt.replace("anwar-elbarry/focustube", "focustube");
});

// ---- Theme toggle ----
const root = document.documentElement;
const toggle = document.getElementById("theme-toggle");
const themeLabel = toggle.querySelector(".theme-label");
let applyTheme = (t) => {
  root.setAttribute("data-theme", t);
  themeLabel.textContent = t === "light" ? "DARK" : "LIGHT";
};
const stored = localStorage.getItem("focustube-theme");
const prefersLight = window.matchMedia("(prefers-color-scheme: light)").matches;
applyTheme(stored || (prefersLight ? "light" : "dark"));
toggle.addEventListener("click", () => {
  const next = root.getAttribute("data-theme") === "light" ? "dark" : "light";
  localStorage.setItem("focustube-theme", next);
  applyTheme(next);
});

// ---- Animated orb canvas ----
const canvas = document.getElementById("orb-canvas");
const ctx = canvas.getContext("2d");
let w, h, t = 0;

function resize() {
  w = canvas.width = window.innerWidth;
  h = canvas.height = window.innerHeight;
}
resize();
window.addEventListener("resize", resize);

function drawOrbs() {
  const isLight = root.getAttribute("data-theme") === "light";
  ctx.clearRect(0, 0, w, h);

  const orbs = [
    { x: w * 0.2, y: h * 0.15, r: Math.min(w, h) * 0.25, c: isLight ? "255,106,61" : "255,106,61" },
    { x: w * 0.75, y: h * 0.4, r: Math.min(w, h) * 0.3, c: isLight ? "124,92,255" : "124,92,255" },
    { x: w * 0.5, y: h * 0.7, r: Math.min(w, h) * 0.2, c: isLight ? "34,197,94" : "34,197,94" },
  ];

  for (const orb of orbs) {
    const dx = Math.sin(t * 0.0006 + orb.x * 0.01) * 40;
    const dy = Math.cos(t * 0.0005 + orb.y * 0.01) * 40;
    const x = orb.x + dx;
    const y = orb.y + dy;

    const grad = ctx.createRadialGradient(x, y, 0, x, y, orb.r);
    grad.addColorStop(0, `rgba(${orb.c}, ${isLight ? 0.12 : 0.08})`);
    grad.addColorStop(0.5, `rgba(${orb.c}, ${isLight ? 0.06 : 0.04})`);
    grad.addColorStop(1, `rgba(${orb.c}, 0)`);

    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(x, y, orb.r, 0, Math.PI * 2);
    ctx.fill();
  }

  t++;
  requestAnimationFrame(drawOrbs);
}
drawOrbs();

// Re-draw on theme change
const origApply = applyTheme;
applyTheme = (t) => {
  origApply(t);
  // Canvas redraws on next frame via rAF loop
};

// ---- Reveal on scroll ----
const io = new IntersectionObserver(
  (entries) => {
    entries.forEach((e) => {
      if (e.isIntersecting) {
        e.target.classList.add("in");
        io.unobserve(e.target);
      }
    });
  },
  { threshold: 0.12 }
);
document.querySelectorAll(".reveal").forEach((el) => io.observe(el));

// ---- Download buttons ----
function detectOS() {
  const ua = navigator.userAgent;
  if (/Win/i.test(ua)) return "windows";
  if (/Mac/i.test(ua)) return "macos";
  if (/Linux/i.test(ua)) return "linux";
  return "windows";
}

function styleButtons(os) {
  document.querySelectorAll(".btn[data-os]").forEach((b) => {
    const isMine = b.dataset.os === os;
    b.classList.toggle("btn-solid", isMine);
    b.classList.toggle("btn-line", !isMine);
  });
}

// ---- Dynamic GitHub Release Downloads ----
// Maps OS identifiers to patterns that match release asset filenames
const ASSET_PATTERNS = {
  windows: /\.exe$/i,
  macos:   /\.dmg$|\.tar\.gz$|\.app\.zip$|_darwin|macos/i,
  linux:   /\.AppImage$|\.deb$|\.rpm$/i,
};

// Fallback URLs in case the API call fails
const FALLBACK_URLS = {
  windows: `https://github.com/${REPO}/releases/latest`,
  macos:   `https://github.com/${REPO}/releases/latest`,
  linux:   `https://github.com/${REPO}/releases/latest`,
};

// Cache for resolved download URLs
let resolvedAssets = null;
let fetchAttempted = false;

/**
 * Fetches the latest release from the GitHub API and extracts
 * browser_download_url for each OS from the release assets.
 */
async function fetchLatestRelease() {
  if (fetchAttempted) return resolvedAssets;
  fetchAttempted = true;

  try {
    const response = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
    if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);

    const release = await response.json();
    const assets = release.assets || [];

    resolvedAssets = {};
    for (const [os, pattern] of Object.entries(ASSET_PATTERNS)) {
      const match = assets.find((a) => pattern.test(a.name));
      if (match) {
        resolvedAssets[os] = match.browser_download_url;
      }
    }

    // Update version display if available
    if (release.tag_name) {
      const versionEls = document.querySelectorAll(".release-version");
      versionEls.forEach((el) => (el.textContent = release.tag_name));
    }

    return resolvedAssets;
  } catch (err) {
    console.warn("FocusTube: Could not fetch latest release from GitHub API:", err);
    return null;
  }
}

/**
 * Triggers a direct file download by navigating to the GitHub download URL.
 * GitHub's browser_download_url already serves files with
 * Content-Disposition: attachment headers, so navigating triggers a download
 * without leaving the page.
 */
function triggerDirectDownload(url) {
  window.location.href = url;
}

/**
 * Handles a download button click:
 * 1. Prevents default navigation
 * 2. Shows a "downloading…" state on the button
 * 3. Fetches the latest release URL (cached after first call)
 * 4. Triggers a direct download or falls back to releases page
 */
async function handleDownloadClick(e) {
  const btn = e.currentTarget;
  const os = btn.dataset.os;
  if (!os) return; // Not an OS download button

  e.preventDefault();

  // Show loading state
  const originalHTML = btn.innerHTML;
  btn.classList.add("btn-downloading");
  const iconHTML = btn.querySelector(".os-ico") ? btn.querySelector(".os-ico").outerHTML : "";
  btn.innerHTML = `${iconHTML} Downloading…`;
  btn.style.pointerEvents = "none";

  try {
    const assets = await fetchLatestRelease();
    const url = assets && assets[os];

    if (url) {
      triggerDirectDownload(url);
    } else {
      // No matching asset found — fall back to releases page
      window.location.href = FALLBACK_URLS[os];
    }
  } catch {
    // On any error, fall back to releases page
    window.location.href = FALLBACK_URLS[os];
  } finally {
    // Restore button state after a short delay
    setTimeout(() => {
      btn.innerHTML = originalHTML;
      btn.classList.remove("btn-downloading");
      btn.style.pointerEvents = "";
    }, 2000);
  }
}

/**
 * Wire up all download buttons and set initial state.
 * Pre-fetches the release data so the first click is instant.
 */
function wireDownloads() {
  const os = detectOS();
  styleButtons(os);

  // Attach click handlers to all download buttons
  document.querySelectorAll(".btn[data-os]").forEach((btn) => {
    btn.addEventListener("click", handleDownloadClick);
  });

  // Wire up "all releases" links
  const allReleasesLinks = document.querySelectorAll("#all-releases, #all-releases-foot");
  allReleasesLinks.forEach((link) => {
    link.href = `https://github.com/${REPO}/releases/latest`;
    link.target = "_blank";
    link.rel = "noopener";
  });

  // Update the download note
  const note = document.getElementById("download-note");
  if (note)
    note.innerHTML = `Download auto-detected for your system — <a href="https://github.com/${REPO}/releases/latest" target="_blank" rel="noopener">see all downloads</a>`;

  // Pre-fetch release data in the background for instant first click
  fetchLatestRelease();
}

wireDownloads();
