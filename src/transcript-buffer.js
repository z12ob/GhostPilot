class TranscriptBuffer {
  constructor(maxCharacters = 1000000) {
    if (!Number.isInteger(maxCharacters) || maxCharacters < 1) {
      throw new TypeError('maxCharacters must be a positive integer');
    }
    this.maxCharacters = maxCharacters;
    this.turns = [];
    this.characters = 0;
  }

  get length() {
    return this.turns.length;
  }

  push(turn) {
    if (!turn || !String(turn.text || '').trim()) return;
    const text = String(turn.text).slice(-this.maxCharacters);
    const retained = { ...turn, text };

    this.turns.push(retained);
    this.characters += text.length;

    while (this.characters > this.maxCharacters && this.turns.length > 1) {
      this.characters -= this.turns.shift().text.length;
    }
  }

  snapshot() {
    return this.turns.map((turn) => ({ ...turn }));
  }

  clear() {
    this.turns.length = 0;
    this.characters = 0;
  }
}

module.exports = { TranscriptBuffer };
