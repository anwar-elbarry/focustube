<div align="center">

<img src="src-tauri/icons/icon.png" alt="FocusTube Logo" width="96" height="96" />

# FocusTube

**YouTube — without the noise.**

A borderless, always-on-top desktop video player built for people who work and watch at the same time.

<br/>

[![GitHub release](https://img.shields.io/github/v/release/anwar-elbarry/focustube?style=for-the-badge&colorA=0c0b0a&colorB=ff6a3d&label=Latest)](https://github.com/anwar-elbarry/focustube/releases/latest)
[![License](https://img.shields.io/badge/License-MIT-22c55e?style=for-the-badge&colorA=0c0b0a)](LICENSE)
[![Built with Tauri](https://img.shields.io/badge/Built%20with-Tauri%20v2-24C8DB?style=for-the-badge&colorA=0c0b0a&logo=tauri)](https://v2.tauri.app)
[![Made with Rust](https://img.shields.io/badge/Powered%20by-Rust-CE422B?style=for-the-badge&colorA=0c0b0a&logo=rust)](https://www.rust-lang.org)

<br/>

![FocusTube App Screenshot](docs/screenshot.png)

</div>

---

## ✨ Why FocusTube?

> You open YouTube to watch one tutorial. Fifteen minutes later you're deep in the recommendations rabbit hole, reading comments, and have completely forgotten what you were doing.

**FocusTube fixes that.**

Paste a link → get a clean, floating video player with zero distractions. It floats above your work. You stay in the zone.

---

## 🚀 Features

| | Feature | Details |
|---|---|---|
| 📌 | **Always on Top** | Floats above every window — VSCode, Figma, terminal, anything |
| 🧼 | **Zero Clutter** | No sidebar, no comments, no ads, no recommended videos |
| 🌫️ | **Adjustable Opacity** | Drag the slider — the player becomes semi-transparent so you can see your work through it |
| 🖱️ | **Click-through Mode** | Clicks pass straight through the player to the window behind it. `Ctrl+Alt+C` toggles it |
| 🪟 | **Mini Player** | One shortcut (`Ctrl+M`) shrinks it into a small corner player with controls on hover |
| 🔍 | **Search Inside the App** | Search YouTube videos, YouTube Music songs and playlists without opening a browser (`Ctrl+K`, or just type in the start box). Play or download any result in one click |
| 📃 | **Playlists** | Paste a playlist link, browse every video, jump to any of them or skip ahead (`Shift+N` / `Shift+P`) |
| ⏯️ | **Pick Up Where You Left Off** | Remembers your position in every video and playlist, with a recent list on the start screen |
| ⬇️ | **Downloads** | Save videos (up to 4K, MP4) or audio (MP3) — single videos or chosen videos from a playlist, with sizes shown before you start. Powered by [yt-dlp](https://github.com/yt-dlp/yt-dlp) |
| 📁 | **Offline Playback** | Open downloaded or local video and audio files right in the player (`Ctrl+O`) |
| ⏩ | **Playback Speed** | 0.75× to 2× from the menu, or `Shift+<` / `Shift+>` |
| 💬 | **Captions & Subtitles** | Styled captions for YouTube and local files (auto-loads `video.srt` / `.vtt`), dual-language subtitles, and subtitles with downloads |
| 🔎 | **Find Subtitles Online** | Search OpenSubtitles.com and apply in one click. Local files are matched by their exact file hash; adjust timing with `G` / `H`. Uses your own free OpenSubtitles API key |
| 📝 | **Transcript & Notes** | Searchable transcript that follows the video, click-to-jump, timestamp notes exported to Markdown |
| 🎞️ | **Caption Strip** | Shrink to a slim bar of large live captions (`Shift+S`) |
| ✨ | **AI with Your Own Key** | Video summaries with clickable chapters, ask questions about a video, AI-translated captions. Bring a key from Claude, OpenAI, Gemini, OpenRouter, or use a local model. No key, no AI, everything else still works |
| 🍅 | **Focus Timer** | Built-in 25/5 or 50/10 Pomodoro timer that pauses the video when it's break time |
| ⌨️ | **Play/Pause Anywhere** | `Space` while FocusTube is focused, or your keyboard's media key from any app |
| 🔗 | **Any YouTube URL** | Works with `youtube.com/watch`, `youtu.be`, Shorts and playlist links |
| 🔒 | **No Account Needed** | Paste and play. No sign-in, no tracking, no cookies |
| 🔔 | **Update Notices** | Tells you when a new version is out |

---

## ⚡ Get Started in 3 Steps

```
1.  Download  →  Grab the installer for your OS from the Releases page
2.  Paste     →  Drop any YouTube link into FocusTube
3.  Float     →  Your video plays in a clean window above everything else
```

> **Downloads** need a one-time setup inside the app, which fetches yt-dlp and (on Windows) FFmpeg, about 190 MB. On macOS and Linux, install FFmpeg yourself (`brew install ffmpeg` / your package manager) to download video or MP3. Please only download content you have the right to.

### ⌨️ Shortcuts

| Keys | Action |
|---|---|
| `Ctrl+K` | Search YouTube |
| `Space` | Play / pause (while FocusTube is focused) |
| Media Play/Pause key | Play / pause from any app |
| `Shift+N` / `Shift+P` | Next / previous video in a playlist |
| `Shift+>` / `Shift+<` | Faster / slower |
| `Ctrl+M` | Mini player on / off |
| `Ctrl+Alt+C` | Click-through on / off |
| `Ctrl+O` | Open a local file |
| `C` | Captions on / off |
| `Shift+T` | Transcript, notes & AI |
| `Shift+S` | Caption strip on / off |
| `G` / `H` | Subtitles earlier / later (0.25 s) |

On macOS use `⌘` instead of `Ctrl`.

> **AI features are bring-your-own-key.** Add a key under **⋯ → AI features**. It is stored only on your computer and sent only to the provider you choose; using a feature sends the video's title and transcript to that provider, billed to your account. Captions for YouTube videos use the downloader tools (one-time setup).

[![Download for Windows](https://img.shields.io/badge/⬇%20Download-Windows-0078D4?style=for-the-badge&colorA=0c0b0a)](https://github.com/anwar-elbarry/focustube/releases/latest)
[![Download for macOS](https://img.shields.io/badge/⬇%20Download-macOS-lightgrey?style=for-the-badge&colorA=0c0b0a)](https://github.com/anwar-elbarry/focustube/releases/latest)
[![Download for Linux](https://img.shields.io/badge/⬇%20Download-Linux-E95420?style=for-the-badge&colorA=0c0b0a)](https://github.com/anwar-elbarry/focustube/releases/latest)

---

## 🛠️ Tech Stack

```
┌─────────────────────────────────────────────────────┐
│                     FocusTube                       │
├──────────────┬──────────────────────────────────────┤
│  Shell       │  Tauri v2  (Rust)                    │
│  Frontend    │  React 18 + TypeScript                │
│  Bundler     │  Vite                                 │
│  Video       │  YouTube IFrame API                   │
│  Downloads   │  yt-dlp + FFmpeg (fetched on demand)  │
│  Styling     │  Vanilla CSS                          │
└──────────────┴──────────────────────────────────────┘
```

---

## 🧑‍💻 Build from Source

### Prerequisites

Make sure you have the following installed:

- [Node.js](https://nodejs.org) LTS
- [Rust](https://rustup.rs) (stable toolchain)
- WebView2 — preinstalled on Windows 10 / 11
- Visual Studio Build Tools with **"Desktop development with C++"** workload

> Full setup guide: [Tauri v2 Prerequisites](https://v2.tauri.app/start/prerequisites/)

### Commands

```bash
# Install dependencies
npm install

# Start development mode (hot reload)
npm run tauri dev

# Build production installer
npm run tauri build
```

---

## 📁 Project Structure

```
focustube/
├── index.html              # App entry point
├── src/                    # React frontend
│   ├── App.tsx             # Main app shell, title bar, shortcuts, mini / click-through modes
│   ├── Player.tsx          # YouTube IFrame player wrapper (playlists, resume)
│   ├── LocalPlayer.tsx     # Offline playback of local files
│   ├── DownloadPanel.tsx   # Download UI (setup, sizes, playlist picker, progress)
│   ├── PlaylistPanel.tsx   # Playlist browser for the player
│   ├── MoreMenu.tsx        # Speed, mini player, click-through, timer, updates
│   ├── downloads.ts        # Download state + backend calls
│   ├── history.ts          # Resume positions + recent list
│   ├── focusTimer.ts       # Pomodoro timer
│   ├── updates.ts          # New-version check (GitHub releases)
│   ├── youtube.ts          # URL parser (watch / youtu.be / shorts / playlists)
│   └── styles.css          # All app styles
├── src-tauri/              # Rust + Tauri backend
│   ├── tauri.conf.json     # Window config, permissions
│   ├── src/lib.rs          # Plugin + command registration
│   ├── src/downloader.rs   # yt-dlp / FFmpeg setup, metadata, sizes, downloads
│   └── icons/              # App icons (all sizes)
└── docs/                   # Marketing landing page (GitHub Pages)
    ├── index.html
    ├── styles.css
    └── script.js
```

---

## 🗺️ Roadmap

- [x] Click-through mode
- [x] Playback speed presets
- [x] Mini player
- [x] Downloads (video, audio, playlists) + offline playback
- [x] Resume where you left off
- [ ] Multi-tile grid — watch 2–3 videos side by side
- [ ] Timestamp notes & personal playlists
- [ ] Picture-in-picture snap zones
- [ ] One-click self-installing updates

---

## 🌐 Website

👉 **[focustube-puce.vercel.app](https://focustube-puce.vercel.app)**

---

<div align="center">

Made with ❤️ by **[Anouar El Barry](https://elbarry.me)**

*If FocusTube helped you stay focused, consider giving it a ⭐ on GitHub!*

</div>
