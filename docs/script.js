// ---- Single source of truth: your GitHub repo ----
const REPO = "anwar-elbarry/focustube";
const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

// Enable JS-only reveal styles
document.documentElement.classList.add("js");

// Keep GitHub links in sync with REPO
document.querySelectorAll('a[href*="OWNER/focustube"]').forEach((a) => {
  a.href = a.href.replace("OWNER/focustube", REPO);
});

// Badge image URLs too
document.querySelectorAll('img[src*="OWNER/focustube"]').forEach((img) => {
  img.src = img.src.replace("OWNER/focustube", REPO);
  img.alt = img.alt.replace("OWNER/focustube", "focustube");
});

// ---- Theme toggle ----
const root = document.documentElement;
const toggle = document.getElementById("theme-toggle");
const themeLabel = toggle.querySelector(".theme-label");
const applyTheme = (t) => {
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

const RELEASES_URL = `https://github.com/${REPO}/releases/latest`;
const REPO_URL = `https://github.com/${REPO}`;

function wireDownloads() {
  const os = detectOS();
  styleButtons(os);
  const note = document.getElementById("download-note");

  fetch(`https://api.github.com/repos/${REPO}/releases/latest`)
    .then((r) => {
      if (!r.ok) throw new Error("No release found");
      return r.json();
    })
    .then((release) => {
      const assetMap = {
        windows: (a) => a.name.endsWith(".exe"),
        macos: (a) => a.name.endsWith(".tar.gz"),
        linux: (a) => a.name.endsWith(".AppImage"),
      };

      document.querySelectorAll(".btn[data-os]").forEach((btn) => {
        const match = release.assets.find(assetMap[btn.dataset.os]);
        if (match) btn.href = match.browser_download_url;
      });

      const allLinks = [
        document.getElementById("all-releases"),
        document.getElementById("all-releases-foot"),
      ];
      allLinks.forEach((l) => l && (l.href = release.html_url));

      if (note)
        note.innerHTML = `Download auto-detected for your system — <a href="${release.html_url}">see all downloads</a>`;
    })
    .catch(() => {
      document
        .querySelectorAll(".btn[data-os]")
        .forEach((b) => (b.href = REPO_URL));
      if (note)
        note.innerHTML = `<a href="${RELEASES_URL}">Visit the releases page</a> to download`;
    });
}

wireDownloads();
