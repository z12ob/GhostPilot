const { app, BrowserWindow, ipcMain, globalShortcut, screen, session, desktopCapturer, shell, dialog, systemPreferences } = require('electron');
const path = require('path');
const os = require('os');
const store = require('./src/store');
const { captureScreenshot } = require('./src/screen');
const { createSTT } = require('./src/stt');
const { parseDocumentFile } = require('./src/resume');
const { createLLM } = require('./src/llm');
const { MODES } = require('./src/prompts');
const { rms16 } = require('./src/wav');
const { createStreamingSTT } = require('./src/stt-streaming');
const { AdaptiveVAD, AudioRingBuffer } = require('./src/vad');
const { detectCategory } = require('./src/interview-context');
const { normalizeWorkMode, buildSessionContext } = require('./src/session-mode');
const { pushPcmChunk, clearPcmBuffer } = require('./src/pcm-buffer');
const { resolvePermissionStatus } = require('./src/permissions');
const { buildDisplayMediaStreams } = require('./src/display-media');
const { buildCombinedNotesPrompt, buildNotesPrompt, buildPartialNotesPrompt, chunkTranscript } = require('./src/notes');
const { TranscriptBuffer } = require('./src/transcript-buffer');
const { MeetingSessionStore } = require('./src/meeting-session-store');
const { waitForIdle } = require('./src/capture-drain');
const {
  clampWindowPosition,
  isPointInRegions,
  moveWindowBounds,
  resizeWindowBounds
} = require('./src/window-interaction');
const { createUpdateManager } = require('./src/updater');
const { autoUpdater } = require('electron-updater');

if (process.platform === 'darwin') {
  app.commandLine.appendSwitch('enable-features', 'MacLoopbackAudioForScreenShare,MacSckSystemAudioLoopbackOverride');
}
const { WhisperModelManager } = require('./src/whisper-model-manager');
const { requireWhisperModel } = require('./src/whisper-model-catalog');
const { locateWhisperRuntime } = require('./src/whisper-runtime');
const { LocalWhisperTranscriber } = require('./src/local-whisper-transcriber');

let win = null;
let moveState = null;
let resizeState = null;
let interactiveRegions = [];
let mousePollingTimer = null;
let ignoringMouse = false;
let updateManager = null;

function keepWindowInteractive() {
  if (!win || win.isDestroyed() || !ignoringMouse) return;
  ignoringMouse = false;
  win.setIgnoreMouseEvents(false);
}

function updateWindowInteraction(cursor = screen.getCursorScreenPoint()) {
  if (!win || win.isDestroyed() || !Number.isFinite(cursor?.x) || !Number.isFinite(cursor?.y)) return;
  const display = screen.getDisplayNearestPoint(cursor);
  if (moveState) {
    win.setBounds(moveWindowBounds(moveState.bounds, moveState.point, cursor, display.workArea), false);
  } else if (resizeState) {
    win.setBounds(resizeWindowBounds(
      resizeState.bounds,
      resizeState.point,
      cursor,
      resizeState.edge,
      display.workArea
    ), false);
  }
}

const shortcutState = { assist: false, say: false, leetcode: false, hide: false, quit: false };
const isMac = process.platform === 'darwin';
const isWindows = process.platform === 'win32';

function getWindowsBuild() {
  if (!isWindows) return 0;
  const parts = os.release().split('.').map(Number);
  return parts[2] || 0;
}
const WIN_BUILD = getWindowsBuild();
const WIN_SUPPORTS_CONTENT_PROTECTION = !isWindows || WIN_BUILD >= 19041;

let permWin = null;

const state = { capturing: false, busy: false, transcribing: { you: false, them: false } };
let sttDisabled = false;
const buffers = { you: [], them: [] };
const transcript = new TranscriptBuffer();
const FLUSH_MS = 900;
const STREAM_INACTIVITY_MS = 25000;
const MIN_BYTES = Math.floor(16000 * 2 * 0.12);
const RMS_GATE = 180;
let flushTimer = null;
let whisperModelManager = null;
let localWhisperTranscriber = null;
let meetingSessionStore = null;
let activeWhisperModelId = null;
let desiredCaptureState = false;
let captureTransition = Promise.resolve(false);

let streamingSTT = { you: null, them: null };
let streamingMode = false;
const vad = {
  you: new AdaptiveVAD({
    onsetThreshold: 220,
    offsetThreshold: 130,
    silenceFrames: 18,
    onSpeechStart: () => send('vad:state', { channel: 'you', speaking: true }),
    onSpeechEnd: (dur) => send('vad:state', { channel: 'you', speaking: false, durationMs: dur })
  }),
  them: new AdaptiveVAD({
    onsetThreshold: 200,
    offsetThreshold: 120,
    silenceFrames: 20,
    onSpeechStart: () => send('vad:state', { channel: 'them', speaking: true }),
    onSpeechEnd: (dur) => send('vad:state', { channel: 'them', speaking: false, durationMs: dur })
  })
};

const ringBuffers = {
  you: new AudioRingBuffer(300, 16000),
  them: new AudioRingBuffer(300, 16000)
};

function pushTranscript(turn) {
  transcript.push(turn);
  meetingSessionStore?.appendTurn(turn);
}

function send(channel, data) { if (win && !win.isDestroyed()) win.webContents.send(channel, data); }

function sessionSnapshot(maxTurns = 400) {
  if (!meetingSessionStore) return { session: null, turns: [], turnCount: 0, hasNotes: false };
  const snapshot = meetingSessionStore.getSnapshot({ maxTurns });
  return {
    session: snapshot.session,
    turns: snapshot.turns,
    turnCount: snapshot.turnCount,
    hasNotes: snapshot.hasNotes
  };
}

function publishSessionState() {
  send('session:state', sessionSnapshot());
}

function beginMeetingSession() {
  const settings = store.getSettings();
  const kind = normalizeWorkMode(settings.workMode);
  const title = kind === 'meeting' ? String(settings.meetingTitle || '').trim() : '';
  const started = meetingSessionStore?.startSession(Date.now(), { kind, title });
  transcript.clear();
  publishSessionState();
  return started;
}

function getWhisperRuntime() {
  return locateWhisperRuntime({
    isPackaged: app.isPackaged,
    resourcesPath: process.resourcesPath,
    appPath: app.getAppPath(),
    platform: process.platform,
    architecture: process.arch,
    environment: process.env
  });
}

function publishTranscript(channel, text) {
  if (!text || !text.trim()) return;
  const turn = { channel, text: text.trim(), ts: Date.now() };
  pushTranscript(turn);
  send('transcript', turn);
  send('stt:final', { channel, text: turn.text });
}

async function startLocalWhisper(settings) {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  const localSettings = settings.localWhisper || {};
  const model = requireWhisperModel(localSettings.modelId || 'base.en');
  const runtime = getWhisperRuntime();
  if (!runtime.available) throw new Error(runtime.message);
  activeWhisperModelId = model.id;
  let transcriber = null;
  try {
    const modelPath = await whisperModelManager.verifyInstalledModel(model.id).catch((error) => {
      if (error.code === 'ENOENT') {
        throw new Error(`Download the ${model.id} model in Settings → Audio before listening.`);
      }
      throw error;
    });

    transcriber = new LocalWhisperTranscriber({
      sessionOptions: {
        executablePath: runtime.executablePath,
        runtimeDirectory: runtime.runtimeDirectory,
        modelPath,
        language: model.englishOnly ? 'en' : (localSettings.language || 'auto'),
        threads: Number(localSettings.threads) || 0,
        tinydiarize: model.tinydiarize
      },
      onTranscript: publishTranscript,
      onSpeechState: (channel, speaking, durationMs) => {
        send('vad:state', { channel, speaking, durationMs });
      },
      onStatus: (status) => send('stt:status', { provider: 'local', ...status }),
      onError: (error) => {
        sttDisabled = true;
        console.log('[local-whisper] error', error && error.message);
        send('stt:status', { provider: 'local', status: 'error' });
        send('status', { message: `Local transcription error: ${error.message}. Audio was not sent to a cloud fallback.` });
      }
    });

    localWhisperTranscriber = transcriber;
    await transcriber.start();
  } catch (error) {
    if (localWhisperTranscriber === transcriber) localWhisperTranscriber = null;
    activeWhisperModelId = null;
    if (transcriber) await transcriber.forceStop().catch(() => {});
    throw error;
  }
}

async function getWhisperOverview() {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  const runtime = getWhisperRuntime();
  const models = await whisperModelManager.listModels();
  return {
    runtime: {
      available: runtime.available,
      version: runtime.version,
      target: runtime.target,
      message: runtime.message || null
    },
    models
  };
}

let activeLlmAbort = null;

function applyWindowProtection(targetWin) {
  if (!targetWin || targetWin.isDestroyed()) return;
  const shouldProtect = !process.env.GHOSTPILOT_NO_PROTECT;
  if (!shouldProtect) return;
  if (WIN_SUPPORTS_CONTENT_PROTECTION) {
    targetWin.setContentProtection(true);
  }
  targetWin.setAlwaysOnTop(true, 'screen-saver', 1);
}

function createWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const savedSettings = store.getSettings();
  const W = Math.max(1, savedSettings.windowWidth || 560);
  const H = Math.max(1, savedSettings.windowHeight || 500);
  let startX = Math.round(workArea.x + (workArea.width - W) / 2);
  let startY = workArea.y + 6;

  if (savedSettings.windowX !== null && savedSettings.windowY !== null) {
    const restored = clampWindowPosition({
      x: savedSettings.windowX,
      y: savedSettings.windowY,
      width: W,
      height: H
    }, workArea);
    startX = restored.x;
    startY = restored.y;
  }

  const winOptions = {
    width: W,
    height: H,
    x: startX,
    y: startY,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    hasShadow: false,
    resizable: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  };

  if (isWindows) {
    winOptions.type = 'toolbar';
  }

  win = new BrowserWindow(winOptions);
  interactiveRegions = [];
  ignoringMouse = false;

  clearInterval(mousePollingTimer);
  mousePollingTimer = setInterval(() => {
    if (!win || win.isDestroyed() || !win.isVisible()) return;
    if (moveState || resizeState) {
      keepWindowInteractive();
      updateWindowInteraction();
      return;
    }
    if (interactiveRegions.length === 0) {
      if (ignoringMouse) {
        ignoringMouse = false;
        win.setIgnoreMouseEvents(false);
      }
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    const localPoint = { x: cursor.x - bounds.x, y: cursor.y - bounds.y };
    const shouldIgnore = !isPointInRegions(localPoint, interactiveRegions);
    if (shouldIgnore === ignoringMouse) return;
    ignoringMouse = shouldIgnore;
    win.setIgnoreMouseEvents(shouldIgnore, { forward: true });
  }, 16);

  applyWindowProtection(win);
  win.on('show', () => applyWindowProtection(win));
  win.on('focus', () => applyWindowProtection(win));

  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  if (isMac && typeof win.setHiddenInMissionControl === 'function') win.setHiddenInMissionControl(true);

  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  let moveSaveTimer = null;
  win.on('moved', () => {
    clearTimeout(moveSaveTimer);
    moveSaveTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) {
        const bounds = win.getBounds();
        const display = screen.getDisplayMatching(bounds);
        const reachable = clampWindowPosition(bounds, display.workArea);
        if (reachable.x !== bounds.x || reachable.y !== bounds.y || reachable.width !== bounds.width || reachable.height !== bounds.height) {
          win.setBounds(reachable, false);
        }
        store.setSettings({ windowX: reachable.x, windowY: reachable.y });
      }
    }, 500);
  });

  let resizeSaveTimer = null;
  win.on('resized', () => {
    clearTimeout(resizeSaveTimer);
    resizeSaveTimer = setTimeout(() => {
      if (win && !win.isDestroyed()) {
        const [windowWidth, windowHeight] = win.getSize();
        store.setSettings({ windowWidth, windowHeight });
      }
    }, 500);
  });

  win.setTitle('GhostPilot');

  win.webContents.on('did-finish-load', () => {
    win.showInactive();
    win.setTitle('GhostPilot');
    publishSessionState();
    if (updateManager) send('update:state', updateManager.getState());

    if (isWindows && !process.env.GHOSTPILOT_NO_PROTECT && !WIN_SUPPORTS_CONTENT_PROTECTION) {
      send('status', {
        message: `Heads up: your Windows version (build ${WIN_BUILD}) does not support screen-share hiding. Upgrade to Windows 10 build 19041+ or Windows 11 to enable invisibility in screen shares.`
      });
    }
  });
  win.webContents.on('render-process-gone', (_e, d) => {
    console.log('[GhostPilot] renderer gone', JSON.stringify(d));
  });
}

async function flushChannel(channel) {
  if (state.transcribing[channel]) return;
  const chunks = buffers[channel];
  if (!chunks.length) return;
  const pcm = Buffer.concat(chunks);
  buffers[channel] = [];
  if (pcm.length < MIN_BYTES) return;
  if (rms16(pcm) < RMS_GATE) return;

  state.transcribing[channel] = true;
  try {
    const settings = store.getSettings();
    const stt = createSTT(settings);
    if (!stt.available) {
      if (!sttDisabled) { sttDisabled = true; send('status', { message: 'No transcription key set. Add an OpenAI (Whisper), Deepgram, or Gemini key in Settings to enable listening. Screen/LeetCode features work without it.' }); }
      return;
    }
    const res = await stt.transcribe(pcm);
    if (res.error) {
      handleSttError(res.error, settings);
      return;
    }
    if (res.text && res.text.trim() && res.text.trim().length > 1 && !/^[?!.,;:\-…]+$/.test(res.text.trim())) {
      const turn = { channel, text: res.text.trim(), ts: Date.now() };
      pushTranscript(turn);
      send('transcript', turn);
    }
  } catch (e) {
    console.log('[stt] error', e && e.message);
  } finally {
    state.transcribing[channel] = false;
  }
}

function handleSttError(err, settings) {
  console.log('[stt] error', err.provider, err.status, err.code, err.message);

  if (sttDisabled) return;
  const isQuota = err.status === 429 || err.code === 'RESOURCE_EXHAUSTED' || (err.message && err.message.includes('Quota exceeded'));
  const noAccess = err.status === 403 || err.status === 401 || err.code === 'model_not_found' || isQuota;
  sttDisabled = true;
  if (noAccess) {
    send('status', { message: `Transcription off: your ${err.provider} key was rejected or hit a quota limit. Update your key in Settings to resume.` });
  } else {
    send('status', { message: 'Transcription error (' + err.provider + '): ' + err.message });
  }
}

function startFlushLoop() {
  if (flushTimer) return;
  flushTimer = setInterval(() => { flushChannel('you'); flushChannel('them'); }, FLUSH_MS);
}
function stopFlushLoop() { if (flushTimer) { clearInterval(flushTimer); flushTimer = null; } }

function initStreamingSTT() {
  const settings = store.getSettings();
  streamingMode = false;

  ['you', 'them'].forEach((channel) => {
    const sttInstance = createStreamingSTT(settings, channel, {
      onTranscript: (ch, text) => {
        const turn = { channel: ch, text, ts: Date.now() };
        pushTranscript(turn);
        send('transcript', turn);
        send('stt:final', { channel: ch, text });
      },
      onInterim: (ch, text) => {
        send('stt:interim', { channel: ch, text });
      },
      onError: (err) => {
        console.log('[streaming-stt] error', err.provider, err.message);
        if (err.recoverable) {
          send('status', { message: `Streaming transcription is reconnecting after a temporary ${err.provider} connection error.` });
          return;
        }
        const batchFallbackAvailable = sttInstance.provider !== 'gemini-live' && createSTT(settings).available;
        stopStreamingSTT();
        if (batchFallbackAvailable) {
          send('status', { message: `Streaming transcription (${err.provider}) error: ${err.message}. Falling back to batch mode.` });
          startFlushLoop();
        } else if (!sttDisabled) {
          sttDisabled = true;
          send('status', { message: `Transcription stopped (${err.provider}): ${err.message}. The selected provider has no batch fallback.` });
        }
        streamingMode = false;
      },
      onStatusChange: (ch, status) => {
        send('stt:status', { channel: ch, status });
        if (status === 'connected') {
          console.log(`[streaming-stt] ${ch} channel connected`);
        }
      }
    });

    if (sttInstance.type === 'streaming' && sttInstance.instance) {
      streamingMode = true;
      streamingSTT[channel] = sttInstance.instance;
      sttInstance.instance.connect();
    }
  });

  return streamingMode;
}

function stopStreamingSTT() {
  ['you', 'them'].forEach((channel) => {
    if (streamingSTT[channel]) {
      streamingSTT[channel].disconnect();
      streamingSTT[channel] = null;
    }
  });
  streamingMode = false;
}

function routeAudio(channel, pcmBuffer) {
  const buf = Buffer.from(pcmBuffer);

  if (localWhisperTranscriber) {
    localWhisperTranscriber.push(channel, buf);
    return;
  }

  vad[channel].processChunk(buf);

  ringBuffers[channel].write(buf);

  if (streamingMode && streamingSTT[channel]) {
    streamingSTT[channel].sendAudio(pcmBuffer);
  } else {
    pushPcmChunk(buffers[channel], buf);
  }
}

async function setCapturing(active) {
  if (active === state.capturing) return state.capturing;

  if (active) {
    sttDisabled = false;
    const settings = store.getSettings();
    if ((settings.sttProvider || 'auto') === 'local') {
      try {
        await startLocalWhisper(settings);
        beginMeetingSession();
        state.capturing = true;
        console.log('[GhostPilot] capture started, mode: local');
        send('capture:state', { active: true, streaming: false, mode: 'local' });
        return true;
      } catch (error) {
        state.capturing = false;
        desiredCaptureState = false;
        if (error.code === 'STARTUP_CANCELLED') {
          send('stt:status', { provider: 'local', status: 'off' });
          send('capture:state', { active: false, streaming: false, mode: 'local' });
          return false;
        }
        send('stt:status', { provider: 'local', status: 'error' });
        send('status', { message: `Local transcription could not start: ${error.message} No audio was sent to a cloud provider.` });
        send('capture:state', { active: false, streaming: false, mode: 'local' });
        return false;
      }
    }

    beginMeetingSession();
    state.capturing = true;

    const streaming = initStreamingSTT();
    if (!streaming) {
      startFlushLoop();
    }
    console.log('[GhostPilot] capture started, mode:', streaming ? 'streaming' : 'batch');
    send('capture:state', { active: true, streaming: streamingMode, mode: streaming ? 'streaming' : 'batch' });
    return true;
  }

  state.capturing = false;
  stopFlushLoop();
  if (!streamingMode && !localWhisperTranscriber) {
    await Promise.all([
      waitForIdle(() => state.transcribing.you),
      waitForIdle(() => state.transcribing.them)
    ]);
    await Promise.all([flushChannel('you'), flushChannel('them')]);
  }
  stopStreamingSTT();
  clearPcmBuffer(buffers.you);
  clearPcmBuffer(buffers.them);
  vad.you.reset(); vad.them.reset();
  ringBuffers.you.clear(); ringBuffers.them.clear();
  const stoppingLocalTranscriber = localWhisperTranscriber;
  localWhisperTranscriber = null;
  send('capture:state', { active: false, streaming: false, mode: stoppingLocalTranscriber ? 'local' : 'off' });
  if (stoppingLocalTranscriber) {
    send('stt:status', { provider: 'local', status: 'stopping' });
    try {
      await stoppingLocalTranscriber.stop();
    } catch (error) {
      console.log('[local-whisper] stop error', error && error.message);
    } finally {
      activeWhisperModelId = null;
    }
  }
  meetingSessionStore?.stopSession();
  publishSessionState();
  return false;
}

async function streamWithInactivityTimeout({ llm, system, built, imageDataUrl, maxTokens, signal, onToken }) {
  const streamAbort = new AbortController();
  const relayAbort = () => streamAbort.abort();
  signal.addEventListener('abort', relayAbort, { once: true });

  let settled = false;
  let watchdog = null;
  let rearm = () => {};
  const stalled = new Promise((_resolve, reject) => {
    rearm = () => {
      clearTimeout(watchdog);
      watchdog = setTimeout(() => {
        streamAbort.abort();
        reject(new Error('The model stopped responding. Please try again.'));
      }, STREAM_INACTIVITY_MS);
    };
    rearm();
  });
  const streamOptions = {
    system,
    turns: [{ role: 'user', text: built }],
    imageDataUrl,
    signal: streamAbort.signal,
    onToken: (token) => {
      if (settled || signal.aborted) return;
      rearm();
      onToken(token);
    }
  };
  if (maxTokens) streamOptions.maxTokens = maxTokens;

  try {
    return await Promise.race([
      llm.stream(streamOptions),
      stalled
    ]);
  } finally {
    settled = true;
    clearTimeout(watchdog);
    signal.removeEventListener('abort', relayAbort);
  }
}

async function runFeature(mode, userText) {
  if (activeLlmAbort) {
    activeLlmAbort.abort();
    activeLlmAbort = null;
  }
  const abortController = new AbortController();
  activeLlmAbort = abortController;

  const def = MODES[mode];
  if (!def) {
    activeLlmAbort = null;
    return;
  }
  state.busy = true;
  try {
    const settings = store.getSettings();
    const workMode = normalizeWorkMode(settings.workMode);
    const llm = createLLM(settings);
    const transcriptTurns = transcript.snapshot();
    const configuredBubble = typeof def.userBubble === 'function' ? def.userBubble(workMode) : def.userBubble;
    const userBubble = configuredBubble !== null
      ? configuredBubble
      : (mode === 'ask' ? userText : mode === 'answerThis' ? `"${(userText || '').slice(0, 60)}${userText && userText.length > 60 ? '…' : ''}"` : null);
    const category = workMode === 'interview' && mode !== 'leetcode' ? detectCategory(transcriptTurns) : null;
    send('llm:start', { userBubble, small: !!def.small, category });

    if (def.requiresTranscript && transcriptTurns.length === 0) {
      send('llm:error', { message: 'No final transcript is available yet. Keep listening until speech appears, then try this action again.' });
      return;
    }

    if (!llm.ready) {
      const message = llm.configurationError || ('Complete the ' + settings.provider + ' provider settings. Model: ' + (llm.model || 'unset') + '.');
      send('llm:error', { message });
      return;
    }

    let imageDataUrl = null;
    if (def.needsScreen) {
      try {
        imageDataUrl = await captureScreenshot();
        if (!imageDataUrl) throw new Error('No screen source was available.');
      } catch (e) {
        if (def.screenOptional) {
          send('status', { message: 'Screen capture was unavailable. GhostPilot is using the transcript and saved context.' });
        } else {
          const message = process.platform === 'darwin'
            ? 'Screen capture needs permission. Grant Screen Recording to GhostPilot in System Settings.'
            : process.platform === 'win32'
              ? 'Screen capture failed. Make sure GhostPilot is not blocked by Windows privacy or security software, then try again.'
              : 'Screen capture failed. Check your desktop capture permissions, then try again.';
          send('status', { message });
          send('llm:error', { message });
          return;
        }
      }
    }

    const settingsForPrompt = store.getSettings();
    const contextBlock = buildSessionContext(settingsForPrompt, mode, transcriptTurns);
    const system = mode === 'recap'
      ? [
          contextBlock,
          'Turn the supplied meeting or interview transcript into accurate, useful notes. Follow the exact requested headings, connect related concepts, preserve stated owners and deadlines, and never invent details.'
        ].filter(Boolean).join('\n\n')
      : (def.buildSystem ? def.buildSystem(contextBlock, settingsForPrompt.aiRules || '', workMode) : (def.system || ''));
    let built = def.build({ transcript: transcriptTurns, userText: userText || '', workMode });

    if (mode === 'recap') {
      const chunks = chunkTranscript(transcriptTurns);
      if (chunks.length <= 1) {
        built = buildNotesPrompt(transcriptTurns);
      } else {
        const partialNotes = [];
        for (let index = 0; index < chunks.length; index++) {
          send('status', { message: `Preparing notes ${index + 1} of ${chunks.length}...` });
          let partial = '';
          await streamWithInactivityTimeout({
            llm,
            system: 'Extract accurate meeting notes from the supplied transcript section. Use only stated facts.',
            built: buildPartialNotesPrompt(chunks[index], index + 1, chunks.length),
            imageDataUrl: null,
            maxTokens: 700,
            signal: abortController.signal,
            onToken: (token) => { partial += token; }
          });
          partialNotes.push(partial);
          meetingSessionStore?.saveNotesProgress(partialNotes, chunks.length);
        }
        built = buildCombinedNotesPrompt(partialNotes);
        send('status', { message: 'Organizing final notes...' });
      }
    }

    let generatedNotes = '';
    const result = await streamWithInactivityTimeout({
      llm,
      system,
      built,
      imageDataUrl,
      maxTokens: mode === 'recap' ? 2200 : undefined,
      signal: abortController.signal,
      onToken: (text) => {
        if (mode === 'recap') generatedNotes += text;
        send('llm:token', { text });
      }
    });
    if (!abortController.signal.aborted) {
      if (mode === 'recap') {
        const notes = generatedNotes || (typeof result === 'string' ? result : '');
        if (notes.trim()) {
          meetingSessionStore?.saveNotes(notes, { provider: settings.provider, model: llm.model });
          publishSessionState();
        }
      }
      send('llm:done', {});
    }
  } catch (e) {
    if (abortController.signal.aborted || (e && e.name === 'AbortError')) return;
    send('llm:error', { message: e && e.message ? e.message : String(e) });
  } finally {
    if (activeLlmAbort === abortController) activeLlmAbort = null;
    state.busy = false;
  }
}

ipcMain.handle('settings:get', () => store.getSettings());
ipcMain.handle('settings:set', (_e, patch) => { sttDisabled = false; return store.setSettings(patch); });
ipcMain.handle('capture:toggle', () => {
  const targetState = !desiredCaptureState;
  desiredCaptureState = targetState;
  if (!targetState && !state.capturing && localWhisperTranscriber) {
    localWhisperTranscriber.forceStop().catch(() => {});
  }
  captureTransition = captureTransition
    .catch(() => state.capturing)
    .then(() => setCapturing(targetState));
  return captureTransition;
});
ipcMain.handle('capture:state', () => ({ active: state.capturing }));
ipcMain.handle('whisper:models', () => getWhisperOverview());
ipcMain.handle('whisper:model-download', async (_event, modelId) => {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  const result = await whisperModelManager.download(modelId, (progress) => send('whisper:download-progress', progress));
  send('whisper:models-changed', { modelId });
  return result;
});
ipcMain.handle('whisper:model-cancel', (_event, modelId) => {
  if (!whisperModelManager) return false;
  return whisperModelManager.cancelDownload(modelId);
});
ipcMain.handle('whisper:model-delete', async (_event, modelId) => {
  requireWhisperModel(modelId);
  if (activeWhisperModelId === modelId) {
    throw new Error('Stop listening before deleting the active model.');
  }
  const result = await whisperModelManager.deleteModel(modelId);
  send('whisper:models-changed', { modelId });
  return result;
});
ipcMain.handle('whisper:model-import', async (_event, modelId) => {
  if (!whisperModelManager) throw new Error('The local Whisper model manager is not ready.');
  requireWhisperModel(modelId);
  if (activeWhisperModelId === modelId) {
    throw new Error('Stop listening before replacing the active model.');
  }
  const selection = await dialog.showOpenDialog(win, {
    title: `Import ggml-${modelId}.bin`,
    properties: ['openFile'],
    filters: [{ name: 'whisper.cpp model', extensions: ['bin'] }]
  });
  if (selection.canceled || !selection.filePaths[0]) return { cancelled: true };
  const result = await whisperModelManager.importModel(modelId, selection.filePaths[0]);
  send('whisper:models-changed', { modelId });
  return result;
});
ipcMain.handle('platform:info', () => ({
  platform: process.platform,
  winBuild: WIN_BUILD,
  winSupportsContentProtection: WIN_SUPPORTS_CONTENT_PROTECTION
}));
ipcMain.handle('transcript:clear', () => ({ ok: true, saved: true }));
ipcMain.handle('session:get', () => sessionSnapshot());
ipcMain.handle('session:transcript-text', () => meetingSessionStore?.getSnapshot().transcriptText || '');
ipcMain.handle('session:open-folder', async () => {
  const directory = meetingSessionStore?.getSnapshot().session?.directory;
  if (!directory) return { ok: false, message: 'No saved meeting is available yet.' };
  const message = await shell.openPath(directory);
  return message ? { ok: false, message } : { ok: true };
});
ipcMain.handle('update:get-state', () => updateManager?.getState() || {
  supported: false,
  currentVersion: app.getVersion(),
  status: 'unavailable',
  availableVersion: null,
  progress: 0,
  message: 'Update checks are not ready yet.'
});
ipcMain.handle('update:check', () => updateManager?.check());
ipcMain.handle('update:install', () => {
  if (state.capturing) {
    return { ok: false, message: 'Stop and save the active meeting before restarting to update.' };
  }
  return updateManager?.install() || { ok: false, message: 'No downloaded update is ready to install.' };
});
ipcMain.on('window:move-start', (_event, point) => {
  if (!win || win.isDestroyed() || !Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY)) return;
  const bounds = win.getBounds();
  resizeState = null;
  moveState = { bounds, point: { x: point.screenX, y: point.screenY } };
  keepWindowInteractive();
});
ipcMain.on('window:move-to', (_event, point) => {
  if (!moveState || !win || win.isDestroyed() || !Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY)) return;
  updateWindowInteraction({ x: point.screenX, y: point.screenY });
});
ipcMain.on('window:move-end', (_event, point) => {
  if (Number.isFinite(point?.screenX) && Number.isFinite(point?.screenY)) {
    updateWindowInteraction({ x: point.screenX, y: point.screenY });
  }
  moveState = null;
});
ipcMain.on('window:resize-start', (_event, point, edge) => {
  if (!win || win.isDestroyed() || !Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY)) return;
  if (!['n', 'ne', 'e', 'se', 's', 'sw', 'w', 'nw'].includes(edge)) return;
  moveState = null;
  resizeState = {
    bounds: win.getBounds(),
    point: { x: point.screenX, y: point.screenY },
    edge
  };
  keepWindowInteractive();
});
ipcMain.on('window:resize-to', (_event, point) => {
  if (!resizeState || !win || win.isDestroyed() || !Number.isFinite(point?.screenX) || !Number.isFinite(point?.screenY)) return;
  updateWindowInteraction({ x: point.screenX, y: point.screenY });
});
ipcMain.on('window:resize-end', (_event, point) => {
  if (Number.isFinite(point?.screenX) && Number.isFinite(point?.screenY)) {
    updateWindowInteraction({ x: point.screenX, y: point.screenY });
  }
  resizeState = null;
});
ipcMain.on('ask', (_e, payload) => {
  if (!payload || typeof payload.mode !== 'string') return;
  runFeature(payload.mode, typeof payload.text === 'string' ? payload.text : '');
});
ipcMain.on('mic:pcm', (_e, arrayBuffer) => { if (state.capturing) routeAudio('you', arrayBuffer); });
ipcMain.on('system:pcm', (_e, arrayBuffer) => { if (state.capturing) routeAudio('them', arrayBuffer); });
ipcMain.on('mouse:regions', (_event, regions) => {
  if (!Array.isArray(regions)) return;
  interactiveRegions = regions
    .filter((region) => region && ['x', 'y', 'width', 'height'].every((key) => Number.isFinite(region[key])))
    .map(({ x, y, width, height }) => ({ x, y, width, height }));
});
ipcMain.on('open-pane', (_e, url) => { shell.openExternal(url).catch(() => {}); });
ipcMain.handle('app:quit', () => {
  setImmediate(() => app.quit());
  return true;
});
ipcMain.on('log', (_e, msg) => console.log('[renderer]', msg));

async function pickAndParseDocument() {
  const res = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Resume / Job description', extensions: ['pdf', 'docx'] }]
  });
  if (res.canceled || !res.filePaths.length) return null;
  const filePath = res.filePaths[0];
  const text = await parseDocumentFile(filePath);
  return { fileName: path.basename(filePath), text };
}
ipcMain.handle('profile:pickDocument', async () => {
  try {
    const picked = await pickAndParseDocument();
    if (!picked) return { canceled: true };
    return { canceled: false, fileName: picked.fileName, text: picked.text };
  } catch (e) {
    return { canceled: false, error: (e && e.message) || String(e) };
  }
});
ipcMain.handle('permissions:check', () => getPermissionStatus());
ipcMain.handle('permissions:request', () => requestPermissions());
ipcMain.on('permissions:continue', async () => {
  const status = await getPermissionStatus();
  if (status.mic === 'granted' && status.screen === 'granted') {
    if (permWin) { permWin.close(); permWin = null; }
    launchApp();
  }
});

function registerShortcuts() {
  shortcutState.assist = globalShortcut.register('CommandOrControl+Return', () => runFeature('assist', ''));
  shortcutState.say = globalShortcut.register('CommandOrControl+Shift+Return', () => runFeature('say', ''));
  shortcutState.leetcode = globalShortcut.register('CommandOrControl+H', () => runFeature('leetcode', ''));
  shortcutState.hide = globalShortcut.register('CommandOrControl+Shift+/', () => send('hide:toggle', {}));
  shortcutState.quit = globalShortcut.register('CommandOrControl+Shift+X', () => send('quit:request', {}));
}

async function verifyScreenAccess() {
  const sysStatus = systemPreferences.getMediaAccessStatus('screen');
  if (sysStatus === 'granted') return 'granted';

  try {
    const sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: { width: 16, height: 16 },
    });
    if (sources.length > 0) {
      const bmp = sources[0].thumbnail.toBitmap();

      if (bmp && bmp.some(byte => byte !== 0)) return 'granted';
    }
  } catch (_) {}

  return sysStatus;
}

async function getPermissionStatus() {
  return resolvePermissionStatus({
    platform: process.platform,
    getMediaAccessStatus: (mediaType) => systemPreferences.getMediaAccessStatus(mediaType),
    verifyScreenAccess
  });
}

async function requestPermissions() {
  if (process.platform !== 'darwin') return true;

  const micStatus = systemPreferences.getMediaAccessStatus('microphone');
  if (micStatus !== 'granted') {
    await systemPreferences.askForMediaAccess('microphone');
  }

  const screenStatus = await verifyScreenAccess();
  if (screenStatus !== 'granted') {
    try { await desktopCapturer.getSources({ types: ['screen'] }); } catch (_) {}
  }

  const status = await getPermissionStatus();
  return status.mic === 'granted' && status.screen === 'granted';
}

function createPermissionsWindow() {
  const { workArea } = screen.getPrimaryDisplay();
  const W = 500, H = 540;
  permWin = new BrowserWindow({
    width: W,
    height: H,
    x: Math.round(workArea.x + (workArea.width - W) / 2),
    y: Math.round(workArea.y + (workArea.height - H) / 2),
    frame: false,
    transparent: true,
    hasShadow: true,
    resizable: false,
    skipTaskbar: false,
    fullscreenable: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    }
  });
  permWin.loadFile(path.join(__dirname, 'renderer', 'permissions.html'));
  permWin.webContents.on('did-finish-load', () => permWin.show());
}

function launchApp() {
  if (isMac && app.dock) app.dock.hide();

  whisperModelManager = new WhisperModelManager({ userDataPath: app.getPath('userData') });
  meetingSessionStore = new MeetingSessionStore(path.join(app.getPath('userData'), 'meetings'));
  const restored = meetingSessionStore.getSnapshot();
  transcript.clear();
  for (const turn of restored.turns) transcript.push(turn);

  const allowMedia = (permission) => permission === 'media' || permission === 'microphone' || permission === 'audioCapture' || permission === 'display-capture' || permission === 'screen';
  session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => cb(allowMedia(permission)));
  session.defaultSession.setPermissionCheckHandler((_wc, permission) => allowMedia(permission));

  session.defaultSession.setDisplayMediaRequestHandler((request, callback) => {
    desktopCapturer.getSources({ types: ['screen'] }).then((sources) => {
      const streams = buildDisplayMediaStreams(sources[0], request.audioRequested);
      callback(streams || undefined);
    }).catch(() => callback());
  }, { useSystemPicker: false });

  createWindow();
  registerShortcuts();
  updateManager = createUpdateManager({
    updater: autoUpdater,
    isPackaged: app.isPackaged,
    platform: process.platform,
    appImagePath: process.env.APPIMAGE || '',
    currentVersion: app.getVersion(),
    publishState: (updateState) => send('update:state', updateState)
  });
  updateManager.start();
}

app.whenReady().then(async () => {
  app.setName('GhostPilot');
  if (isWindows) app.setAppUserModelId('com.ghostpilot.app');
  process.title = 'GhostPilot';

  if (isMac) {
    const allGranted = await requestPermissions();
    if (!allGranted) {

      createPermissionsWindow();
      app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createPermissionsWindow(); });
      return;
    }
  }

  launchApp();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
});

app.on('will-quit', () => {
  clearInterval(mousePollingTimer);
  mousePollingTimer = null;
  globalShortcut.unregisterAll();
  if (updateManager) {
    updateManager.dispose();
    updateManager = null;
  }
  if (activeLlmAbort) {
    activeLlmAbort.abort();
    activeLlmAbort = null;
  }
  if (whisperModelManager?.activeDownload) {
    whisperModelManager.cancelDownload(whisperModelManager.activeDownload.modelId);
  }
  if (localWhisperTranscriber) localWhisperTranscriber.forceStop().catch(() => {});
});

app.on('window-all-closed', (e) => {
  if (permWin) { e.preventDefault(); return; }
  app.quit();
});
