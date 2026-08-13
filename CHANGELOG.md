# GhostPilot Engineering Log

A record of how GhostPilot was designed, built, and hardened.

GhostPilot is a local-first Electron overlay that reads screen, microphone, and meeting audio as separate inputs, then streams answers from a provider you choose. This log tracks the decisions behind that architecture.

---

## 14-Aug-2026

**Permissions, identity, and exit behavior**

- Replaced the old Windows process and executable identity with GhostPilot across the app, packaged metadata, window titles, and development runtime.
- The Windows permission guide now checks the microphone setting and explains the global desktop-app access switch. It no longer asks users to find a separate GhostPilot screen-recording toggle that Windows does not provide.
- Added visible close, quit, and skip controls to onboarding and permission windows. Escape now closes these frameless dialogs without requiring Task Manager.

**Interface refresh**

- Reworked the overlay, onboarding, permissions, and settings surfaces with a consistent GhostPilot visual system.
- Added a GhostPilot application icon for packaged Windows, Linux, and macOS builds.
- Improved narrow-window layouts, keyboard focus, dialog semantics, control labels, and reduced-motion behavior.
- Consolidated settings open and close handling so validation and focus restoration follow one path.

**Verification**

- Expanded the test suite from 128 to 135 tests with coverage for Windows permission status, application identity, dialog exit paths, and packaged icon configuration.
- Verified the Windows package at desktop and narrow widths without console errors, horizontal overflow, unnamed controls, or legacy Microsoft Edge Update identity.

**Release packaging and docs**

- Listed exact Windows and Linux installer filenames in the README, with a note about SmartScreen on unsigned Windows builds.
- Added a portable Windows zip alongside the NSIS installer.
- Wrote step-by-step Quick start and Troubleshooting sections for non-technical installs.
- Bundled the whisper.cpp runtime in release builds so local STT works in installed apps without extra setup.
- Added GitHub repository metadata to `package.json`.
- Aligned CI to Node 22, matching the engine requirement in `package.json`.

---

## 13-Aug-2026

**Production hardening and test suite**

Final pass before calling v1.0.0 releasable.

**Architecture regression tests**

- Added `test/architecture.test.js` to guard `setContentProtection`, `screen-saver` always-on-top level, transparent background, abort signals in `src/llm.js`, and PCM buffer wiring in main.
- Added `test/pcm-buffer.test.js` for cap enforcement and oversized single-chunk trimming.

**Documentation**

- Expanded `README.md` architecture section: protection re-application, buffer caps, abort behavior, independent audio streams, and `GHOSTPILOT_NO_PROTECT` for debugging.

**Release posture**

- `npm test`: 128 passing. Syntax checks clean on `main.js`, `src/llm.js`, and `renderer/renderer.js`.
- MIT license, author Guram Melikidze.
- No accounts, no telemetry. API keys stay on disk in `ghostpilot-data.json`.
- Screen-share hiding remains best-effort with honest platform caveats in the README.

---

## 09-Aug-2026

**UI thread and event loop optimization**

Token streaming from fast models can flood IPC. Thousands of `llm:token` events per second will freeze a DOM if each token triggers a synchronous repaint.

**Renderer token batching**

- Added `queueToken` / `flushTokenQueue` in `renderer/renderer.js`, flushing on `requestAnimationFrame`.
- `llm:done` and `llm:error` force a final flush so the last characters are never stranded in the queue.

**Stall watchdog**

- `STREAM_INACTIVITY_MS = 25000` in main rearms on every token. If the provider stops sending, the stream rejects with a clear timeout message instead of hanging forever.

**Busy state**

- Removed the hard block that prevented a new mode from starting while `busy` was true. Users expect the latest hotkey to win.

**Test coverage**

- Build-config tests for `electron-builder.cjs` integrity and macOS entitlements.
- Provider matrix tests for Custom endpoints, Azure deployments, Gemini model self-healing, and STT quota cooldown.
- Whisper model manager tests for resumable downloads, checksum recovery, and cancel-in-flight behavior.

---

## 06-Aug-2026

**Window protection lifecycle and capture fixes**

Spent a few days on bugs that only show up during real calls, not in unit tests.

**Display protection**

- Extracted `applyWindowProtection()` and hooked it to `show` and `focus`, not just initial window create. Some OS builds drop content-protection flags when the window is minimized or loses focus.
- Set `backgroundColor: '#00000000'` on the overlay to reduce transparent-window flicker on Windows.

**Capture lifecycle**

- `capture:state` now starts mic and system audio together when listening turns on.
- Removed duplicate `startMic()` calls that could attach two tracks to the same pipeline.
- `startSystemAudio()` resets its `sysStarting` guard on early return so a failed loopback does not block later retries.

**Screen capture errors**

- If `captureScreenshot()` returns nothing, the feature stops with `llm:error` and a platform-specific permission hint instead of continuing without an image.

**Whisper runtime scripts**

- `npm run prepare:whisper` downloads platform runtimes for local dev.
- `npm run verify:whisper-runtime` asserts binaries and catalog integrity before release builds.

---

## 04-Aug-2026

**State machine and memory stabilization**

Ran a two-hour test call. Memory climbed steadily and hotkey spam left ghost LLM streams running in the background. Two separate problems.

**Bounded PCM buffers**

- Added `src/pcm-buffer.js` with `pushPcmChunk` and `clearPcmBuffer`.
- Cap: two minutes of 16 kHz mono PCM per channel (~3.84 MB). Oldest chunks drop first.
- On capture stop, buffers, VAD state, and ring buffers reset together.

**Stream interruption**

- Introduced `activeLlmAbort` in main. A new Assist, Say, or Ask call aborts the previous `AbortController` immediately.
- Threaded `signal` through every provider stream loop in `src/llm.js`.
- Abort on `will-quit` so shutdown does not leave hanging HTTP connections.

**Capture transition lock**

- Wrapped start/stop in a `captureTransition` promise chain to prevent double-start races when the listen toggle bounces.

---

## 31-Jul-2026

**Local Whisper path and packaging**

**whisper.cpp sidecar**

- `src/whisper-runtime.js` locates packaged or dev binaries per OS and architecture.
- `src/whisper-model-catalog.js` defines the official model list with checksum metadata.
- `src/whisper-model-manager.js` handles resumable downloads, atomic installs, and corruption recovery.
- `src/whisper-server-session.js` keeps one server process warm across inferences with a hard inference timeout.
- `src/local-whisper-transcriber.js` bridges PCM segments into that server without blocking the UI thread.

Chose a native sidecar over in-process WASM. Latency and memory are more predictable, and model files download on demand so the installer stays small.

**Packaging**

- `electron-builder.cjs`: bundle ID `com.ghostpilot.app`, macOS zip (x64 + arm64), Windows NSIS x64, Linux AppImage.
- Microphone and audio-capture usage strings in macOS `extendInfo`.
- `asar: false` during beta for easier binary inspection.

**Smart tier toggle**

- Fast model for Assist during live conversation; stronger model when the user explicitly asks for depth. Tier selection flows through `createLLM` so the renderer never hardcodes model IDs.

---

## 28-Jul-2026

**Universal LLM provider pipeline**

Built `src/llm.js` as a single streaming entry point over multiple backends:

- OpenAI and OpenAI-compatible endpoints (including Custom base URL)
- Azure AI Foundry (deployment name + endpoint)
- Anthropic Messages API
- Google Gemini
- Local Ollama

**Streaming contract**

- Every provider implements the same `stream({ system, turns, imageDataUrl, onToken, signal })` shape.
- Vision turns attach screenshots as inline image parts where the API supports it.
- Centralized `formatProviderErrorMessage` so quota, model-not-found, and retry-delay errors read consistently in the UI.

**Prompt modes and context**

- `src/prompts.js` defines MODES for Assist, Say, Ask, Follow-up, Recap, LeetCode-style coding help, and answer-this-question.
- `src/profile-context.js`, `src/resume-context.js`, and `src/interview-context.js` inject résumé, job description, and category-specific interview notes as reference data with bounded character limits.
- LeetCode mode intentionally ignores career context. Coding prompts need a clean problem statement.

**Meeting notes**

- `src/meetings.js` stores session records. `src/notes.js` parses structured LLM output into summary, decisions, risks, and follow-ups.
- `src/resume.js` parses PDF and DOCX uploads for profile setup.

---

## 25-Jul-2026

**Speech-to-text stack**

Wired the audio pipelines from the 21st into something that produces a usable transcript.

**Batch path (`src/stt.js`)**

- Buffers PCM until RMS and duration gates pass, then ships WAV blobs to the configured cloud STT provider.
- Hallucination filtering for known Whisper silence artifacts. Garbage text in the transcript poisons every downstream LLM call.

**Streaming path (`src/stt-streaming.js`)**

- Deepgram websocket mode for lower latency during active calls.
- Segments accumulate on `is_final` and flush on `speech_final` or `UtteranceEnd`.

**VAD and pre-roll (`src/vad.js`)**

- `AdaptiveVAD` tuned separately for near-field mic vs speaker audio.
- `AudioRingBuffer` for a short pre-roll so word onsets are not clipped at utterance boundaries.

**Transcript model**

- Rolling in-memory transcript capped at 200 turns, channel-tagged (`you` / `them`). Main process is the source of truth.

---

## 21-Jul-2026

**Multi-stream context engine**

Most overlays treat audio as one blob. GhostPilot treats three inputs as three pipelines:

1. **Screen**: `desktopCapturer` screenshots on demand (Assist, Ask, coding modes).
2. **Microphone**: `getUserMedia` in the renderer, PCM forwarded over IPC as `mic:pcm`.
3. **System / meeting audio**: display-media loopback in the renderer, forwarded as `system:pcm`.

**IPC design**

- Audio chunks are `ArrayBuffer` payloads, not decoded text. Decoding and VAD stay in main where the STT routers live.
- Split channels into `you` and `them` buffers from the start. Mixing early would make speaker attribution impossible.

**macOS loopback flags**

- Enabled `MacLoopbackAudioForScreenShare` and `MacSckSystemAudioLoopbackOverride` at launch on darwin. Without these, "Them" is often silent in Electron.

**Resilience rule**

- Mic and system audio start independently. If loopback fails, mic transcription continues.

---

## 18-Jul-2026

**Renderer, shortcuts, and permissions**

First working panel after the shell from the 15th.

**Glass UI**

- Dark glass panel, listen toggle, transcript column split into "You" and "Them."
- Click-through dragging via `setIgnoreMouseEvents(ignore, { forward: true })`. Without `forward: true`, dragging felt sticky on Windows.
- Window position saved with a 500 ms debounce on `moved` events.

**Preload bridge**

- Everything the renderer needs goes through `window.ghostPilot`: capture toggles, settings, LLM triggers, log forwarding.
- `src/store.js` persists settings to `ghostpilot-data.json`. No cloud account, no telemetry.

**Screenshot capture**

- `src/screen.js` in main owns `desktopCapturer`. Renderer should not enumerate displays.

**Shortcuts**

- `src/shortcuts.js`: Assist (`Ctrl+Enter` / `⌘+Enter`), coding help (`Ctrl+H` / `⌘+H`), hide, quit.
- Registered in main via `globalShortcut` so hotkeys work when another app has focus.

**Permissions gate**

- `renderer/permissions.html` with platform-specific copy before the overlay opens.
- IPC handlers: `permissions:check`, `permissions:request`, `permissions:continue`.

**Test harness**

- Adopted Node's built-in test runner (`node --test test/*.test.js`). Early tests locked in shortcut defaults and prompt shapes.

---

## 15-Jul-2026

**Initial core and window protection**

Started the repository. The goal is narrow: a floating desktop panel that stays out of screen shares while sitting above full-screen IDEs and presentation apps.

**Electron shell**

- Electron 33, Node 22.12 minimum.
- `main.js` for orchestration, `preload.js` for IPC, `renderer/` for the glass UI.
- `contextIsolation: true`, `nodeIntegration: false`. The renderer never touches API keys or the filesystem.

**First overlay window**

- Frameless, transparent `BrowserWindow`, `hasShadow: false`, `skipTaskbar: true`, `fullscreenable: false`.
- On Windows, `type: 'toolbar'` for correct stacking during live calls.

**Screen-share invisibility**

- `setContentProtection(true)` on macOS and Windows 10 build 19041+ (Electron maps to `WDA_EXCLUDEFROMCAPTURE`).
- `setAlwaysOnTop(true, 'screen-saver', 1)` so the panel stays above Zoom, Teams, and Xcode in full-screen mode.

**Trade-off noted**

Screen-share hiding is best-effort. Some capture tools on newer macOS builds may still see the window. Documented that honestly from day one.
