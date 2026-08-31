

const { looksLikeHallucination, buildVocabPrompt } = require('./stt');
const { pcmToWav } = require('./wav');
const { CURRENT_GEMINI_DEFAULT } = require('./llm');

const GEMINI_LIVE_TRANSCRIBE_MODEL = 'gemini-3.5-transcribe-live';
const GEMINI_LIVE_URL = 'wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent';
const PCM_100_MS_BYTES = 16000 * 2 / 10;
const GEMINI_SESSION_ROTATION_MS = 9 * 60 * 1000;

class GeminiLiveTranscriptionSTT {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.model = options.model || GEMINI_LIVE_TRANSCRIBE_MODEL;
    this.settings = options.settings || {};
    this.onTranscript = options.onTranscript || (() => {});
    this.onInterim = options.onInterim || (() => {});
    this.onError = options.onError || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this.socketFactory = options.socketFactory || ((url) => {
      const WebSocket = require('ws');
      return new WebSocket(url);
    });
    this.ws = null;
    this.connected = false;
    this.sessionReady = false;
    this.running = false;
    this.audioBuffer = Buffer.alloc(0);
    this.pendingChunks = [];
    this.reconnectAttempts = 0;
    this.reconnectTimer = null;
    this.rotationTimer = null;
    this.setupTimer = null;
  }

  connect() {
    if (this.running && this.ws) return;
    this.running = true;
    this._openSocket();
  }

  _openSocket() {
    if (!this.running) return;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.rotationTimer);
    clearTimeout(this.setupTimer);
    this.connected = false;
    this.sessionReady = false;
    this.onStatusChange('connecting');

    const url = `${GEMINI_LIVE_URL}?key=${encodeURIComponent(this.apiKey)}`;
    const socket = this.socketFactory(url);
    this.ws = socket;
    this.setupTimer = setTimeout(() => {
      if (socket !== this.ws || this.sessionReady) return;
      this.onError({ provider: 'gemini-live', message: 'Gemini Live setup timed out.', status: null, recoverable: true });
      if (typeof socket.terminate === 'function') socket.terminate();
      else socket.close();
    }, 10000);

    socket.on('open', () => {
      if (socket !== this.ws || !this.running) return;
      this.connected = true;
      this._send({
        setup: {
          model: `models/${this.model}`,
          generationConfig: { responseModalities: ['TEXT'] },
          inputAudioTranscription: {
            languageCodes: [],
            customVocabulary: buildVocabPrompt(this.settings).split(',').map((term) => term.trim()).filter(Boolean).slice(0, 100),
            mode: 'VERBATIM'
          }
        }
      });
    });

    socket.on('message', (data) => {
      if (socket !== this.ws) return;
      try {
        this._handleMessage(JSON.parse(data.toString()));
      } catch (error) {
        this.onError({ provider: 'gemini-live', message: `Invalid Gemini Live response: ${error.message}`, status: null, recoverable: true });
      }
    });

    socket.on('error', (error) => {
      if (socket !== this.ws) return;
      this.onError({ provider: 'gemini-live', message: error.message, status: null, recoverable: true });
    });

    socket.on('close', (code, reason) => {
      if (socket !== this.ws) return;
      this.ws = null;
      this.connected = false;
      this.sessionReady = false;
      clearTimeout(this.setupTimer);
      clearTimeout(this.rotationTimer);
      if (!this.running) {
        this.onStatusChange('disconnected');
        return;
      }
      if (code !== 1000 && reason) {
        this.onError({ provider: 'gemini-live', message: reason.toString(), status: code, recoverable: true });
      }
      this._scheduleReconnect();
    });
  }

  _handleMessage(message) {
    if (message.setupComplete) {
      clearTimeout(this.setupTimer);
      this.sessionReady = true;
      this.reconnectAttempts = 0;
      this.onStatusChange('connected');
      this._flushPending();
      this.rotationTimer = setTimeout(() => this._rotateSession(), GEMINI_SESSION_ROTATION_MS);
      return;
    }

    if (message.error) {
      this.onError({
        provider: 'gemini-live',
        message: message.error.message || 'Gemini Live transcription failed.',
        status: message.error.code || null
      });
      return;
    }

    const content = message.serverContent;
    const interim = content?.interimInputTranscription?.text;
    const finalText = content?.inputTranscription?.text;
    if (interim) this.onInterim(interim);
    if (finalText && !looksLikeHallucination(finalText)) {
      this.onTranscript(finalText.trim());
      this.onInterim('');
    }
  }

  sendAudio(pcmBuffer) {
    if (!pcmBuffer || pcmBuffer.length === 0) return;
    this.audioBuffer = Buffer.concat([this.audioBuffer, Buffer.from(pcmBuffer)]);
    while (this.audioBuffer.length >= PCM_100_MS_BYTES) {
      const chunk = this.audioBuffer.subarray(0, PCM_100_MS_BYTES);
      this.audioBuffer = this.audioBuffer.subarray(PCM_100_MS_BYTES);
      if (this.connected && this.sessionReady) this._sendAudioChunk(chunk);
      else {
        this.pendingChunks.push(Buffer.from(chunk));
        if (this.pendingChunks.length > 50) this.pendingChunks.shift();
      }
    }
  }

  _sendAudioChunk(chunk) {
    this._send({
      realtimeInput: {
        audio: {
          data: chunk.toString('base64'),
          mimeType: 'audio/pcm;rate=16000'
        }
      }
    });
  }

  _flushPending() {
    while (this.pendingChunks.length && this.connected && this.sessionReady) {
      this._sendAudioChunk(this.pendingChunks.shift());
    }
  }

  _flushTrailingAudio() {
    if (!this.audioBuffer.length || !this.connected || !this.sessionReady) return;
    this._sendAudioChunk(this.audioBuffer);
    this.audioBuffer = Buffer.alloc(0);
  }

  _rotateSession() {
    if (!this.running || !this.ws) return;
    this._flushTrailingAudio();
    this.sessionReady = false;
    this.onStatusChange('reconnecting');
    this._send({ realtimeInput: { audioStreamEnd: true } });
    const socket = this.ws;
    setTimeout(() => {
      if (socket !== this.ws) return;
      socket.close(1000, 'Scheduled session rotation');
      setTimeout(() => {
        if (socket === this.ws && typeof socket.terminate === 'function') socket.terminate();
      }, 1500);
    }, 750);
  }

  _scheduleReconnect() {
    if (!this.running || this.reconnectTimer) return;
    const delay = Math.min(1000 * (2 ** this.reconnectAttempts), 16000);
    this.reconnectAttempts += 1;
    this.onStatusChange('reconnecting');
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this._openSocket();
    }, delay);
  }

  _send(message) {
    if (this.ws && this.ws.readyState === 1) this.ws.send(JSON.stringify(message));
  }

  disconnect() {
    this.running = false;
    clearTimeout(this.reconnectTimer);
    clearTimeout(this.rotationTimer);
    clearTimeout(this.setupTimer);
    this.reconnectTimer = null;
    this.rotationTimer = null;
    if (this.ws && this.ws.readyState === 1) {
      this._flushTrailingAudio();
      this._send({ realtimeInput: { audioStreamEnd: true } });
      this.ws.close(1000, 'Capture stopped');
    }
    this.ws = null;
    this.connected = false;
    this.sessionReady = false;
    this.audioBuffer = Buffer.alloc(0);
    this.pendingChunks = [];
    this.onStatusChange('disconnected');
  }
}

class OpenAIRealtimeSTT {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.model = options.model || 'gpt-realtime-whisper';
    this.ws = null;
    this.connected = false;
    this.reconnecting = false;
    this.onTranscript = options.onTranscript || (() => {});
    this.onInterim = options.onInterim || (() => {});
    this.onError = options.onError || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
    this._reconnectDelay = 1000;
    this._pendingAudio = [];
    this._sessionReady = false;
  }

  async connect() {
    if (this.ws && this.connected) return;

    try {
      const WebSocket = require('ws');

      const url = 'wss://api.openai.com/v1/realtime?intent=transcription';

      this.ws = new WebSocket(url, {
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        }
      });

      this.ws.on('open', () => {
        this.connected = true;
        this._reconnectAttempts = 0;
        this.onStatusChange('connected');

        this._sendEvent({
          type: 'session.update',
          session: {
            type: 'transcription',
            audio: {
              input: {
                format: { type: 'audio/pcm', rate: 24000 },
                transcription: {
                  model: this.model,
                  language: 'en'
                }
              }
            }
          }
        });
      });

      this.ws.on('message', (data) => {
        try {
          const event = JSON.parse(data.toString());
          this._handleEvent(event);
        } catch (e) {

        }
      });

      this.ws.on('close', (code) => {
        this.connected = false;
        this._sessionReady = false;
        this.onStatusChange('disconnected');
        if (code !== 1000 && !this.reconnecting) {
          this._attemptReconnect();
        }
      });

      this.ws.on('error', (err) => {
        this.onError({ provider: 'openai-realtime', message: err.message, status: null });
      });

    } catch (e) {
      this.onError({ provider: 'openai-realtime', message: e.message, status: null });
    }
  }

  _handleEvent(event) {
    switch (event.type) {
      case 'session.created':
      case 'session.updated':
        this._sessionReady = true;
        this._flushPendingAudio();
        break;

      case 'conversation.item.input_audio_transcription.delta':
        if (event.delta) {
          this.onInterim(event.delta);
        }
        break;

      case 'conversation.item.input_audio_transcription.completed':
        if (event.transcript && event.transcript.trim()) {
          this.onTranscript(event.transcript.trim());
        }
        break;

      case 'input_audio_buffer.speech_started':
        break;

      case 'input_audio_buffer.speech_stopped':
        break;

      case 'input_audio_buffer.committed':
        break;

      case 'error':
        this.onError({
          provider: 'openai-realtime',
          message: event.error?.message || 'Unknown realtime error',
          status: event.error?.code
        });
        break;
    }
  }

  sendAudio(pcmBuffer) {
    if (!this.connected || !this._sessionReady) {

      this._pendingAudio.push(pcmBuffer);
      if (this._pendingAudio.length > 80) this._pendingAudio.shift();
      return;
    }

    const resampled = this._resample16to24(Buffer.from(pcmBuffer));
    const b64 = resampled.toString('base64');
    this._sendEvent({
      type: 'input_audio_buffer.append',
      audio: b64
    });
  }

  _resample16to24(pcm16kHz) {

    const srcSamples = pcm16kHz.length / 2;
    const dstSamples = Math.floor(srcSamples * 24000 / 16000);
    const out = Buffer.alloc(dstSamples * 2);
    for (let i = 0; i < dstSamples; i++) {
      const srcPos = i * 16000 / 24000;
      const idx = Math.floor(srcPos);
      const frac = srcPos - idx;
      const s0 = idx < srcSamples ? pcm16kHz.readInt16LE(idx * 2) : 0;
      const s1 = (idx + 1) < srcSamples ? pcm16kHz.readInt16LE((idx + 1) * 2) : s0;
      const sample = Math.round(s0 + (s1 - s0) * frac);
      out.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), i * 2);
    }
    return out;
  }

  _flushPendingAudio() {
    while (this._pendingAudio.length > 0) {
      const chunk = this._pendingAudio.shift();
      const resampled = this._resample16to24(Buffer.from(chunk));
      const b64 = resampled.toString('base64');
      this._sendEvent({
        type: 'input_audio_buffer.append',
        audio: b64
      });
    }
  }

  _sendEvent(event) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(JSON.stringify(event));
    }
  }

  _attemptReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      this.onError({ provider: 'openai-realtime', message: 'Max reconnection attempts reached', status: null });
      return;
    }
    this.reconnecting = true;
    this._reconnectAttempts++;
    const delay = this._reconnectDelay * Math.pow(2, this._reconnectAttempts - 1);
    setTimeout(() => {
      this.reconnecting = false;
      this.connect();
    }, Math.min(delay, 16000));
  }

  disconnect() {
    this._sessionReady = false;
    this._pendingAudio = [];
    if (this.ws) {
      this.ws.close(1000);
      this.ws = null;
    }
    this.connected = false;
  }
}

class DeepgramStreamingSTT {
  constructor(apiKey, options = {}) {
    this.apiKey = apiKey;
    this.model = options.model || 'nova-3';
    this.ws = null;
    this.connected = false;
    this.onTranscript = options.onTranscript || (() => {});
    this.onInterim = options.onInterim || (() => {});
    this.onError = options.onError || (() => {});
    this.onStatusChange = options.onStatusChange || (() => {});
    this._reconnectAttempts = 0;
    this._maxReconnectAttempts = 5;
    this._reconnectDelay = 1000;
    this._keepAliveInterval = null;
    this._committed = '';
  }

  async connect() {
    if (this.ws && this.connected) return;

    try {
      const WebSocket = require('ws');
      const params = new URLSearchParams({
        model: this.model,
        language: 'en',
        smart_format: 'true',
        interim_results: 'true',
        utterance_end_ms: '1000',
        vad_events: 'true',
        encoding: 'linear16',
        sample_rate: '16000',
        channels: '1',
        endpointing: '300',
        punctuate: 'true'
      });

      const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

      this.ws = new WebSocket(url, {
        headers: { 'Authorization': `Token ${this.apiKey}` }
      });

      this.ws.on('open', () => {
        this.connected = true;
        this._reconnectAttempts = 0;
        this.onStatusChange('connected');

        this._keepAliveInterval = setInterval(() => {
          if (this.ws && this.ws.readyState === 1) {
            this.ws.send(JSON.stringify({ type: 'KeepAlive' }));
          }
        }, 3000);
      });

      this.ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString());
          this._handleMessage(msg);
        } catch (e) {  }
      });

      this.ws.on('close', (code) => {
        this.connected = false;
        this._clearKeepAlive();
        this.onStatusChange('disconnected');
        if (code !== 1000) this._attemptReconnect();
      });

      this.ws.on('error', (err) => {
        this.onError({ provider: 'deepgram', message: err.message, status: null });
      });

    } catch (e) {
      this.onError({ provider: 'deepgram', message: e.message, status: null });
    }
  }

  _handleMessage(msg) {
    if (msg.type === 'Results') {
      const alt = msg.channel?.alternatives?.[0];
      if (!alt) return;
      const text = (alt.transcript || '').trim();

      if (msg.speech_final) {
        const full = ((this._committed || '') + ' ' + text).trim();
        this._committed = '';
        if (full && !looksLikeHallucination(full)) this.onTranscript(full);
        this.onInterim('');
        return;
      }
      if (!text) return;
      if (msg.is_final) {
        this._committed = ((this._committed || '') + ' ' + text).trim();
        this.onInterim(this._committed);
      } else {
        this.onInterim(((this._committed || '') + ' ' + text).trim());
      }
    } else if (msg.type === 'UtteranceEnd') {

      this._flushCommitted();
    } else if (msg.type === 'Error') {
      this.onError({ provider: 'deepgram', message: msg.description || msg.message, status: msg.variant });
    }
  }

  _flushCommitted() {
    const full = (this._committed || '').trim();
    this._committed = '';
    if (full && !looksLikeHallucination(full)) this.onTranscript(full);
    this.onInterim('');
  }

  sendAudio(pcmBuffer) {
    if (this.ws && this.ws.readyState === 1) {
      this.ws.send(Buffer.from(pcmBuffer));
    }
  }

  _clearKeepAlive() {
    if (this._keepAliveInterval) { clearInterval(this._keepAliveInterval); this._keepAliveInterval = null; }
  }

  _attemptReconnect() {
    if (this._reconnectAttempts >= this._maxReconnectAttempts) {
      this.onError({ provider: 'deepgram', message: 'Max reconnection attempts reached', status: null });
      return;
    }
    this._reconnectAttempts++;
    const delay = this._reconnectDelay * Math.pow(2, this._reconnectAttempts - 1);
    setTimeout(() => this.connect(), Math.min(delay, 16000));
  }

  disconnect() {
    this._flushCommitted();
    this._clearKeepAlive();
    if (this.ws) {

      try { this.ws.send(JSON.stringify({ type: 'CloseStream' })); } catch (e) {  }
      this.ws.close(1000);
      this.ws = null;
    }
    this.connected = false;
  }
}

async function transcribeBatchOpenAI(apiKey, wav, model) {
  const OpenAI = require('openai');
  const toFile = OpenAI.toFile || require('openai/uploads').toFile;
  const client = new OpenAI({ apiKey });
  const file = await toFile(wav, 'audio.wav', { type: 'audio/wav' });
  const res = await client.audio.transcriptions.create({
    file,
    model: model || 'whisper-1',
    response_format: 'text',
    language: 'en'
  });
  return (typeof res === 'string' ? res : res.text || '').trim();
}

async function transcribeBatchGemini(apiKey, wav) {
  const { GoogleGenAI } = require('@google/genai');
  const ai = new GoogleGenAI({ apiKey });
  const res = await ai.models.generateContent({
    model: CURRENT_GEMINI_DEFAULT,
    contents: [{ role: 'user', parts: [
      { text: 'Transcribe this audio verbatim. Return only the spoken words with no commentary. If there is no clear speech, return an empty response.' },
      { inlineData: { mimeType: 'audio/wav', data: wav.toString('base64') } }
    ] }]
  });
  return ((res && res.text) || '').trim();
}

function createStreamingSTT(settings, channel, callbacks) {
  const keys = settings.apiKeys || {};
  const selectedProvider = settings.sttProvider || 'auto';
  const { onTranscript, onInterim, onError, onStatusChange } = callbacks;

  if (selectedProvider === 'local') {
    return { type: 'batch', provider: selectedProvider, instance: null };
  }

  if (selectedProvider === 'gemini' && keys.gemini) {
    const stt = new GeminiLiveTranscriptionSTT(keys.gemini, {
      model: settings.geminiSttModel || GEMINI_LIVE_TRANSCRIBE_MODEL,
      settings,
      onTranscript: (text) => onTranscript(channel, text),
      onInterim: (text) => onInterim(channel, text),
      onError,
      onStatusChange: (status) => onStatusChange(channel, status)
    });
    return { type: 'streaming', provider: 'gemini-live', instance: stt };
  }

  if ((selectedProvider === 'auto' || selectedProvider === 'deepgram') && keys.deepgram) {
    const stt = new DeepgramStreamingSTT(keys.deepgram, {
      model: 'nova-3',
      onTranscript: (text) => onTranscript(channel, text),
      onInterim: (text) => onInterim(channel, text),
      onError,
      onStatusChange: (status) => onStatusChange(channel, status)
    });
    return { type: 'streaming', provider: 'deepgram', instance: stt };
  }

  if ((selectedProvider === 'auto' || selectedProvider === 'openai') && keys.openai) {
    const stt = new OpenAIRealtimeSTT(keys.openai, {
      model: 'gpt-realtime-whisper',
      onTranscript: (text) => onTranscript(channel, text),
      onInterim: (text) => onInterim(channel, text),
      onError,
      onStatusChange: (status) => onStatusChange(channel, status)
    });
    return { type: 'streaming', provider: 'openai-realtime', instance: stt };
  }

  if (selectedProvider === 'auto' && keys.gemini) {
    const stt = new GeminiLiveTranscriptionSTT(keys.gemini, {
      model: settings.geminiSttModel || GEMINI_LIVE_TRANSCRIBE_MODEL,
      settings,
      onTranscript: (text) => onTranscript(channel, text),
      onInterim: (text) => onInterim(channel, text),
      onError,
      onStatusChange: (status) => onStatusChange(channel, status)
    });
    return { type: 'streaming', provider: 'gemini-live', instance: stt };
  }

  return {
    type: 'batch',
    provider: selectedProvider === 'auto' && keys.gemini ? 'gemini' : 'none',
    instance: null
  };
}

module.exports = {
  GEMINI_LIVE_TRANSCRIBE_MODEL,
  GeminiLiveTranscriptionSTT,
  OpenAIRealtimeSTT,
  DeepgramStreamingSTT,
  createStreamingSTT,
  transcribeBatchOpenAI,
  transcribeBatchGemini
};
