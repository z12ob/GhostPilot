# GhostPilot

Open-source, local-first invisible AI overlay for real-time meeting and coding assistance. A free, self-hosted alternative to Cluely.

Bring your own API key: OpenAI, Anthropic, Google Gemini, or any OpenAI-compatible endpoint.

## What it does

GhostPilot floats a glass panel over your screen. It reads three inputs separately: your screen, your microphone, and system meeting audio. An AI model uses that context to help during live calls and coding sessions.

| Feature | Trigger | Inputs |
|---|---|---|
| Assist | `Ctrl+Enter` (Windows) / `⌘+Enter` (macOS) | screen + conversation |
| What should I say? | button | meeting audio + mic |
| Follow-up / Recap | buttons | full conversation |
| Ask anything | type + Enter | screen + conversation |
| Solve coding problem | `Ctrl+H` / `⌘+H` | screen |
| Smart toggle | pill in panel | slower, stronger model |

Screen-share hiding is best-effort, not guaranteed. On macOS 15.4+ some capture tools may still see the window. On Windows 10 builds below 2004 the window may render as a black box instead of being excluded. Do not use this to cheat on proctored exams, interviews, or recorded meetings where that would break the rules.

## Platform support

| | macOS | Windows 11 / 10 2004+ | Linux |
|---|---|---|---|
| Prebuilt download | source only | yes (zip + installer) | yes (AppImage) |
| Screen + coding help | yes | yes | yes |
| Mic ("You") | yes | yes | yes |
| Meeting audio ("Them") | yes (14.4+) | yes | yes |
| Hidden from screen shares | best-effort | yes (`WDA_EXCLUDEFROMCAPTURE`) | varies |
| Permissions | mic + screen recording | microphone | mic + screen (varies) |

## Install

### Quick start (Windows)

1. Open [GitHub Releases](https://github.com/z12ob/GhostPilot/releases) and download **`GhostPilot-win-x64.zip`** (recommended) or **`GhostPilot-win-x64.exe`** (installer).
2. **Zip:** unzip the folder, then double-click **`GhostPilot.exe`**. **Installer:** run the `.exe`, follow the prompts, then launch GhostPilot from the Start menu.
3. If Windows SmartScreen appears, choose **More info** → **Run anyway**. The build is not code-signed yet.
4. Allow **Microphone** access when Windows asks.
5. In the panel, open **Settings** (`...` or `Ctrl+,`), choose a provider, and paste your API key.
6. Click **Listen**, then use **Assist** (`Ctrl+Enter`) during a call or coding session.

### Quick start (Linux)

1. Download the AppImage for your CPU (`GhostPilot-1.0.0-linux-x64.AppImage` or `…-arm64.AppImage`).
2. In a terminal: `chmod +x GhostPilot-1.0.0-linux-x64.AppImage` then run it.
3. Open **Settings**, add your API key, then click **Listen**.

### macOS

Signed macOS downloads are not on Releases yet. On a Mac, use **From source** below (Node.js 22.12+ required).

### Release files

| Platform | File | Notes |
|---|---|---|
| Windows 10/11 x64 | `GhostPilot-win-x64.zip` | Portable. Unzip and run `GhostPilot.exe`. |
| Windows 10/11 x64 | `GhostPilot-win-x64.exe` | Installer. SmartScreen may warn on first run. |
| Linux x64 | `GhostPilot-1.0.0-linux-x64.AppImage` | `chmod +x` then run |
| Linux arm64 | `GhostPilot-1.0.0-linux-arm64.AppImage` | AppImage |
| macOS | not on Releases yet | Use **From source** below |

GitHub also attaches **Source code (zip)** and **Source code (tar.gz)** on every release. Those are code snapshots for developers, not installers.

### Troubleshooting

| Problem | What to try |
|---|---|
| Downloaded a small `.zip` (~1 MB) | That is **Source code**, not the app. Download `GhostPilot-win-x64.zip` (~100 MB+) instead. |
| SmartScreen blocks the installer | **More info** → **Run anyway**, or use the portable `.zip`. |
| No audio from the meeting | On Windows, pick the screen/window share that includes system audio. On macOS 14.4+, grant Screen Recording. |
| Local transcription fails | Installed builds include whisper.cpp. From source, run `npm run prepare:whisper` first. |

### From source

Requires Node.js 22.12+.

```bash
git clone https://github.com/z12ob/GhostPilot.git
cd GhostPilot
npm install
npm start
```

Build installers:

```bash
npm run pack:win
npm run dist:mac
npm run dist:win
npm run dist:linux
```

For local whisper.cpp transcription from source:

```bash
npm run prepare:whisper
```

## Configuration

Open Settings (`...` in the panel, or `Ctrl+,` / `⌘+,`).

| Provider | Notes |
|---|---|
| OpenAI | chat + Whisper |
| Anthropic | screen/coding; add OpenAI or Gemini for STT |
| Gemini | chat + transcription |
| Azure AI Foundry | endpoint + deployment names |
| Custom | OpenAI-compatible base URL |

Local STT: Settings → Audio → Local. Whisper models download on demand into GhostPilot's user-data folder. Installed builds include the whisper.cpp runtime. If you run from source, run `npm run prepare:whisper` before using local transcription.

Profile context (résumé, job description, interview notes) is stored in `ghostpilot-data.json`.

For Zoom: Settings → Share Screen → Advanced → Screen capture mode → **Advanced capture with window filtering**.

## Architecture

Electron app. Main process handles capture, STT, and LLM streaming. Renderer runs the overlay UI and browser audio APIs.

Production safeguards:

- Screen-share exclusion via `setContentProtection` (re-applied on focus/show)
- Always-on-top `screen-saver` level for full-screen IDE visibility
- Bounded PCM buffers (2 minutes per channel) for long meetings
- `AbortController` cancels in-flight LLM streams when a new action arrives
- Renderer token batching via `requestAnimationFrame` to keep the UI responsive
- Mic and system-audio streams start/stop independently; one failure does not block the other

```
main ──┬─ overlay window (frameless, transparent, content-protected)
       ├─ desktopCapturer screenshots
       ├─ speech-to-text (whisper.cpp, OpenAI, Gemini, Deepgram)
       └─ LLM providers
renderer ─ glass UI, mic capture, system-audio loopback
```

Set `GHOSTPILOT_NO_PROTECT=1` to disable screen-share exclusion while debugging.

## Development

```bash
npm test
npm run verify:whisper-runtime
```

Layout: `main.js`, `preload.js`, `renderer/`, `src/`. Project history is in `CHANGELOG.md`.

## Privacy

No accounts, telemetry, or hosted service. API keys and settings stay in `ghostpilot-data.json` on your machine. Audio stays in memory during a session. Screenshots go to your chosen provider only when a feature needs them.

## License

MIT. Copyright (c) 2026 Guram Melikidze.

Local transcription uses [whisper.cpp](https://github.com/ggml-org/whisper.cpp) (MIT). See `build-resources/whisper.cpp.LICENSE`.
