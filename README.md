# FocusTube

A lightweight desktop app for **working-while-watching YouTube**. Paste a link and get a
clean, borderless, **always-on-top** video player — no comments, no recommendations, no
browser chrome.

Stack: **Tauri v2** (Rust) + **React 18** + **TypeScript** + **Vite**. The player uses the
YouTube IFrame API, which already hides comments and recommendations.

## Features (MVP)
- Paste any YouTube link (watch / youtu.be / shorts / embed) → clean player.
- Borderless window, draggable via the title bar, always-on-top by default.
- Pin / unpin toggle, close, and "New video" from the title bar.
- Global hotkey: **Space** toggles play/pause (even when the app isn't focused).

## Prerequisites (Windows)
1. **Node.js** (LTS) — https://nodejs.org
2. **Rust** via rustup — https://rustup.rs
3. **WebView2** is preinstalled on Windows 10/11.
4. **Visual Studio Build Tools** with "Desktop development with C++" workload.

See https://v2.tauri.app/start/prerequisites/ for the full list.

## Run it
```powershell
cd focustube
npm install
npm run tauri dev      # builds the Rust shell + launches the app
```

## Build an installer
```powershell
npm run tauri build    # outputs to src-tauri/target/release/bundle
```

## Replace the icon
The shipped icons are placeholders. Generate proper ones from any square PNG:
```powershell
npm run tauri icon path/to/icon.png
```

## Project layout
```
focustube/
  index.html
  src/            React frontend (App, Player, youtube URL parser, styles)
  src-tauri/      Rust shell (window config, global-shortcut plugin)
    tauri.conf.json
    icons/
```

## Roadmap (post-MVP)
- Transparency / click-through mode (watch while clicking through the video).
- Multi-tile grid (2–3 videos at once).
- Audio-only mode, speed presets, section loop.
- Timestamp notes, playlists, resume-per-video persistence.
