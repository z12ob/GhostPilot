
(function () {
  const { icon } = window.ICONS;
  const ghostPilot = window.ghostPilot;
  const $ = (s) => document.querySelector(s);
  const isWindows = ghostPilot.platform === 'win32';
  const isMac = ghostPilot.platform === 'darwin';

  $('#logo-btn').innerHTML = '<span class="brand-mark">' + icon('logo', { size: 18 }) + '</span><span class="brand-name">GhostPilot</span>';
  $('.tb-hide .chev').innerHTML = icon('chevron-down', { size: 14 });
  function renderCaptureButton(active) {
    const button = $('#stop-btn');
    button.innerHTML = icon(active ? 'square' : 'mic', { size: 15 }) + `<span class="tb-stop-label">${active ? 'Stop and save' : 'Listen'}</span>`;
  }
  function updateNotesButton(active) {
    const notesButton = document.getElementById('generate-notes-btn');
    if (!notesButton) return;
    notesButton.disabled = active;
    notesButton.title = active
      ? 'Stop and save before generating complete notes'
      : 'Generate structured notes from the saved raw transcript';
  }
  renderCaptureButton(false);
  updateNotesButton(false);
  $('#quit-btn').innerHTML = icon('x', { size: 14 });
  $('#ob-close').innerHTML = icon('x', { size: 16 });
  document.querySelector('.act[data-mode="assist"] .ic').innerHTML = icon('sparkles', { size: 16 });
  document.querySelector('.act[data-mode="say"] .ic').innerHTML = icon('wand-sparkles', { size: 16 });
  document.querySelector('.act[data-mode="followup"] .ic').innerHTML = icon('message-circle', { size: 16 });
  document.querySelector('.act[data-mode="recap"] .ic').innerHTML = icon('file-text', { size: 16 });
  $('#smart-toggle .ic').innerHTML = icon('zap', { size: 14 });
  $('#more-btn').innerHTML = icon('settings', { size: 17 });
  $('#send-btn').innerHTML = icon('arrow-up', { size: 15 });
  const clearIC = document.querySelector('#clear-transcript-btn .ic');
  if (clearIC) clearIC.innerHTML = icon('trash-2', { size: 15 });

  let settings = null;
  let whisperOverview = null;
  let busy = false;
  let captureActive = false;
  let updateState = null;
  let aiEl = null;
  let caretEl = null;
  let responseCount = 0;
  let rawTurnCount = 0;
  const MAX_RESPONSES = 20;

  const WORK_MODE_PRESENTATION = {
    interview: {
      summary: 'Interview answers use your resume and preparation.',
      scope: 'Screen is optional for Assist and typed questions.',
      actions: {
        say: ['What should I say?', 'Draft an answer to the latest interview question'],
        assist: ['Assist', 'Analyze the transcript and optional screen to help right now'],
        followup: ['Follow-up', 'Suggest questions to ask the interviewer']
      }
    },
    meeting: {
      summary: 'Meeting and class help uses your topic, goal, and live transcript.',
      scope: 'Live actions use the transcript. Screen adds optional visual context.',
      actions: {
        say: ['Draft response', 'Draft a useful response based on the live transcript'],
        assist: ['Brief me', 'Explain what matters now using the transcript and optional screen'],
        followup: ['Questions', 'Find important questions raised by the transcript']
      }
    }
  };

  const messages = $('#messages');

  function esc(s) { return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])); }

  function renderMarkdown(text) {
    const lines = text.split('\n');
    let html = '', inCode = false, inList = false, buf = [];
    const flushP = () => { if (buf.length) { html += '<p>' + inline(buf.join(' ')) + '</p>'; buf = []; } };
    const inline = (s) => esc(s)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    for (const raw of lines) {
      const line = raw;
      if (/^```/.test(line.trim())) {
        if (!inCode) { flushP(); if (inList) { html += '</ul>'; inList = false; } html += '<pre><code>'; inCode = true; }
        else { html += '</code></pre>'; inCode = false; }
        continue;
      }
      if (inCode) { html += esc(line) + '\n'; continue; }
      if (/^\s*[-*]\s+/.test(line)) { flushP(); if (!inList) { html += '<ul>'; inList = true; } html += '<li>' + inline(line.replace(/^\s*[-*]\s+/, '')) + '</li>'; continue; }
      if (line.trim() === '') { flushP(); if (inList) { html += '</ul>'; inList = false; } continue; }
      buf.push(line.trim());
    }
    flushP(); if (inList) html += '</ul>'; if (inCode) html += '</code></pre>';
    return html;
  }

  function clearMessages() { messages.innerHTML = ''; aiEl = null; caretEl = null; }

  function addUserBubble(text) {
    const b = document.createElement('div');
    b.className = 'user-bubble';
    b.textContent = text;
    messages.appendChild(b);
  }

  function startAi(small) {
    aiEl = document.createElement('div');
    aiEl.className = 'ai-text' + (small ? ' small' : '');
    aiEl.dataset.raw = '';
    caretEl = document.createElement('span');
    caretEl.className = 'ai-caret';
    aiEl.appendChild(caretEl);
    messages.appendChild(aiEl);
  }

  function appendToken(t) {
    if (!aiEl) startAi(false);
    aiEl.dataset.raw += t;
    const span = document.createElement('span');
    span.className = 'w';
    span.textContent = t;
    if (caretEl && caretEl.parentNode === aiEl) {
      aiEl.insertBefore(span, caretEl);
    } else {
      aiEl.appendChild(span);
    }
  }

  let pendingTokens = '';
  let tokenFlushScheduled = false;
  function flushPendingTokens() {
    tokenFlushScheduled = false;
    if (!pendingTokens) return;
    const chunk = pendingTokens;
    pendingTokens = '';
    appendToken(chunk);
  }
  function queueToken(text) {
    pendingTokens += text;
    if (!tokenFlushScheduled) {
      tokenFlushScheduled = true;
      requestAnimationFrame(flushPendingTokens);
    }
  }
  function flushTokenQueue() {
    if (tokenFlushScheduled) {
      tokenFlushScheduled = false;
      flushPendingTokens();
    } else if (pendingTokens) {
      flushPendingTokens();
    }
  }

  function finalizeAi() {
    if (!aiEl) return;
    const raw = aiEl.dataset.raw || '';
    aiEl.innerHTML = renderMarkdown(raw);
    aiEl = null; caretEl = null;
  }

  let busyFailsafe = null;
  function setBusy(v) {
    busy = v;
    $('#send-btn').classList.toggle('busy', v);
    clearTimeout(busyFailsafe);
    if (v) busyFailsafe = setTimeout(() => { busy = false; $('#send-btn').classList.toggle('busy', false); }, 40000);
  }

  let transcriptInterimEl = null;

  function clearTranscriptInterim() {
    if (transcriptInterimEl) {
      transcriptInterimEl.remove();
      transcriptInterimEl = null;
    }
  }

  let toastTimer = null;
  let toastFadeTimer = null;
  function showToast(message, ms) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      document.getElementById('app').appendChild(el);
    }
    clearTimeout(toastTimer);
    clearTimeout(toastFadeTimer);
    el.textContent = message;
    el.classList.add('show');
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
    }, ms);
  }

  function runMode(mode, text) {
    setBusy(true);
    ghostPilot.ask({ mode, text: text || '' });
  }

  document.querySelectorAll('.act').forEach((btn) => {
    btn.addEventListener('click', () => runMode(btn.dataset.mode, ''));
  });

  const input = $('#input');
  const placeholder = $('#placeholder');
  const composer = $('#composer');

  function currentWorkMode() {
    return settings?.workMode === 'meeting' ? 'meeting' : 'interview';
  }

  function renderWorkMode() {
    if (!settings) return;
    const mode = currentWorkMode();
    const presentation = WORK_MODE_PRESENTATION[mode];
    document.querySelectorAll('button[data-work-mode]').forEach((button) => {
      const selected = button.dataset.workMode === mode;
      button.classList.toggle('on', selected);
      button.setAttribute('aria-pressed', String(selected));
    });
    document.querySelectorAll('[data-work-mode-context]').forEach((section) => {
      section.classList.toggle('hidden', section.dataset.workModeContext !== mode);
    });
    document.querySelectorAll('[data-work-mode-only="interview"]').forEach((element) => {
      element.classList.toggle('hidden', mode !== 'interview');
    });

    const activeRestrictedTab = document.querySelector('.s-tab.on[data-work-mode-only="interview"]');
    if (mode === 'meeting' && activeRestrictedTab) {
      document.querySelectorAll('.s-tab').forEach((tab) => {
        tab.classList.remove('on');
        tab.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.s-tab-pane').forEach((pane) => pane.classList.add('hidden'));
      $('#tab-profile').classList.add('on');
      $('#tab-profile').setAttribute('aria-selected', 'true');
      $('#pane-profile').classList.remove('hidden');
    }

    $('#work-mode-summary').textContent = presentation.summary;
    $('#scope-note').textContent = presentation.scope;
    Object.entries(presentation.actions).forEach(([action, [label, title]]) => {
      const button = document.querySelector(`.act[data-mode="${action}"]`);
      if (!button) return;
      const labelElement = button.querySelector('.action-label');
      if (labelElement) labelElement.textContent = label;
      button.title = title;
      button.setAttribute('aria-label', title);
    });

    const key = isWindows ? '<span class="keycap">Ctrl</span><span class="keycap">⏎</span>' : '<span class="keycap">⌘</span><span class="keycap">⏎</span>';
    placeholder.innerHTML = mode === 'meeting'
      ? `Ask about the meeting, class, or screen, or use ${key} for Brief me`
      : `Ask about your screen or interview, or use ${key} for Assist`;
    updatePrepStatus();
  }

  async function setWorkMode(mode) {
    if (!settings) return;
    const previousMode = currentWorkMode();
    const nextMode = mode === 'meeting' ? 'meeting' : 'interview';
    if (nextMode === previousMode) return;
    settings.workMode = nextMode;
    renderWorkMode();
    try {
      settings = await ghostPilot.settingsSet({ workMode: nextMode });
    } catch {
      settings.workMode = previousMode;
      renderWorkMode();
      showToast('Could not change the scenario. Try again.', 3000);
    }
  }

  document.querySelectorAll('button[data-work-mode]').forEach((button) => {
    button.addEventListener('click', () => { void setWorkMode(button.dataset.workMode); });
  });

  let inputFromSTT = false;
  let sttFillTimer = null;
  let questionFinalizeTimer = null;
  let softClearTimer = null;
  let userSpeechStart = null;

  const questionHistory = [];
  const MAX_QUESTION_HISTORY = 10;

  function isLikelyCompleteQuestion(text) {
    const trimmed = (text || '').trim();
    
    if (trimmed.length < 12) return false;
    
    if (/\?$/.test(trimmed)) return true;
    
    const behavioralPatterns = [
      /tell me about a time/i,
      /give me an example/i,
      /describe a (situation|time|project|challenge)/i,
      /walk me through/i,
      /can you (tell|describe|explain|share)/i,
      /what (was|were|is|are) your/i,
      /how (did|do|would) you/i,
      /why (did|do|are|should)/i,
      /what (did|do|would) you/i,
      /tell me about yourself/i,
      /tell me about your/i,
      /what.{1,30}(biggest|greatest|most|hardest|proudest)/i,
      /have you ever/i
    ];
    if (behavioralPatterns.some(p => p.test(trimmed))) return true;
    
    const questionStarters = /^(what|how|why|when|where|who|which|tell|describe|explain|can|could|would|should|have|did|do|is|are|was|were)/i;
    if (questionStarters.test(trimmed) && trimmed.length > 25) return true;
    
    if (/(about that|for us|to us|with you|for you|about it|to share|you handle|you approach|your experience|your background)\s*$/i.test(trimmed)) return true;
    
    return false;
  }

  function getQuestionConfidence(text) {
    const trimmed = (text || '').trim();
    if (trimmed.length < 8) return 'low';
    if (/\?$/.test(trimmed)) return 'high';
    if (isLikelyCompleteQuestion(trimmed)) return 'medium';
    if (trimmed.length > 20) return 'accumulating';
    return 'low';
  }

  function updateQuestionReadyState() {
    const text = input.value;
    const confidence = getQuestionConfidence(text);
    
    const shouldBeReady = confidence === 'high' || confidence === 'medium';
    const shouldBeAccumulating = confidence === 'accumulating';
    
    const isReady = composer.classList.contains('stt-ready');
    const isAccumulating = composer.classList.contains('stt-accumulating');
    
    if (shouldBeReady !== isReady || shouldBeAccumulating !== isAccumulating) {
      composer.classList.remove('stt-ready', 'stt-accumulating');
      if (shouldBeReady) {
        composer.classList.add('stt-ready');
      } else if (shouldBeAccumulating) {
        composer.classList.add('stt-accumulating');
      }
    }
    
    updateSendButtonState();
  }
  
  function updateSendButtonState() {
    const sendBtn = document.getElementById('send-btn');
    if (!sendBtn) return;
    
    const hasText = input.value.trim().length > 0;
    const isReady = composer.classList.contains('stt-ready');
    
    sendBtn.classList.toggle('ready', hasText && isReady);
    sendBtn.classList.toggle('has-text', hasText);
  }

  function saveToQuestionHistory(text) {
    if (!text || text.trim().length < 5) return;
    
    const last = questionHistory[questionHistory.length - 1];
    if (last && last.text === text.trim()) return;
    
    questionHistory.push({
      text: text.trim(),
      timestamp: Date.now()
    });
    

    while (questionHistory.length > MAX_QUESTION_HISTORY) {
      questionHistory.shift();
    }
    
    updateHistoryBadge();
  }
  

  function updateHistoryBadge() {
    const historyBtn = document.getElementById('history-btn');
    if (!historyBtn) return;
    

    let badge = historyBtn.querySelector('.history-badge');
    
    const count = rawTurnCount;
    if (count > 0) {
      if (!badge) {
        badge = document.createElement('span');
        badge.className = 'history-badge';
        historyBtn.appendChild(badge);
      }
      badge.textContent = count > 9 ? '9+' : count;
      badge.style.display = '';
    } else if (badge) {
      badge.style.display = 'none';
    }
  }

  function restoreLastQuestion() {
    const last = questionHistory.pop();
    if (last) {
      input.value = last.text;
      inputFromSTT = true;
      lastSTTValue = last.text;
      composer.classList.add('stt-filling');
      updateQuestionReadyState();
      syncPlaceholder();
      updateHistoryBadge();
      showToast('Question restored', 1500);
      return true;
    }
    showToast('No question to restore', 1500);
    return false;
  }

  function autoFillInputFromSTT(text) {

    if (!inputFromSTT && input.value.trim().length > 0) return;

    clearTimeout(softClearTimer);
    composer.classList.remove('stt-dimmed');

    const current = input.value.trim();
    const newText = current ? current + ' ' + text : text;
    input.value = newText;
    inputFromSTT = true;
    lastSTTValue = newText;
    syncPlaceholder();

    composer.classList.add('stt-filling');
    updateQuestionReadyState();
    updateSendButtonState();

    clearTimeout(questionFinalizeTimer);
    questionFinalizeTimer = setTimeout(() => {
      if (isLikelyCompleteQuestion(input.value)) {
        composer.classList.add('stt-ready');
        updateSendButtonState();

        showToast('Press Enter to answer', 2500);
      }
    }, 1800);

    clearTimeout(sttFillTimer);
    sttFillTimer = setTimeout(() => {
      saveToQuestionHistory(input.value);
      composer.classList.remove('stt-filling');

      updateQuestionReadyState();
      updateSendButtonState();
    }, 8000);
  }

  function softClearSTTFill() {

    if (!inputFromSTT) return;
    

    const now = Date.now();
    if (!userSpeechStart) {
      userSpeechStart = now;
    }

    composer.classList.add('stt-dimmed');
    

    clearTimeout(questionFinalizeTimer);

    clearTimeout(softClearTimer);
    softClearTimer = setTimeout(() => {
      const speechDuration = userSpeechStart ? Date.now() - userSpeechStart : 0;
      if (speechDuration > 2000) {

        saveToQuestionHistory(input.value);
        input.value = '';
        inputFromSTT = false;
        composer.classList.remove('stt-filling', 'stt-dimmed', 'stt-ready', 'stt-accumulating');
        syncPlaceholder();
        updateSendButtonState();
        userSpeechStart = null;
      }
    }, 800);
  }

  function hardClearSTTFill(showUndoHint = false) {
    const hadContent = input.value.trim().length > 0;
    saveToQuestionHistory(input.value);
    input.value = '';
    inputFromSTT = false;
    lastSTTValue = '';
    userSpeechStart = null;
    composer.classList.remove('stt-filling', 'stt-dimmed', 'stt-ready', 'stt-accumulating');
    clearTimeout(softClearTimer);
    clearTimeout(questionFinalizeTimer);
    clearTimeout(sttFillTimer);
    clearInputInterim();
    syncPlaceholder();
    updateSendButtonState();
    updateHistoryBadge();
    

    if (showUndoHint && hadContent) {
      const undoHint = isWindows ? 'Ctrl+Z to undo' : '⌘Z to undo';
      showToast(`Cleared · ${undoHint}`, 2000);
    }
  }

  function cancelSoftClear() {
    userSpeechStart = null;
    clearTimeout(softClearTimer);
    composer.classList.remove('stt-dimmed');
  }

  function syncPlaceholder() {
    placeholder.classList.toggle('hidden', input.value.length > 0 || document.activeElement === input);
    input.style.height = 'auto';
    input.style.height = Math.min(input.scrollHeight, 140) + 'px';
  }
  

  let lastSTTValue = '';
  
  input.addEventListener('input', () => {
    const currentValue = input.value;
    

    clearInputInterim();
    

    if (inputFromSTT && lastSTTValue) {
      const lengthDiff = Math.abs(currentValue.length - lastSTTValue.length);
      const isCleared = currentValue.trim().length === 0;
      const isSubstantialChange = lengthDiff > lastSTTValue.length * 0.3 || isCleared;
      
      if (isSubstantialChange) {

        saveToQuestionHistory(lastSTTValue);
        inputFromSTT = false;
        lastSTTValue = '';
        composer.classList.remove('stt-filling', 'stt-dimmed', 'stt-ready', 'stt-accumulating');
        clearTimeout(softClearTimer);
        clearTimeout(questionFinalizeTimer);
      }

    } else if (!inputFromSTT) {

      composer.classList.remove('stt-filling', 'stt-dimmed', 'stt-ready', 'stt-accumulating');
    }
    
    syncPlaceholder();
    updateSendButtonState();
  });
  input.addEventListener('focus', () => { composer.classList.add('focused'); placeholder.classList.add('hidden'); });
  input.addEventListener('blur', () => { composer.classList.remove('focused'); syncPlaceholder(); });
  $('#input-area').addEventListener('click', () => input.focus());

  function send() {
    const text = input.value.trim();
    if (!text) { runMode('assist', ''); return; }
    const wasFromSTT = inputFromSTT;
    

    saveToQuestionHistory(text);
    
    input.value = '';
    inputFromSTT = false;
    lastSTTValue = '';
    userSpeechStart = null;
    composer.classList.remove('stt-filling', 'stt-dimmed', 'stt-ready', 'stt-accumulating');
    clearTimeout(softClearTimer);
    clearTimeout(questionFinalizeTimer);
    clearTimeout(sttFillTimer);
    syncPlaceholder();
    updateSendButtonState();
    

    runMode(wasFromSTT ? 'answerThis' : 'ask', text);
  }
  $('#send-btn').addEventListener('click', send);
  input.addEventListener('keydown', (e) => {

    if ((e.metaKey || e.ctrlKey) && e.key === 'z' && !input.value.trim()) {
      e.preventDefault();
      restoreLastQuestion();
      return;
    }

    if (e.key === 'Escape' && input.value.trim()) {
      e.preventDefault();
      hardClearSTTFill(true);
      return;
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey) { e.preventDefault(); send(); }
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); runMode('assist', ''); }
  });
  

  document.addEventListener('keydown', (e) => {

    if ((e.metaKey || e.ctrlKey) && e.shiftKey && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      if (input.value.trim()) {
        send();
      } else if (inputFromSTT || composer.classList.contains('stt-filling')) {

        send();
      } else {
        showToast('No question to answer', 1500);
      }
    }
  });
  

  const sendBtn = document.getElementById('send-btn');
  if (sendBtn) {
    const forceKey = isWindows ? 'Ctrl+Shift+A' : '⌘⇧A';
    sendBtn.title = `Send this question. ${forceKey} forces an answer.`;
  }

  const smartBtn = $('#smart-toggle');
  smartBtn.addEventListener('click', async () => {
    settings.smart = !settings.smart;
    smartBtn.classList.toggle('on', settings.smart);
    smartBtn.setAttribute('aria-pressed', String(settings.smart));
    await ghostPilot.settingsSet({ smart: settings.smart });
  });

  function toggleHide() {
    const collapsed = $('#panel').classList.toggle('collapsed');
    $('#hide-btn').classList.toggle('collapsed', collapsed);
    $('#hide-btn').setAttribute('aria-expanded', String(!collapsed));
    $('#live-dot').style.display = collapsed ? 'none' : '';
  }
  $('#hide-btn').addEventListener('click', toggleHide);
  ghostPilot.on('hide:toggle', toggleHide);

  $('#stop-btn').addEventListener('click', async () => {
    if (captureActive) {
      await ghostPilot.captureToggle();
      return;
    }

    const mediaStarts = [startMic(), startSystemAudio()];
    const active = await ghostPilot.captureToggle();
    await Promise.allSettled(mediaStarts);
    if (!active) {
      stopMic();
      stopSystemAudio();
    }
  });

  const clearTranscriptBtn = document.getElementById('clear-transcript-btn');
  if (clearTranscriptBtn) {
    clearTranscriptBtn.addEventListener('click', async () => {
      saveToQuestionHistory(input.value);
      await ghostPilot.clearTranscript();
      clearMessages();
      if (interimEl) { interimEl.textContent = ''; interimEl.classList.remove('show'); }
      transcriptInterimEl = null;
      clearTranscriptSidebar();
      hardClearSTTFill();
      showToast('Panel cleared. Saved raw transcript was not deleted.', 3500);
    });
  }

  function setSourceState(id, state, text) {
    const element = document.getElementById(id);
    if (!element) return;
    element.className = `source-state source-${state}`;
    element.textContent = text;
  }

  let audioCtx = null, micStream = null, micWorklet = null;
  async function startMic() {
    if (micStream) return;
    setSourceState('mic-source-state', 'starting', 'Mic connecting');
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
          sampleRate: 16000
        }
      });

      const [track] = micStream.getAudioTracks();
      if (!track) {
        micStream.getTracks().forEach((t) => t.stop());
        micStream = null;
        showStatus('No microphone audio track was available. Check Windows Sound settings for a working default input device, then try again.');
        setSourceState('mic-source-state', 'error', 'Mic unavailable');
        return;
      }
      ghostPilot.log('mic stream started: track=' + (track.label || '(no label, permission may be stale)') + ' muted=' + track.muted);
      audioCtx = new AudioContext({ sampleRate: 16000 });
      if (audioCtx.state === 'suspended') await audioCtx.resume();

      try {
        await audioCtx.audioWorklet.addModule('audio-worklet-processor.js');
        const source = audioCtx.createMediaStreamSource(micStream);
        micWorklet = new AudioWorkletNode(audioCtx, 'ghostpilot-audio-processor');
        micWorklet.port.onmessage = (e) => {
          ghostPilot.micPcm(e.data);
        };
        const sink = audioCtx.createGain();
        sink.gain.value = 0;
        source.connect(micWorklet);
        micWorklet.connect(sink);
        sink.connect(audioCtx.destination);
        micWorklet._sink = sink;

        ghostPilot.log('mic AudioWorklet processor attached');
      } catch (workletErr) {

        ghostPilot.log('AudioWorklet failed, falling back to ScriptProcessor: ' + workletErr.message);
        const micNode = audioCtx.createMediaStreamSource(micStream);
        const micProc = audioCtx.createScriptProcessor(4096, 1, 1);
        const sink = audioCtx.createGain(); sink.gain.value = 0;
        micNode.connect(micProc); micProc.connect(sink); sink.connect(audioCtx.destination);
        micProc.onaudioprocess = (e) => {
          const f = e.inputBuffer.getChannelData(0);
          const out = new Int16Array(f.length);
          for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
          ghostPilot.micPcm(out.buffer);
        };
        micWorklet = { _legacy: true, proc: micProc, node: micNode, sink };
      }
      setSourceState('mic-source-state', 'on', 'Mic on');
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const name = err && err.name;
      ghostPilot.log('mic error: ' + name + ': ' + message);

      if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
        showStatus('No microphone was found. Plug one in, or pick a default input device in your OS sound settings, then try again.');
      } else if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        showStatus(isWindows
          ? 'Microphone permission was denied. Settings → Privacy & security → Microphone → allow GhostPilot, then try again.'
          : 'Microphone permission was denied. System Settings → Privacy & Security → Microphone → allow GhostPilot, then try again.');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        showStatus('The microphone could not be started. Another application may be using it exclusively. Close other apps using the mic and try again.');
      } else {
        showStatus('Microphone capture could not be started. Check your mic permissions and try again.');
      }
      setSourceState('mic-source-state', 'error', 'Mic unavailable');
    }
  }
  function stopMic() {
    if (micWorklet) {
      if (micWorklet._legacy) {
        micWorklet.proc.disconnect(); micWorklet.proc.onaudioprocess = null;
        micWorklet.node.disconnect(); micWorklet.sink.disconnect();
      } else {
        if (micWorklet._sink) micWorklet._sink.disconnect();
        micWorklet.disconnect();
      }
      micWorklet = null;
    }
    if (audioCtx) { audioCtx.close(); audioCtx = null; }
    if (micStream) { micStream.getTracks().forEach((t) => t.stop()); micStream = null; }
    setSourceState('mic-source-state', 'off', 'Mic off');
  }

  let sysStream = null, sysCtx = null, sysWorklet = null, sysStarting = false;
  async function startSystemAudio() {

    if (sysStream || sysStarting) return;
    sysStarting = true;
    setSourceState('meeting-source-state', 'starting', 'Meeting audio connecting');
    if (!navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== 'function') {
      ghostPilot.log('system audio unavailable: getDisplayMedia not supported');
      showStatus('Meeting audio capture is not available on this device build.');
      setSourceState('meeting-source-state', 'error', 'Meeting audio unavailable');
      sysStarting = false;
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: true });

      stream.getVideoTracks().forEach((t) => t.stop());
      const tracks = stream.getAudioTracks();
      if (!tracks.length) {
        ghostPilot.log('system audio: no loopback track on this platform');
        stream.getTracks().forEach((t) => t.stop());
        showStatus(ghostPilot.platform === 'win32'
          ? 'Windows did not provide a meeting-audio track. Check that your default output device is working and is not in exclusive mode, then try again.'
          : 'No meeting-audio track was available. Meeting audio needs macOS 14.4 or later. Your screen and microphone can still work.');
        setSourceState('meeting-source-state', 'error', 'Meeting audio unavailable');
        return;
      }
      sysStream = stream;
      sysCtx = new AudioContext({ sampleRate: 16000 });
      if (sysCtx.state === 'suspended') await sysCtx.resume();
      tracks.forEach((track) => {
        track.addEventListener('ended', () => {
          if (sysStream !== stream) return;
          stopSystemAudio();
          if (captureActive) {
            setSourceState('meeting-source-state', 'error', 'Meeting audio disconnected');
            showStatus('Meeting audio stopped. Click Stop and save, then Listen to reconnect it.');
          }
        }, { once: true });
      });

      try {
        await sysCtx.audioWorklet.addModule('audio-worklet-processor.js');
        const source = sysCtx.createMediaStreamSource(new MediaStream(tracks));
        sysWorklet = new AudioWorkletNode(sysCtx, 'ghostpilot-audio-processor');
        sysWorklet.port.onmessage = (e) => {
          ghostPilot.systemPcm(e.data);
        };
        const sink = sysCtx.createGain();
        sink.gain.value = 0;
        source.connect(sysWorklet);
        sysWorklet.connect(sink);
        sink.connect(sysCtx.destination);
        sysWorklet._sink = sink;
        ghostPilot.log('system audio: AudioWorklet capturing loopback');
      } catch (workletErr) {

        ghostPilot.log('system audio AudioWorklet failed, using ScriptProcessor: ' + workletErr.message);
        const sysNode = sysCtx.createMediaStreamSource(new MediaStream(tracks));
        const sysProc = sysCtx.createScriptProcessor(4096, 1, 1);
        const sink = sysCtx.createGain(); sink.gain.value = 0;
        sysNode.connect(sysProc); sysProc.connect(sink); sink.connect(sysCtx.destination);
        sysProc.onaudioprocess = (e) => {
          const f = e.inputBuffer.getChannelData(0);
          const out = new Int16Array(f.length);
          for (let i = 0; i < f.length; i++) { const s = Math.max(-1, Math.min(1, f[i])); out[i] = s < 0 ? s * 0x8000 : s * 0x7fff; }
          ghostPilot.systemPcm(out.buffer);
        };
        sysWorklet = { _legacy: true, proc: sysProc, node: sysNode, sink };
      }
      setSourceState('meeting-source-state', 'on', 'Meeting audio on');
    } catch (err) {
      const message = err && err.message ? err.message : String(err);
      const name = err && err.name;
      ghostPilot.log('system audio error: ' + name + ': ' + message);
      stopSystemAudio();
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError') {
        showStatus(isWindows
          ? 'Windows blocked meeting audio. Allow desktop microphone access, restart GhostPilot, and try again.'
          : 'Meeting audio permission was denied. Allow screen and audio access to GhostPilot, then try again.');
      } else if (name === 'NotReadableError' || name === 'TrackStartError') {
        showStatus('Meeting audio could not open the default output device. Close apps using exclusive audio and try again.');
      } else if (name === 'AbortError') {
        showStatus('Meeting audio startup was cancelled. Click Listen to try again.');
      } else {
        showStatus('Meeting audio could not start. Check your default output device, restart GhostPilot, and try again.');
      }
      setSourceState('meeting-source-state', 'error', 'Meeting audio unavailable');
    } finally {
      sysStarting = false;
    }
  }
  function stopSystemAudio() {
    if (sysWorklet) {
      if (sysWorklet._legacy) {
        sysWorklet.proc.disconnect(); sysWorklet.proc.onaudioprocess = null;
        sysWorklet.node.disconnect(); sysWorklet.sink.disconnect();
      } else {
        if (sysWorklet._sink) sysWorklet._sink.disconnect();
        sysWorklet.disconnect();
      }
      sysWorklet = null;
    }
    if (sysCtx) { sysCtx.close(); sysCtx = null; }
    if (sysStream) { sysStream.getTracks().forEach((t) => t.stop()); sysStream = null; }
    if (!captureActive) setSourceState('meeting-source-state', 'off', 'Meeting audio off');
  }

  if (navigator.mediaDevices?.addEventListener) {
    navigator.mediaDevices.addEventListener('devicechange', () => {
      if (!captureActive) return;
      setSourceState('meeting-source-state', 'error', 'Audio device changed');
      showStatus('Your audio device changed. Click Stop and save, then Listen to reconnect the microphone and meeting audio.');
    });
  }

  function setLiveDotState(dotState) {
    const dot = document.getElementById('live-dot');
    if (!dot) return;
    dot.classList.remove('off', 'idle', 'speaking', 'transcribing');
    dot.classList.add(dotState);
    const labels = {
      off:          'Not listening',
      idle:         'Listening ,  silence detected',
      speaking:     'Speech detected',
      transcribing: 'Transcribing…'
    };
    dot.title = labels[dotState] || '';
  }

  let sttState = 'disconnected';

  function updateSttStatus({ active, streaming } = {}) {
    const label = document.getElementById('stt-status');
    if (!label) return;
    if (active === false) {
      sttState = 'disconnected';
      label.textContent = 'off';
    } else if (active === true) {
      sttState = streaming ? 'connecting' : 'batch';
      label.textContent = sttState;
    }
    label.className = 'stt-status stt-' + sttState;
  }

  let tsSidebarInterimEl = null;
  let sidebarOpen = false;
  let currentSession = null;
  let currentSessionHasNotes = false;

  function updateMeetingActions() {
    const meetingActions = document.getElementById('meeting-complete-actions');
    if (!meetingActions) return;
    const hasSavedSession = currentSession && currentSession.status !== 'recording';
    meetingActions.classList.toggle('hidden', !hasSavedSession || captureActive);
    const title = document.getElementById('meeting-complete-title');
    const detail = document.getElementById('meeting-complete-detail');
    const notesButton = document.getElementById('generate-notes-btn');
    const isInterviewSession = currentSession?.kind === 'interview';
    if (title) title.textContent = currentSessionHasNotes
      ? (isInterviewSession ? 'Interview notes saved' : 'Meeting / class notes saved')
      : (isInterviewSession ? 'Interview saved' : 'Meeting / class saved');
    if (detail) detail.textContent = currentSessionHasNotes
      ? `Notes and ${rawTurnCount} raw turns are stored locally.`
      : `Your ${rawTurnCount} raw transcript turns are safe on this device.`;
    if (notesButton) notesButton.querySelector('span:last-child').textContent = currentSessionHasNotes ? 'Regenerate notes' : 'Generate notes';
  }

  const tsLastRow = { you: null, them: null };
  const tsRowTimer = { you: null, them: null };
  const TS_SENTENCE_GAP_MS = 10000;
  const MAX_VISIBLE_TRANSCRIPT_ROWS = 400;

  function showSidebar() {
    const sidebar = document.getElementById('transcript-sidebar');
    const historyBtn = document.getElementById('history-btn');
    if (sidebar) sidebar.classList.remove('hidden');
    if (historyBtn) {
      historyBtn.classList.add('active');
      historyBtn.setAttribute('aria-expanded', 'true');
    }
    const panelWrap = document.getElementById('panel-wrap');
    if (panelWrap) panelWrap.classList.add('sidebar-open');
    sidebarOpen = true;
  }

  function hideSidebar() {
    const sidebar = document.getElementById('transcript-sidebar');
    const historyBtn = document.getElementById('history-btn');
    if (sidebar) sidebar.classList.add('hidden');
    if (historyBtn) {
      historyBtn.classList.remove('active');
      historyBtn.setAttribute('aria-expanded', 'false');
    }
    const panelWrap = document.getElementById('panel-wrap');
    if (panelWrap) panelWrap.classList.remove('sidebar-open');
    sidebarOpen = false;
  }

  function toggleSidebar() {
    if (sidebarOpen) {
      hideSidebar();
    } else {
      showSidebar();

      const list = document.getElementById('ts-list');
      if (list) {
        requestAnimationFrame(() => {
          list.scrollTop = list.scrollHeight;
        });
      }
    }
  }

  const historyBtn = document.getElementById('history-btn');
  if (historyBtn) {
    historyBtn.innerHTML = icon('file-text', { size: 14 }) + '<span class="history-label">Transcript</span>';
    historyBtn.addEventListener('click', toggleSidebar);
  }

  const closeSidebarBtn = document.getElementById('close-sidebar-btn');
  if (closeSidebarBtn) {
    closeSidebarBtn.addEventListener('click', hideSidebar);
  }

  function appendTranscriptHistoryTurn(channel, text, isInterim, options = {}) {
    const list = document.getElementById('ts-list');
    if (!list) return;
    const countTurn = options.countTurn !== false;
    const merge = options.merge !== false;

    const ph = list.querySelector('.ts-placeholder');
    if (ph) ph.remove();

    if (isInterim) {

      if (!tsSidebarInterimEl) {
        tsSidebarInterimEl = document.createElement('div');
        tsSidebarInterimEl.className = 'ts-turn ts-' + channel + ' ts-interim-row';
        const chLabel = document.createElement('span');
        chLabel.className = 'ts-channel';
        chLabel.textContent = channel === 'them' ? 'Meeting' : 'You';
        const txt = document.createElement('span');
        txt.className = 'ts-text ts-interim';
        tsSidebarInterimEl.appendChild(chLabel);
        tsSidebarInterimEl.appendChild(txt);
        list.appendChild(tsSidebarInterimEl);
      }
      tsSidebarInterimEl.querySelector('.ts-text').textContent = text;
    } else {

      if (tsSidebarInterimEl) { tsSidebarInterimEl.remove(); tsSidebarInterimEl = null; }

      const existingRow = tsLastRow[channel];
      const useExisting = merge && existingRow && existingRow.isConnected;

      if (useExisting) {

        const txt = existingRow.querySelector('.ts-text');
        if (txt) {
          txt.textContent = txt.textContent ? txt.textContent + ' ' + text : text;
        }
      } else {

        const row = document.createElement('div');
        row.className = 'ts-turn ts-' + channel;

        const chLabel = document.createElement('span');
        chLabel.className = 'ts-channel';
        chLabel.textContent = channel === 'them' ? 'Meeting' : 'You';

        const txt = document.createElement('span');
        txt.className = 'ts-text';
        txt.textContent = text;

        row.appendChild(chLabel);
        row.appendChild(txt);
        list.appendChild(row);
        tsLastRow[channel] = row;
      }

      if (countTurn) rawTurnCount += 1;
      const rows = list.querySelectorAll('.ts-turn:not(.ts-interim-row)');
      if (rows.length > MAX_VISIBLE_TRANSCRIPT_ROWS) rows[0].remove();

      clearTimeout(tsRowTimer[channel]);
      tsRowTimer[channel] = setTimeout(() => { tsLastRow[channel] = null; }, TS_SENTENCE_GAP_MS);

      const other = channel === 'you' ? 'them' : 'you';
      clearTimeout(tsRowTimer[other]);
      tsLastRow[other] = null;

      list.scrollTop = list.scrollHeight;
      updateSessionSaveStatus();
      updateHistoryBadge();
    }
  }

  function clearTranscriptSidebar() {
    const list = document.getElementById('ts-list');
    if (list) list.innerHTML = '<div class="ts-placeholder">Raw speech-to-text appears here while listening.</div>';
    tsSidebarInterimEl = null;
    tsLastRow.you = null; tsLastRow.them = null;
    clearTimeout(tsRowTimer.you); clearTimeout(tsRowTimer.them);
  }

  function updateSessionSaveStatus() {
    const element = document.getElementById('session-save-status');
    if (!element) return;
    if (!currentSession) {
      element.textContent = 'Start Listen to create a saved session';
      return;
    }
    if (currentSession.status === 'recording') {
      element.textContent = `Recording and saving, ${rawTurnCount} raw turns`;
    } else if (currentSessionHasNotes) {
      element.textContent = `Notes and ${rawTurnCount} raw turns saved`;
    } else if (currentSession.status === 'interrupted') {
      element.textContent = `Recovered locally, ${rawTurnCount} raw turns`;
    } else {
      element.textContent = `Saved locally, ${rawTurnCount} raw turns`;
    }
  }

  function renderSessionSnapshot(snapshot) {
    currentSession = snapshot?.session || null;
    currentSessionHasNotes = !!snapshot?.hasNotes;
    rawTurnCount = Number(snapshot?.turnCount) || 0;
    clearTranscriptSidebar();
    const turns = Array.isArray(snapshot?.turns) ? snapshot.turns : [];
    for (const turn of turns) {
      appendTranscriptHistoryTurn(turn.channel, turn.text, false, { countTurn: false, merge: false });
    }
    const list = document.getElementById('ts-list');
    if (list && rawTurnCount > turns.length) {
      const notice = document.createElement('div');
      notice.className = 'ts-truncated';
      notice.textContent = `Showing the latest ${turns.length} turns. The complete transcript is saved.`;
      list.prepend(notice);
    }
    updateSessionSaveStatus();
    updateHistoryBadge();
    updateMeetingActions();
  }

  async function copyText(text) {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }
    const temporary = document.createElement('textarea');
    temporary.value = text;
    temporary.style.position = 'fixed';
    temporary.style.opacity = '0';
    document.body.appendChild(temporary);
    temporary.select();
    document.execCommand('copy');
    temporary.remove();
  }

  document.getElementById('copy-transcript-btn')?.addEventListener('click', async () => {
    const text = await ghostPilot.sessionTranscriptText();
    if (!text) {
      showToast('No saved raw transcript yet.', 2000);
      return;
    }
    try {
      await copyText(text);
      showToast('Raw transcript copied.', 2000);
    } catch {
      showToast('Copy failed. Open the meeting folder instead.', 3000);
    }
  });

  document.getElementById('open-session-folder-btn')?.addEventListener('click', async () => {
    const result = await ghostPilot.sessionOpenFolder();
    showToast(result.ok ? 'Opened the saved meeting folder.' : result.message, 3000);
  });

  ghostPilot.on('session:state', renderSessionSnapshot);

  ghostPilot.on('capture:state', async ({ active, streaming, mode }) => {
    captureActive = active;
    if (updateState) renderUpdateState(updateState);
    setLiveDotState(active ? 'idle' : 'off');
    $('#stop-btn').classList.toggle('active', active);
    $('#stop-btn').setAttribute('aria-pressed', String(active));
    $('#stop-btn').setAttribute('aria-label', active ? 'Stop and save meeting capture' : 'Start meeting capture');
    $('#stop-btn').title = active ? 'Stop and save meeting capture' : 'Start microphone and meeting-audio capture';
    renderCaptureButton(active);
    updateNotesButton(active);
    updateMeetingActions();
    composer.classList.toggle('listening', active);
    const historyBtn = document.getElementById('history-btn');
    if (historyBtn) historyBtn.classList.toggle('listening', active);

    if (active) {
      await startMic();
      try { await startSystemAudio(); } catch (_) {}
    } else {
      stopMic();
      stopSystemAudio();
      setSourceState('mic-source-state', 'off', 'Mic off');
      setSourceState('meeting-source-state', 'off', 'Meeting audio off');
      if (interimEl) {
        interimEl.textContent = '';
        interimEl.classList.remove('show');
      }
    }

    updateSttStatus({ active, streaming });
    if (active && mode === 'local') {
      sttState = 'local';
      const label = document.getElementById('stt-status');
      if (label) { label.textContent = 'local'; label.className = 'stt-status stt-local'; }
    }
  });

  let interimEl = null;
  function getOrCreateInterimEl() {
    if (!interimEl) {
      interimEl = document.createElement('div');
      interimEl.className = 'interim-transcript';

      const panelMain = document.getElementById('panel-main');
      const actionRow = document.getElementById('action-row');
      if (panelMain && actionRow && actionRow.parentNode === panelMain) {
        panelMain.insertBefore(interimEl, actionRow);
      } else if (panelMain) {
        panelMain.appendChild(interimEl);
      } else {
        document.getElementById('panel').appendChild(interimEl);
      }
    }
    return interimEl;
  }

  let inputInterimEl = null;
  function showInterimInInput(text) {
    if (!inputInterimEl) {
      inputInterimEl = document.createElement('span');
      inputInterimEl.className = 'input-interim';

      composer.appendChild(inputInterimEl);
    }
    inputInterimEl.textContent = text;
    inputInterimEl.style.display = text ? 'block' : 'none';
  }
  function clearInputInterim() {
    if (inputInterimEl) {
      inputInterimEl.textContent = '';
      inputInterimEl.style.display = 'none';
    }
  }
  
  ghostPilot.on('stt:interim', ({ channel, text }) => {
    setLiveDotState('transcribing');
    const el = getOrCreateInterimEl();
    const label = channel === 'them' ? 'Meeting' : 'You';
    el.textContent = `${label}: ${text}`;
    el.classList.add('show');
    appendTranscriptHistoryTurn(channel, text, true);
    

    if (channel === 'them' && !input.value.trim()) {
      showInterimInInput(text);
    }
  });
  ghostPilot.on('stt:final', ({ channel, text }) => {
    setLiveDotState('idle');

    if (interimEl) { interimEl.textContent = ''; interimEl.classList.remove('show'); }
    clearTranscriptInterim();
    clearInputInterim();

  });
  ghostPilot.on('stt:status', ({ channel, status, provider }) => {
    ghostPilot.log(`[stt] ${provider || channel || 'unknown'} ${status}`);
    if (provider === 'local') {
      const label = document.getElementById('stt-status');
      const localLabels = {
        loading: 'loading local',
        ready: 'local',
        transcribing: 'local',
        stopping: 'stopping',
        off: 'off',
        error: 'error'
      };
      sttState = status === 'ready' || status === 'transcribing' ? 'local' : status;
      if (label) {
        label.textContent = localLabels[status] || status;
        label.className = 'stt-status stt-' + sttState;
      }
      if (status === 'loading') $('#stop-btn').classList.add('active');
      if (status === 'off' || status === 'error') $('#stop-btn').classList.remove('active');
      if (status === 'loading' || status === 'transcribing' || status === 'stopping') setLiveDotState('transcribing');
      if (status === 'ready') setLiveDotState('idle');
      if (status === 'off') setLiveDotState('off');
      return;
    }
    if (status === 'connected') {
      sttState = 'streaming';
      const label = document.getElementById('stt-status');
      if (label) { label.textContent = sttState; label.className = 'stt-status stt-streaming'; }
    } else if (status === 'connecting' || status === 'reconnecting') {
      sttState = 'connecting';
      const label = document.getElementById('stt-status');
      if (label) { label.textContent = status; label.className = 'stt-status stt-connecting'; }
    }
  });
  ghostPilot.on('vad:state', ({ channel, speaking }) => {
    setLiveDotState(speaking ? 'speaking' : 'idle');
  });
  ghostPilot.on('llm:start', ({ userBubble, small, category }) => {
    responseCount++;
    if (responseCount > MAX_RESPONSES) {
      const oldest = messages.querySelector('.response-group');
      if (oldest) oldest.remove();
      responseCount = MAX_RESPONSES;
    }
    const group = document.createElement('div');
    group.className = 'response-group';
    const sep = document.createElement('div');
    sep.className = 'response-sep';
    sep.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    group.appendChild(sep);
    if (userBubble) {
      const b = document.createElement('div');
      b.className = 'user-bubble';
      b.textContent = userBubble;
      group.appendChild(b);
    }
    if (category) {
      const pill = document.createElement('div');
      pill.className = 'category-pill';
      pill.textContent = category.charAt(0).toUpperCase() + category.slice(1);
      group.appendChild(pill);
    }
    aiEl = document.createElement('div');
    aiEl.className = 'ai-text' + (small ? ' small' : '');
    aiEl.dataset.raw = '';
    caretEl = document.createElement('span');
    caretEl.className = 'ai-caret';
    aiEl.appendChild(caretEl);
    group.appendChild(aiEl);
    messages.appendChild(group);

    requestAnimationFrame(() => {
      if (sep && sep.isConnected) sep.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    setBusy(true);
  });
  ghostPilot.on('llm:token', ({ text }) => queueToken(text));
  ghostPilot.on('llm:done', () => { flushTokenQueue(); finalizeAi(); setBusy(false); });
  ghostPilot.on('llm:error', ({ message }) => {
    flushTokenQueue();
    if (!aiEl) startAi(true);
    aiEl.dataset.raw = message; finalizeAi(); setBusy(false);
  });
  ghostPilot.on('transcript', ({ channel, text }) => {
    if (!text || text.trim().length < 2 || /^[?!.,;:\-…]+$/.test(text.trim())) return;
    appendTranscriptHistoryTurn(channel, text, false);

    if (channel === 'them') {
      cancelSoftClear();
      autoFillInputFromSTT(text);
    } else {

      softClearSTTFill();
    }
  });
  let statusTimer = null;
  function showStatus(message) {
    let el = document.getElementById('ghostpilot-status');
    if (!el) {
      el = document.createElement('div');
      el.id = 'ghostpilot-status';

      const panelMain = document.getElementById('panel-main');
      const actionRow = document.getElementById('action-row');
      if (panelMain && actionRow && actionRow.parentNode === panelMain) {
        panelMain.insertBefore(el, actionRow);
      } else if (panelMain) {
        panelMain.appendChild(el);
      } else {
        document.getElementById('panel').appendChild(el);
      }
    }
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => el.classList.remove('show'), 11000);
  }
  ghostPilot.on('status', ({ message }) => {
    ghostPilot.log('[status] ' + message);
    showStatus(message);
    if (sttState !== 'disconnected') {
      const lower = message.toLowerCase();
      if (lower.includes('error') || lower.includes(' off')) {
        sttState = 'error';
        const label = document.getElementById('stt-status');
        if (label) { label.textContent = sttState; label.className = 'stt-status stt-error'; }
      }
    }
  });

  function updateAiRulesCounter() {
    const el = document.getElementById('ai-rules');
    const counter = document.getElementById('ai-rules-count');
    if (!el || !counter) return;
    const n = el.value.length;
    const cap = 2000;
    counter.textContent = String(n);
    counter.classList.toggle('over', n >= cap);
    counter.parentElement.classList.toggle('s-counter-warn', n >= cap - 100);
  }
  const aiRulesEl = document.getElementById('ai-rules');
  if (aiRulesEl) aiRulesEl.addEventListener('input', updateAiRulesCounter);
  function updatePrepStatus() {
    if (!settings) return;
    const meetingMode = currentWorkMode() === 'meeting';
    const fieldConfig = meetingMode
      ? [
          ['profile', 'Profile', settings.profileText],
          ['topic', 'Topic', settings.meetingTitle],
          ['goal', 'Goal', settings.meetingGoal],
          ['briefing', 'Briefing', settings.meetingContext]
        ]
      : [
          ['resume', 'Resume', settings.resumeText],
          ['jd', 'Job description', settings.jobDescription],
          ['stories', 'STAR stories', settings.starStories],
          ['salary', 'Salary', settings.salaryTarget]
        ];
    const fields = Object.fromEntries(fieldConfig.map(([key, _label, value]) => [key, !!String(value || '').trim()]));
    const items = [...document.querySelectorAll('#prep-status .prep-item')];
    items.forEach((element, index) => {
      const [key, label] = fieldConfig[index];
      element.dataset.field = key;
      element.textContent = label;
    });
    document.querySelectorAll('#prep-status .prep-item').forEach((el) => {
      const loaded = fields[el.dataset.field];
      el.classList.toggle('loaded', loaded);
      el.classList.toggle('missing', !loaded);
      el.title = loaded
        ? el.textContent.trim() + ' loaded'
        : el.textContent.trim() + ' not set ,  add in Settings';
    });
  }

  function updateSmartTooltip() {
    if (!settings) return;
    const m = settings.models[settings.provider] || { fast: '', smart: '' };
    const fast = m.fast || 'fast model';
    const smart = m.smart || 'smart model';
    const btn = document.getElementById('smart-toggle');
    if (btn) btn.title = 'Fast: ' + fast + ' · Smart: ' + smart + ' (higher quality, ~2× slower)';
  }

  function showMicPermissionBanner() {
    let banner = document.getElementById('mic-perm-banner');
    if (banner) { banner.classList.add('show'); return; }
    banner = document.createElement('div');
    banner.id = 'mic-perm-banner';
    banner.className = 'show';
    banner.innerHTML =
      '<div class="mic-perm-text">' +
        '<strong>🎙️ Microphone access required</strong><br>' +
        'GhostPilot needs microphone permission to hear you during calls. Grant access in System Settings, then restart GhostPilot.' +
      '</div>' +
      '<div class="mic-perm-actions"></div>';
    const actions = banner.querySelector('.mic-perm-actions');
    if (ghostPilot.platform === 'darwin') {
      const openBtn = document.createElement('button');
      openBtn.textContent = 'Open Microphone Settings';
      openBtn.addEventListener('click', () => ghostPilot.openPane('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone'));
      actions.appendChild(openBtn);
    }
    const dismissBtn = document.createElement('button');
    dismissBtn.textContent = 'Dismiss';
    dismissBtn.className = 'dismiss';
    dismissBtn.addEventListener('click', () => banner.classList.remove('show'));
    actions.appendChild(dismissBtn);
    const panel = document.getElementById('panel');
    panel.insertBefore(banner, document.getElementById('action-row'));
  }

  const scrim = $('#settings-scrim');

  function renderUpdateState(nextState) {
    if (!nextState) return;
    updateState = nextState;
    const version = document.getElementById('update-version');
    const message = document.getElementById('update-message');
    const badge = document.getElementById('update-badge');
    const progress = document.getElementById('update-progress');
    const checkButton = document.getElementById('check-update-button');
    const installButton = document.getElementById('install-update-button');
    const captureWarning = document.getElementById('update-capture-warning');
    if (!version || !message || !badge || !progress || !checkButton || !installButton || !captureWarning) return;

    const labels = {
      unavailable: 'Unavailable',
      idle: 'Ready',
      checking: 'Checking',
      downloading: 'Downloading',
      ready: 'Ready to install',
      current: 'Up to date',
      error: 'Check failed'
    };
    version.textContent = `Current version ${nextState.currentVersion}`;
    message.textContent = nextState.message;
    badge.textContent = labels[nextState.status] || 'Update';
    badge.classList.toggle('ready', nextState.status === 'ready' || nextState.status === 'current');
    badge.classList.toggle('error', nextState.status === 'error');
    progress.value = nextState.progress || 0;
    progress.classList.toggle('hidden', nextState.status !== 'downloading');
    checkButton.disabled = !nextState.supported || ['checking', 'downloading', 'ready'].includes(nextState.status);
    installButton.classList.toggle('hidden', nextState.status !== 'ready');
    installButton.disabled = captureActive;
    captureWarning.classList.toggle('hidden', nextState.status !== 'ready' || !captureActive);
  }

  document.getElementById('check-update-button')?.addEventListener('click', async () => {
    const nextState = await ghostPilot.updateCheck();
    renderUpdateState(nextState);
  });
  document.getElementById('install-update-button')?.addEventListener('click', async () => {
    const result = await ghostPilot.updateInstall();
    if (!result?.ok) showToast(result?.message || 'The update could not be installed.', 3500);
  });
  ghostPilot.on('update:state', renderUpdateState);

  function openSettings() {
    fillSettings();
    scrim.classList.remove('hidden');
    refreshWhisperModels();
    $('#s-close').focus();
  }
  async function closeSettings() {
    if (await saveSettings()) {
      scrim.classList.add('hidden');
      $('#more-btn').focus();
    }
  }
  $('#more-btn').addEventListener('click', openSettings);
  $('#s-close').addEventListener('click', () => { void closeSettings(); });
  scrim.addEventListener('click', (e) => { if (e.target === scrim) void closeSettings(); });

  document.querySelectorAll('.s-tab').forEach((tab) => {
    tab.addEventListener('click', async () => {
      if (tab.classList.contains('on')) return;
      if (!(await saveSettings())) return;
      document.querySelectorAll('.s-tab').forEach((candidate) => {
        candidate.classList.remove('on');
        candidate.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.s-tab-pane').forEach(p => p.classList.add('hidden'));
      tab.classList.add('on');
      tab.setAttribute('aria-selected', 'true');
      const pane = document.querySelector(`.s-tab-pane[data-pane="${tab.dataset.tab}"]`);
      if (pane) pane.classList.remove('hidden');
    });
  });

  function updateCustomProviderFields() {
    $('#custom-endpoint-settings').classList.toggle('hidden', settings.provider !== 'custom');
    $('#gemini-model-note').classList.toggle('hidden', settings.provider !== 'gemini');
  }

  function fillSettings() {

    document.querySelectorAll('#provider-seg button').forEach((b) => b.classList.toggle('on', b.dataset.provider === settings.provider));
    $('#key-openai').value = settings.apiKeys.openai || '';
    $('#key-anthropic').value = settings.apiKeys.anthropic || '';
    $('#key-gemini').value = settings.apiKeys.gemini || '';
    $('#key-deepgram').value = settings.apiKeys.deepgram || '';
    $('#key-custom').value = settings.apiKeys.custom || '';
    $('#base-url').value = settings.baseUrl || '';
    updateCustomProviderFields();
    $('#key-ollama').value = settings.apiKeys.ollama || '';
    $('#key-groq').value = settings.apiKeys.groq || '';
    $('#key-minimax').value = settings.apiKeys.minimax || '';
    document.querySelectorAll('#minimax-region-seg button').forEach((b) => b.classList.toggle('on', b.dataset.region === (settings.minimaxRegion || 'global_en')));
    $('#key-azure').value = settings.apiKeys.azure || '';
    $('#azure-endpoint').value = settings.azureEndpoint || '';
    const m = settings.models[settings.provider] || { fast: '', smart: '' };
    $('#model-fast').value = m.fast; $('#model-smart').value = m.smart;
    $('#s-status').textContent = statusText();

    document.querySelectorAll('#stt-provider-seg button').forEach((button) => {
      button.classList.toggle('on', button.dataset.sttProvider === (settings.sttProvider || 'auto'));
    });
    $('#gemini-stt-model').value = settings.geminiSttModel || 'gemini-3.5-transcribe-live';
    const localWhisper = settings.localWhisper || { modelId: 'base.en', language: 'auto', threads: 0 };
    $('#whisper-language').value = localWhisper.language || 'auto';
    $('#whisper-threads').value = Number(localWhisper.threads) || 0;

    $('#profile-text').value = settings.profileText || '';
    $('#meeting-title').value = settings.meetingTitle || '';
    $('#meeting-goal').value = settings.meetingGoal || '';
    $('#meeting-context').value = settings.meetingContext || '';
    $('#meeting-role').value = settings.meetingRole || '';
    $('#resume-text').value = settings.resumeText || '';
    $('#job-description').value = settings.jobDescription || '';

    $('#star-stories').value = settings.starStories || '';
    $('#why-company').value = settings.whyCompany || '';
    $('#why-leaving').value = settings.whyLeaving || '';
    $('#work-style').value = settings.workStyle || '';

    $('#ai-rules').value = settings.aiRules || '';
    updateAiRulesCounter();

    $('#salary-target').value = settings.salaryTarget || '';
    $('#questions-to-ask').value = settings.questionsToAsk || '';
    renderWorkMode();
  }

  const uploadResumeBtn = document.getElementById('upload-resume-btn');
  if (uploadResumeBtn) uploadResumeBtn.addEventListener('click', async () => {
    const res = await ghostPilot.pickProfileDocument();
    if (!res || res.canceled) return;
    if (res.error) { showStatus('Resume import failed: ' + res.error); return; }
    $('#resume-text').value = res.text || '';
    showStatus('Imported ' + res.fileName + ' ,  press Save to keep it.');
  });
  const uploadJdBtn = document.getElementById('upload-jd-btn');
  if (uploadJdBtn) uploadJdBtn.addEventListener('click', async () => {
    const res = await ghostPilot.pickProfileDocument();
    if (!res || res.canceled) return;
    if (res.error) { showStatus('Job description import failed: ' + res.error); return; }
    $('#job-description').value = res.text || '';
    showStatus('Imported ' + res.fileName + ' ,  press Save to keep it.');
  });

  function statusText() {
    const k = settings.apiKeys;
    const labels = { openai: 'OpenAI', anthropic: 'Anthropic', gemini: 'Gemini', deepgram: 'Deepgram', custom: 'Custom', ollama: 'Ollama', groq: 'Groq', minimax: 'MiniMax', azure: 'Azure AI Foundry' };
    const has = Object.keys(labels).filter((p) => k[p]).map((p) => labels[p]);

    const selectedSttProvider = settings.sttProvider || 'auto';
    const automaticStt = k.deepgram ? 'Deepgram (streaming)' : (k.openai ? 'OpenAI Realtime' : (k.groq ? 'Groq Whisper' : (k.gemini ? 'Gemini Live' : 'none')));
    const stt = selectedSttProvider === 'auto' ? automaticStt : selectedSttProvider;
    const ready = currentWorkMode() === 'meeting'
      ? [
          settings.profileText ? '✓ profile' : null,
          settings.meetingTitle ? '✓ topic' : null,
          settings.meetingGoal ? '✓ goal' : null,
          settings.meetingContext ? '✓ briefing' : null
        ].filter(Boolean)
      : [
          settings.resumeText ? '✓ resume' : null,
          settings.jobDescription ? '✓ JD' : null,
          settings.starStories ? '✓ stories' : null,
          settings.salaryTarget ? '✓ salary' : null
        ].filter(Boolean);
    return `${labels[settings.provider] || settings.provider} · STT: ${stt}` + (ready.length ? ' · ' + ready.join(' · ') : '');
  }

  document.querySelectorAll('#provider-seg button').forEach((b) => b.addEventListener('click', () => {
    settings.provider = b.dataset.provider;
    document.querySelectorAll('#provider-seg button').forEach((x) => x.classList.toggle('on', x === b));
    updateCustomProviderFields();
    const m = settings.models[settings.provider] || { fast: '', smart: '' };
    $('#model-fast').value = m.fast; $('#model-smart').value = m.smart;
    $('#s-status').textContent = statusText();
    updateSmartTooltip();
  }));
  document.querySelectorAll('#minimax-region-seg button').forEach((b) => b.addEventListener('click', () => {
    settings.minimaxRegion = b.dataset.region;
    document.querySelectorAll('#minimax-region-seg button').forEach((x) => x.classList.toggle('on', x === b));
  }));

  document.querySelectorAll('#stt-provider-seg button').forEach((button) => button.addEventListener('click', () => {
    settings.sttProvider = button.dataset.sttProvider;
    document.querySelectorAll('#stt-provider-seg button').forEach((candidate) => {
      candidate.classList.toggle('on', candidate === button);
    });
    $('#s-status').textContent = statusText();
  }));

  function formatBytes(bytes) {
    if (!Number.isFinite(bytes) || bytes <= 0) return '0 MB';
    const units = ['B', 'KB', 'MB', 'GB'];
    const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** unitIndex);
    return `${value >= 10 || unitIndex < 2 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
  }

  function getSelectedWhisperModel() {
    if (!whisperOverview) return null;
    return whisperOverview.models.find((model) => model.id === $('#whisper-model').value) || null;
  }

  function renderWhisperModelState() {
    const model = getSelectedWhisperModel();
    if (!model) return;
    const language = model.englishOnly ? 'English only' : 'Multilingual';
    const recommendation = model.recommended ? ' · recommended default' : '';
    const partial = model.partialBytes > 0 && !model.installed
      ? ` · ${formatBytes(model.partialBytes)} ready to resume`
      : '';
    $('#whisper-model-detail').textContent = `${formatBytes(model.bytes)} · ${language} · ${model.quantization} · ${model.hardwareTier}${recommendation}${partial}`;

    const progressWrap = $('#whisper-progress-wrap');
    const progressPercent = model.bytes > 0 ? Math.floor((model.partialBytes / model.bytes) * 100) : 0;
    progressWrap.classList.toggle('hidden', !model.downloading);
    $('#whisper-progress').value = progressPercent;
    $('#whisper-progress-label').textContent = `${progressPercent}%`;
    $('#whisper-download').disabled = model.installed || model.downloading;
    $('#whisper-download').textContent = model.installed ? 'Installed' : (model.partialBytes ? 'Resume' : 'Download');
    $('#whisper-cancel').classList.toggle('hidden', !model.downloading);
    $('#whisper-import').disabled = model.downloading;
    $('#whisper-delete').disabled = (model.installedBytes === 0 && model.partialBytes === 0) || model.downloading;
  }

  async function refreshWhisperModels() {
    const status = $('#whisper-status');
    try {
      const previousSelection = $('#whisper-model').value || settings.localWhisper?.modelId || 'base.en';
      whisperOverview = await ghostPilot.whisperModels();
      const runtimeBadge = $('#whisper-runtime-status');
      runtimeBadge.classList.toggle('ready', whisperOverview.runtime.available);
      runtimeBadge.classList.toggle('error', !whisperOverview.runtime.available);
      runtimeBadge.textContent = whisperOverview.runtime.available
        ? `Ready · v${whisperOverview.runtime.version} · ${whisperOverview.runtime.target}`
        : 'Not prepared';
      runtimeBadge.title = whisperOverview.runtime.message || '';

      const select = $('#whisper-model');
      select.innerHTML = '';
      for (const model of whisperOverview.models) {
        const option = document.createElement('option');
        option.value = model.id;
        option.textContent = `${model.label} ,  ${formatBytes(model.bytes)}${model.recommended ? ' (recommended)' : ''}${model.installed ? ' ✓' : ''}`;
        select.appendChild(option);
      }
      const selectionExists = whisperOverview.models.some((model) => model.id === previousSelection);
      select.value = selectionExists ? previousSelection : 'base.en';
      if (!settings.localWhisper) settings.localWhisper = {};
      settings.localWhisper.modelId = select.value;
      status.textContent = whisperOverview.runtime.available
        ? 'Model files are verified before they can be loaded.'
        : whisperOverview.runtime.message;
      renderWhisperModelState();
    } catch (error) {
      status.textContent = `Could not load local model information: ${error.message}`;
    }
  }

  $('#whisper-model').addEventListener('change', () => {
    if (!settings.localWhisper) settings.localWhisper = {};
    settings.localWhisper.modelId = $('#whisper-model').value;
    renderWhisperModelState();
  });

  $('#whisper-download').addEventListener('click', async () => {
    const model = getSelectedWhisperModel();
    if (!model) return;
    model.downloading = true;
    renderWhisperModelState();
    $('#whisper-status').textContent = `Downloading ${model.id}. You can cancel and resume later.`;
    try {
      await ghostPilot.whisperModelDownload(model.id);
      $('#whisper-status').textContent = `${model.id} downloaded and verified.`;
    } catch (error) {
      $('#whisper-status').textContent = error.message.includes('cancelled')
        ? `${model.id} download paused. Progress was kept.`
        : `Download failed: ${error.message}`;
    } finally {
      await refreshWhisperModels();
    }
  });

  $('#whisper-cancel').addEventListener('click', async () => {
    const model = getSelectedWhisperModel();
    if (model) await ghostPilot.whisperModelCancel(model.id);
  });

  $('#whisper-import').addEventListener('click', async () => {
    const model = getSelectedWhisperModel();
    if (!model) return;
    $('#whisper-status').textContent = `Verifying imported ${model.id}…`;
    try {
      const result = await ghostPilot.whisperModelImport(model.id);
      $('#whisper-status').textContent = result.cancelled ? 'Import cancelled.' : `${model.id} imported and verified.`;
    } catch (error) {
      $('#whisper-status').textContent = `Import failed: ${error.message}`;
    } finally {
      await refreshWhisperModels();
    }
  });

  $('#whisper-delete').addEventListener('click', async () => {
    const model = getSelectedWhisperModel();
    if (!model || !window.confirm(`Delete the ${model.id} model (${formatBytes(model.bytes)}) from this computer?`)) return;
    try {
      await ghostPilot.whisperModelDelete(model.id);
      $('#whisper-status').textContent = `${model.id} deleted.`;
    } catch (error) {
      $('#whisper-status').textContent = `Delete failed: ${error.message}`;
    } finally {
      await refreshWhisperModels();
    }
  });

  ghostPilot.on('whisper:download-progress', (progress) => {
    if (!whisperOverview) return;
    const model = whisperOverview.models.find((candidate) => candidate.id === progress.modelId);
    if (!model) return;
    model.partialBytes = progress.receivedBytes;
    model.downloading = true;
    if ($('#whisper-model').value === progress.modelId) {
      $('#whisper-progress-wrap').classList.remove('hidden');
      $('#whisper-progress').value = progress.percent;
      $('#whisper-progress-label').textContent = `${progress.percent}%`;
      $('#whisper-model-detail').textContent = `${formatBytes(progress.receivedBytes)} of ${formatBytes(progress.totalBytes)}`;
    }
  });
  ghostPilot.on('whisper:models-changed', () => refreshWhisperModels());

  async function saveSettings() {

    settings.apiKeys.openai = $('#key-openai').value.trim();
    settings.apiKeys.anthropic = $('#key-anthropic').value.trim();
    settings.apiKeys.gemini = $('#key-gemini').value.trim();
    settings.apiKeys.deepgram = $('#key-deepgram').value.trim();
    settings.apiKeys.custom = $('#key-custom').value.trim();
    settings.baseUrl = $('#base-url').value.trim();
    settings.apiKeys.ollama = $('#key-ollama').value.trim();
    settings.apiKeys.groq = $('#key-groq').value.trim();
    settings.apiKeys.minimax = $('#key-minimax').value.trim();
    settings.apiKeys.azure = $('#key-azure').value.trim();
    settings.azureEndpoint = $('#azure-endpoint').value.trim();
    if (!settings.models[settings.provider]) settings.models[settings.provider] = {};
    settings.models[settings.provider].fast = $('#model-fast').value.trim();
    settings.models[settings.provider].smart = $('#model-smart').value.trim();
    settings.geminiSttModel = $('#gemini-stt-model').value;

    if (!settings.localWhisper) settings.localWhisper = {};
    settings.localWhisper.modelId = $('#whisper-model').value || settings.localWhisper.modelId || 'base.en';
    settings.localWhisper.language = $('#whisper-language').value || 'auto';
    settings.localWhisper.threads = Math.max(0, Math.min(64, Number.parseInt($('#whisper-threads').value, 10) || 0));

    settings.workMode = currentWorkMode();
    settings.profileText = $('#profile-text').value.trim();
    settings.meetingTitle = $('#meeting-title').value.trim();
    settings.meetingGoal = $('#meeting-goal').value.trim();
    settings.meetingContext = $('#meeting-context').value.trim();
    settings.meetingRole = $('#meeting-role').value.trim();
    settings.resumeText = $('#resume-text').value.trim();
    settings.jobDescription = $('#job-description').value.trim();

    settings.starStories = $('#star-stories').value.trim();
    settings.whyCompany = $('#why-company').value.trim();
    settings.whyLeaving = $('#why-leaving').value.trim();
    settings.workStyle = $('#work-style').value.trim();

    settings.aiRules = $('#ai-rules').value.trim();

    settings.salaryTarget = $('#salary-target').value.trim();
    settings.questionsToAsk = $('#questions-to-ask').value.trim();
    try {
      settings = await ghostPilot.settingsSet(settings);
      $('#s-status').textContent = statusText();
      updatePrepStatus();
      updateSmartTooltip();
      return true;
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      $('#s-status').textContent = message;
      $('#base-url').focus();
      return false;
    }
  }

  function showExample() {
    clearMessages();
    addUserBubble(currentWorkMode() === 'meeting' ? 'Brief me' : 'What should I say?');
    const ai = document.createElement('div');
    ai.className = 'ai-text';
    ai.textContent = currentWorkMode() === 'meeting'
      ? 'Start listening, then use Brief me for a concise explanation of the latest discussion, Draft response for words you can say, or Questions for unresolved points.'
      : 'Start listening, then use What should I say? for a direct answer, Assist for transcript and screen-aware help, or Follow-up for questions to ask.';
    messages.appendChild(ai);
  }

  function keepFocusInDialog(e, dialog) {
    if (e.key !== 'Tab' || !dialog) return;
    const focusable = [...dialog.querySelectorAll('button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])')]
      .filter((element) => element.offsetParent !== null);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  const quitScrim = $('#quit-confirm-scrim');
  let focusBeforeQuit = null;
  function showQuitConfirmation() {
    focusBeforeQuit = document.activeElement;
    $('#quit-confirm-body').textContent = captureActive
      ? 'Listening is active. GhostPilot will stop and save the meeting before it closes.'
      : 'GhostPilot will close. Saved meetings and settings will remain on this device.';
    $('#quit-confirm-button').textContent = captureActive ? 'Stop, save, and quit' : 'Quit GhostPilot';
    quitScrim.classList.remove('hidden');
    $('#quit-cancel').focus();
  }
  function hideQuitConfirmation() {
    quitScrim.classList.add('hidden');
    if (focusBeforeQuit && typeof focusBeforeQuit.focus === 'function') focusBeforeQuit.focus();
    focusBeforeQuit = null;
  }
  $('#quit-btn').addEventListener('click', showQuitConfirmation);
  $('#quit-cancel').addEventListener('click', hideQuitConfirmation);
  $('#quit-confirm-button').addEventListener('click', async () => {
    const confirmButton = $('#quit-confirm-button');
    confirmButton.disabled = true;
    $('#quit-cancel').disabled = true;
    if (captureActive) {
      $('#quit-confirm-body').textContent = 'Stopping and saving the meeting...';
      await ghostPilot.captureToggle();
      const capture = await ghostPilot.captureState();
      if (capture.active) {
        $('#quit-confirm-body').textContent = 'GhostPilot could not stop the active meeting. Use Stop and save, then try again.';
        confirmButton.disabled = false;
        $('#quit-cancel').disabled = false;
        return;
      }
    }
    await ghostPilot.quit();
  });
  ghostPilot.on('quit:request', showQuitConfirmation);

  document.addEventListener('keydown', (e) => {
    const activeDialog = !quitScrim.classList.contains('hidden')
      ? $('#quit-confirm')
      : (!obScrim.classList.contains('hidden') ? $('#onboard') : (!scrim.classList.contains('hidden') ? $('#settings') : null));
    keepFocusInDialog(e, activeDialog);
    if (e.key === 'Escape' && !quitScrim.classList.contains('hidden')) { e.preventDefault(); hideQuitConfirmation(); }
    else if (e.key === 'Escape' && !obScrim.classList.contains('hidden')) { e.preventDefault(); finishOnboard(); }
    else if (e.key === 'Escape' && !scrim.classList.contains('hidden')) closeSettings();
    if ((e.metaKey || e.ctrlKey) && e.key === ',') { e.preventDefault(); openSettings(); }
  });

  const interactiveRegionSelectors = [
    '#toolbar',
    '#panel-wrap',
    '#transcript-sidebar',
    '#settings-scrim',
    '#onboard-scrim',
    '#quit-confirm-scrim',
    '.resize-zone'
  ];
  let regionUpdateFrame = null;
  function publishInteractiveRegions() {
    regionUpdateFrame = null;
    const regions = interactiveRegionSelectors.flatMap((selector) => [...document.querySelectorAll(selector)])
      .filter((element) => {
        const style = getComputedStyle(element);
        return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0;
      })
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      });
    ghostPilot.setInteractiveRegions(regions);
  }
  function scheduleInteractiveRegionUpdate() {
    if (regionUpdateFrame !== null) return;
    regionUpdateFrame = requestAnimationFrame(publishInteractiveRegions);
  }
  new ResizeObserver(scheduleInteractiveRegionUpdate).observe(document.documentElement);
  new MutationObserver(scheduleInteractiveRegionUpdate).observe(document.body, {
    attributes: true,
    attributeFilter: ['class', 'style'],
    subtree: true
  });
  scheduleInteractiveRegionUpdate();

  const dragPill = document.querySelector('.drag-pill');
  if (dragPill) {
    const endMove = (event) => {
      if (event && dragPill.hasPointerCapture(event.pointerId)) dragPill.releasePointerCapture(event.pointerId);
      dragPill.classList.remove('dragging');
      ghostPilot.moveEnd(event ? { screenX: event.screenX, screenY: event.screenY } : null);
    };
    dragPill.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      dragPill.setPointerCapture(event.pointerId);
      dragPill.classList.add('dragging');
      ghostPilot.moveStart({ screenX: event.screenX, screenY: event.screenY });
    });
    dragPill.addEventListener('pointermove', (event) => {
      if (!dragPill.hasPointerCapture(event.pointerId)) return;
      ghostPilot.moveTo({ screenX: event.screenX, screenY: event.screenY });
    });
    dragPill.addEventListener('pointerup', endMove);
    dragPill.addEventListener('pointercancel', endMove);
  }

  document.querySelectorAll('.resize-zone').forEach((resizeZone) => {
    const endResize = (event) => {
      if (event && resizeZone.hasPointerCapture(event.pointerId)) resizeZone.releasePointerCapture(event.pointerId);
      ghostPilot.resizeEnd(event ? { screenX: event.screenX, screenY: event.screenY } : null);
    };
    resizeZone.addEventListener('pointerdown', (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      resizeZone.setPointerCapture(event.pointerId);
      ghostPilot.resizeStart({ screenX: event.screenX, screenY: event.screenY }, resizeZone.dataset.resizeEdge);
    });
    resizeZone.addEventListener('pointermove', (event) => {
      if (!resizeZone.hasPointerCapture(event.pointerId)) return;
      ghostPilot.resizeTo({ screenX: event.screenX, screenY: event.screenY });
    });
    resizeZone.addEventListener('pointerup', endResize);
    resizeZone.addEventListener('pointercancel', endResize);
  });

  const obScrim = $('#onboard-scrim');
  const permissionHelp = isWindows
    ? 'Windows uses one microphone switch for desktop apps. Turn on <strong>Microphone access</strong> and <strong>Allow desktop apps to access your microphone</strong>. GhostPilot will not appear as a separate toggle. Screen capture works automatically on Windows.'
    : 'GhostPilot needs two macOS permissions. Click each button, turn <strong>GhostPilot</strong> ON in the window that opens, then come back here.';
  const permissionButtons = isWindows
    ? [
        { label: 'Open microphone settings', action: () => ghostPilot.openPane('ms-settings:privacy-microphone') },
        { label: 'Check access', action: checkPermissionAccess }
      ]
    : [
        { label: 'Open Microphone settings', action: () => ghostPilot.openPane('x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone') },
        { label: 'Open Screen Recording settings', action: () => ghostPilot.openPane('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture') },
        { label: 'Check access', action: checkPermissionAccess }
      ];
  const assistShortcut = isWindows ? '<span class="kbd">Ctrl</span> <span class="kbd">↵</span>' : '<span class="kbd">⌘</span> <span class="kbd">↵</span>';
  const solveShortcut = isWindows ? '<span class="kbd">Ctrl</span> <span class="kbd">H</span>' : '<span class="kbd">⌘</span> <span class="kbd">H</span>';
  const quitShortcut = isWindows ? '<span class="kbd">Ctrl</span><span class="kbd">⇧</span><span class="kbd">X</span>' : '<span class="kbd">⌘</span><span class="kbd">⇧</span><span class="kbd">X</span>';
  const OB_STEPS = [
    {
      icon: 'logo',
      title: 'Welcome to GhostPilot',
      body: 'A private AI copilot for live conversations and coding. GhostPilot can use your screen and meeting audio to help in real time, while staying hidden from most screen shares.<br><br>This guide gets the essentials ready in about a minute.'
    },
    {
      icon: 'shield-check',
      title: isWindows ? 'Enable microphone access' : 'Allow screen and microphone access',
      body: permissionHelp + '<div id="ob-permission-status" class="ob-status" role="status" aria-live="polite">Check access after changing your system settings.</div>',
      buttons: permissionButtons
    },
    {
      icon: 'key-round',
      title: 'Connect an AI provider',
      body: 'GhostPilot uses your own provider key. Choose <span class="hl">OpenAI</span>, <span class="hl">Anthropic</span>, <span class="hl">Google Gemini</span>, or <span class="hl">Azure AI Foundry</span>, then paste the key into Settings.<br><br>For low-latency transcription, use Gemini Live, add a <span class="hl">Deepgram</span> key, or use a supported local Whisper model.',
      buttons: [{ label: 'Open GhostPilot Settings', action: () => { finishOnboard(); openSettings(); } }]
    },
    {
      icon: 'eye-off',
      title: 'Stay hidden in Zoom',
      body: 'GhostPilot is hidden from most screen shares automatically. <strong>Zoom needs one setting:</strong><br><br>Zoom → <span class="hl">Settings</span> → <span class="hl">Share Screen</span> → <span class="hl">Advanced</span> → <strong>Screen capture mode</strong> → choose <strong>“Advanced capture with window filtering.”</strong><br><br>Avoid the option without window filtering because it can reveal GhostPilot.'
    },
    {
      icon: 'circle-check',
      title: 'Ready when you are',
      body: '<ul><li>' + assistShortcut + ' opens <strong>Assist</strong> for the current screen or conversation</li><li>' + solveShortcut + ' solves a coding problem on screen</li><li>Use the square control in the top bar to start or stop listening</li><li>Type a question and press <span class="kbd">↵</span></li></ul>Open this guide from the GhostPilot mark. Quit anytime with ' + quitShortcut + '.'
    }
  ];

  async function checkPermissionAccess() {
    const statusEl = $('#ob-permission-status');
    if (!statusEl) return;
    statusEl.textContent = 'Checking access…';
    try {
      const status = await ghostPilot.permissionsCheck();
      const ready = status.mic === 'granted' && status.screen === 'granted';
      statusEl.textContent = ready
        ? 'Access is ready.'
        : (isWindows ? 'Microphone access is still blocked for desktop apps.' : 'One or more permissions are still blocked.');
      statusEl.classList.toggle('ready', ready);
    } catch (_) {
      statusEl.textContent = 'GhostPilot could not check access. Open system settings and try again.';
      statusEl.classList.remove('ready');
    }
  }
  let obIndex = 0;
  function renderOnboard() {
    const step = OB_STEPS[obIndex];
    $('#ob-icon').innerHTML = icon(step.icon, { size: 30 });
    $('#ob-title').textContent = step.title;
    $('#ob-body').innerHTML = step.body;
    const btns = $('#ob-buttons'); btns.innerHTML = '';
    (step.buttons || []).forEach((b) => { const el = document.createElement('button'); el.textContent = b.label; el.addEventListener('click', b.action); btns.appendChild(el); });
    const dots = $('#ob-dots'); dots.innerHTML = '';
    OB_STEPS.forEach((_, i) => { const d = document.createElement('span'); if (i === obIndex) d.className = 'on'; dots.appendChild(d); });
    $('#ob-progress').textContent = `SETUP ${obIndex + 1} OF ${OB_STEPS.length}`;
    $('#ob-back').style.visibility = obIndex === 0 ? 'hidden' : 'visible';
    $('#ob-next').textContent = obIndex === OB_STEPS.length - 1 ? 'Done' : 'Next';
    $('#ob-skip').style.visibility = obIndex === OB_STEPS.length - 1 ? 'hidden' : 'visible';
  }
  function showOnboard() { obIndex = 0; renderOnboard(); obScrim.classList.remove('hidden'); $('#ob-close').focus(); }
  async function finishOnboard() {
    obScrim.classList.add('hidden');
    if (settings && !settings.onboarded) { settings.onboarded = true; await ghostPilot.settingsSet({ onboarded: true }); }
    $('#logo-btn').focus();
  }
  $('#ob-next').addEventListener('click', () => { if (obIndex === OB_STEPS.length - 1) finishOnboard(); else { obIndex++; renderOnboard(); } });
  $('#ob-back').addEventListener('click', () => { if (obIndex > 0) { obIndex--; renderOnboard(); } });
  $('#ob-close').addEventListener('click', finishOnboard);
  $('#ob-quit').addEventListener('click', showQuitConfirmation);
  $('#ob-skip').addEventListener('click', finishOnboard);
  $('#logo-btn').addEventListener('click', showOnboard);

  (async function boot() {
    settings = await ghostPilot.settingsGet();

    const sayHintEl = document.getElementById('say-shortcut-hint');
    const assistHintEl = document.getElementById('assist-shortcut-hint');
    if (sayHintEl) sayHintEl.textContent = isWindows ? 'Ctrl+Shift+↵' : '⌘⇧↵';
    if (assistHintEl) assistHintEl.textContent = isWindows ? 'Ctrl+↵' : '⌘↵';

    renderWorkMode();

    updateSmartTooltip();

    smartBtn.classList.toggle('on', !!settings.smart);
    smartBtn.setAttribute('aria-pressed', String(!!settings.smart));
    showExample();
    syncPlaceholder();
    updateHistoryBadge();
    updateSendButtonState();

    renderSessionSnapshot(await ghostPilot.sessionGet());
    renderUpdateState(await ghostPilot.updateState());

    const st = await ghostPilot.captureState();
    captureActive = st.active;
    $('#live-dot').classList.toggle('off', !st.active);
    $('#stop-btn').classList.toggle('active', st.active);
    $('#stop-btn').setAttribute('aria-pressed', String(st.active));
    renderCaptureButton(st.active);
    updateNotesButton(st.active);
    if (!settings.onboarded) showOnboard();
  })();
})();
