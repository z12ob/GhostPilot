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

| | macOS | Windows 11 / 10 2004+ |
|---|---|---|
| Screen + coding help | yes | yes |
| Mic ("You") | yes | yes |
| Meeting audio ("Them") | yes (14.4+) | yes |
| Hidden from screen shares | best-effort | yes (`WDA_EXCLUDEFROMCAPTURE`) |
| Permissions | mic + screen recording | microphone |

## Install

### Releases

Download the latest build from [GitHub Releases](https://github.com/z12ob/GhostPilot/releases).

| Platform | File | Notes |
|---|---|---|
| Windows 10/11 x64 | `GhostPilot-win-x64.exe` | NSIS installer. Windows SmartScreen may warn on first run because the build is not code-signed. |
| Linux x64 | `GhostPilot-0.2.2-linux-x64.AppImage` | `chmod +x` then run |
| Linux arm64 | `GhostPilot-0.2.2-linux-arm64.AppImage` | AppImage |
| macOS | build from source | Signed macOS installers are not available yet. Use the steps below on a Mac. |

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
