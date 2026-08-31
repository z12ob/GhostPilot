const assert = require('node:assert/strict');
const test = require('node:test');

const {
  GEMINI_LIVE_TRANSCRIBE_MODEL,
  GeminiLiveTranscriptionSTT,
  createStreamingSTT
} = require('../src/stt-streaming');

test('Gemini uses its dedicated live transcription model', () => {
  assert.equal(GEMINI_LIVE_TRANSCRIBE_MODEL, 'gemini-3.5-transcribe-live');

  const selected = createStreamingSTT({
    sttProvider: 'gemini',
    apiKeys: { gemini: 'test-key' },
    geminiSttModel: GEMINI_LIVE_TRANSCRIBE_MODEL
  }, 'them', {
    onTranscript() {},
    onInterim() {},
    onError() {},
    onStatusChange() {}
  });

  assert.equal(selected.type, 'streaming');
  assert.equal(selected.provider, 'gemini-live');
  assert.ok(selected.instance instanceof GeminiLiveTranscriptionSTT);
  assert.equal(selected.instance.model, GEMINI_LIVE_TRANSCRIBE_MODEL);
});

test('Gemini live transcription sends 100 ms PCM chunks after setup', () => {
  const sent = [];
  const stt = new GeminiLiveTranscriptionSTT('test-key', {
    socketFactory: () => ({
      readyState: 1,
      send(message) { sent.push(JSON.parse(message)); }
    })
  });
  stt.ws = stt.socketFactory();
  stt.connected = true;
  stt.sessionReady = true;

  stt.sendAudio(Buffer.alloc(6400));

  assert.equal(sent.length, 2);
  assert.equal(sent[0].realtimeInput.audio.mimeType, 'audio/pcm;rate=16000');
  assert.equal(Buffer.from(sent[0].realtimeInput.audio.data, 'base64').length, 3200);
});

test('Gemini live transcription flushes a trailing partial chunk before stopping', () => {
  const sent = [];
  const stt = new GeminiLiveTranscriptionSTT('test-key', {
    socketFactory: () => ({
      readyState: 1,
      send(message) { sent.push(JSON.parse(message)); },
      close() {}
    })
  });
  stt.ws = stt.socketFactory();
  stt.connected = true;
  stt.sessionReady = true;

  stt.sendAudio(Buffer.alloc(1200));
  stt.disconnect();

  assert.equal(Buffer.from(sent[0].realtimeInput.audio.data, 'base64').length, 1200);
  assert.equal(sent[1].realtimeInput.audioStreamEnd, true);
});

test('Gemini live transcription exposes interim and finalized text separately', () => {
  const interim = [];
  const finalText = [];
  const stt = new GeminiLiveTranscriptionSTT('test-key', {
    onInterim: (text) => interim.push(text),
    onTranscript: (text) => finalText.push(text)
  });

  stt._handleMessage({
    serverContent: {
      interimInputTranscription: { text: 'partial words' }
    }
  });
  stt._handleMessage({
    serverContent: {
      inputTranscription: { text: 'Final words.' }
    }
  });

  assert.deepEqual(interim, ['partial words', '']);
  assert.deepEqual(finalText, ['Final words.']);
});

test('Gemini live setup requests verbatim automatic-language transcription', () => {
  const sent = [];
  const handlers = {};
  const socket = {
    readyState: 1,
    on(event, handler) { handlers[event] = handler; },
    send(message) { sent.push(JSON.parse(message)); },
    close() {}
  };
  const stt = new GeminiLiveTranscriptionSTT('test-key', {
    settings: {},
    socketFactory: () => socket
  });

  stt.connect();
  handlers.open();

  assert.equal(sent[0].setup.model, 'models/gemini-3.5-transcribe-live');
  assert.deepEqual(sent[0].setup.generationConfig.responseModalities, ['TEXT']);
  assert.deepEqual(sent[0].setup.inputAudioTranscription.languageCodes, []);
  assert.equal(sent[0].setup.inputAudioTranscription.mode, 'VERBATIM');
  stt.disconnect();
});
