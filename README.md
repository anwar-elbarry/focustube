# FocusTube

A lightweight desktop app for **working-while-watching YouTube**. Paste a link and get a clean, borderless, **always-on-top** video player — no comments, no recommendations, no browser chrome.

![GitHub release](https://img.shields.io/github/v/release/anouarelbakry/focustube?style=flat&colorA=0c0b0a&colorB=ff6a3d)
![License](https://img.shields.io/badge/license-MIT-green?style=flat&colorA=0c0b0a&colorB=22c55e)

---

## Features

- **Always on top** — stays above every window so the video follows you across apps
- **Borderless & clean** — no title bar, no sidebar, no comments. Just the player
- **Adjustable opacity** — drag the transparency slider to peek through while typing
- **Global play/pause** — <kbd>Space</kbd> or media key works even when the app isn't focused
- **No account needed** — paste any YouTube URL and play. No sign-in, no tracking
- **Tiny footprint** — under 10 MB, zero dependencies

## How it works

1. **Download** the installer for your system
2. **Paste a YouTube link** (watch, youtu.be, or shorts)
3. **Float it** — the video plays in a clean, always-on-top window

## Stack

| Layer | Technology |
|-------|-----------|
| Shell | [Tauri v2](https://v2.tauri.app) (Rust) |
| Frontend | React 18 + TypeScript |
| Bundler | Vite |
| Video | YouTube IFrame API |

## Quick start

```bash
npm install
npm run tauri dev      # development mode
npm run tauri build    # production build
```

### Prerequisites

- [Node.js](https://nodejs.org) LTS
- [Rust](https://rustup.rs)
- WebView2 (preinstalled on Windows 10/11)
- Visual Studio Build Tools with "Desktop development with C++" workload

See [Tauri v2 prerequisites](https://v2.tauri.app/start/prerequisites/) for details.

## Project layout

```
focustube/
├── index.html          # App entry point
├── src/                # React frontend
│   ├── App.tsx         # Main app component
│   ├── Player.tsx      # YouTube player wrapper
│   ├── youtube.ts      # URL parser
│   └── styles.css      # App styles
├── src-tauri/          # Rust shell (Tauri)
│   ├── tauri.conf.json
│   ├── src/lib.rs      # Plugin registration
│   └── icons/
└── website/            # Marketing landing page
    ├── index.html
    ├── styles.css
    └── script.js
```

## Website

The marketing landing page lives in `website/` and is deployed via GitHub Pages. It features OS-aware download buttons that link to the latest GitHub Release.

## Roadmap

- Transparency / click-through mode
- Multi-tile grid (2-3 videos at once)
- Audio-only mode, speed presets
- Timestamp notes, playlists

## License

MIT

---

Created with ❤️ by [Anouar El Barry](https://anouarelbarry.com)
