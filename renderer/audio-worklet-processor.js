

class GhostPilotAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._bufferSize = 4096;
    this._buffer = new Float32Array(this._bufferSize);
    this._writeIndex = 0;
  }

  process(inputs, _outputs, _parameters) {
    const input = inputs[0];
    if (!input || !input[0]) return true;

    const channelData = input[0];
    for (let i = 0; i < channelData.length; i++) {
      this._buffer[this._writeIndex++] = channelData[i];
      if (this._writeIndex >= this._bufferSize) {
        this._flush();
      }
    }
    return true;
  }

  _flush() {

    const pcm = new Int16Array(this._writeIndex);
    for (let i = 0; i < this._writeIndex; i++) {
      const s = Math.max(-1, Math.min(1, this._buffer[i]));
      pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
    }
    this.port.postMessage(pcm.buffer, [pcm.buffer]);
    this._buffer = new Float32Array(this._bufferSize);
    this._writeIndex = 0;
  }
}

registerProcessor('ghostpilot-audio-processor', GhostPilotAudioProcessor);
