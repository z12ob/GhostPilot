

class AdaptiveVAD {
  constructor(options = {}) {

    this.sampleRate = options.sampleRate || 16000;
    this.frameDurationMs = options.frameDurationMs || 30;
    this.frameSize = Math.floor(this.sampleRate * this.frameDurationMs / 1000);

    this.onsetThreshold = options.onsetThreshold || 250;
    this.offsetThreshold = options.offsetThreshold || 150;
    this.silenceFrames = options.silenceFrames || 15;
    this.minSpeechFrames = options.minSpeechFrames || 4;

    this.noiseFloor = 80;
    this.noiseAdaptRate = 0.02;
    this.noiseMaxAdapt = 400;

    this.state = 'silence';
    this.speechFrameCount = 0;
    this.silenceFrameCount = 0;
    this.totalSpeechFrames = 0;

    this.onSpeechStart = options.onSpeechStart || (() => {});
    this.onSpeechEnd = options.onSpeechEnd || (() => {});
    this.onVADState = options.onVADState || (() => {});
  }

  processChunk(pcmBuffer) {
    const samples = pcmBuffer.length / 2;
    let offset = 0;

    while (offset + this.frameSize * 2 <= pcmBuffer.length) {
      const frame = pcmBuffer.slice(offset, offset + this.frameSize * 2);
      const energy = this._computeRMS(frame);
      this._processFrame(energy);
      offset += this.frameSize * 2;
    }
  }

  _computeRMS(frame) {
    let sum = 0;
    const n = frame.length / 2;
    for (let i = 0; i < frame.length; i += 2) {
      const s = frame.readInt16LE(i);
      sum += s * s;
    }
    return Math.sqrt(sum / n);
  }

  _processFrame(energy) {

    if (this.state === 'silence') {
      if (energy < this.noiseMaxAdapt) {
        this.noiseFloor = this.noiseFloor * (1 - this.noiseAdaptRate) + energy * this.noiseAdaptRate;
      }
    }

    const dynamicOnset = Math.max(this.onsetThreshold, this.noiseFloor * 2.5);
    const dynamicOffset = Math.max(this.offsetThreshold, this.noiseFloor * 1.5);

    const isSpeech = energy > dynamicOnset;
    const isSilence = energy < dynamicOffset;

    switch (this.state) {
      case 'silence':
        if (isSpeech) {
          this.speechFrameCount = 1;
          this.state = 'speech';
          this.onSpeechStart();
          this.onVADState('speech');
        }
        break;

      case 'speech':
        if (isSpeech) {
          this.speechFrameCount++;
          this.totalSpeechFrames++;
        } else if (isSilence) {
          this.silenceFrameCount = 1;
          this.state = 'trailing';
        }
        break;

      case 'trailing':
        if (isSpeech) {

          this.silenceFrameCount = 0;
          this.speechFrameCount++;
          this.state = 'speech';
        } else {
          this.silenceFrameCount++;
          if (this.silenceFrameCount >= this.silenceFrames) {

            const wasSpeech = this.speechFrameCount >= this.minSpeechFrames;
            if (wasSpeech) {
              this.onSpeechEnd(this.speechFrameCount * this.frameDurationMs);
            }
            this.state = 'silence';
            this.speechFrameCount = 0;
            this.silenceFrameCount = 0;
            this.onVADState('silence');
          }
        }
        break;
    }
  }

  getState() {
    return {
      state: this.state,
      isSpeaking: this.state !== 'silence',
      noiseFloor: Math.round(this.noiseFloor),
      speechDurationMs: this.speechFrameCount * this.frameDurationMs
    };
  }

  reset() {
    this.state = 'silence';
    this.speechFrameCount = 0;
    this.silenceFrameCount = 0;
    this.totalSpeechFrames = 0;
    this.noiseFloor = 80;
  }
}

class AudioRingBuffer {
  constructor(durationMs, sampleRate = 16000) {
    this.capacity = Math.floor(sampleRate * 2 * durationMs / 1000);
    this.buffer = Buffer.alloc(this.capacity);
    this.writePos = 0;
    this.filled = false;
  }

  write(pcm) {
    if (pcm.length >= this.capacity) {
      pcm.copy(this.buffer, 0, pcm.length - this.capacity);
      this.writePos = 0;
      this.filled = true;
      return;
    }
    const space = this.capacity - this.writePos;
    if (pcm.length <= space) {
      pcm.copy(this.buffer, this.writePos);
      this.writePos += pcm.length;
    } else {
      pcm.copy(this.buffer, this.writePos, 0, space);
      pcm.copy(this.buffer, 0, space);
      this.writePos = pcm.length - space;
      this.filled = true;
    }
  }

  read() {
    if (!this.filled) return this.buffer.slice(0, this.writePos);
    return Buffer.concat([
      this.buffer.slice(this.writePos),
      this.buffer.slice(0, this.writePos)
    ]);
  }

  clear() {
    this.writePos = 0;
    this.filled = false;
  }
}

module.exports = { AdaptiveVAD, AudioRingBuffer };
