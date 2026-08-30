const assert = require('node:assert/strict');
const test = require('node:test');

const { TranscriptBuffer } = require('../src/transcript-buffer');

test('retains recent turns within a character budget', () => {
  const transcript = new TranscriptBuffer(12);

  transcript.push({ channel: 'them', text: '12345' });
  transcript.push({ channel: 'you', text: '67890' });
  transcript.push({ channel: 'them', text: 'abcde' });

  assert.deepEqual(transcript.snapshot().map((turn) => turn.text), ['67890', 'abcde']);
  assert.equal(transcript.length, 2);
});

test('clips an oversized turn and clears retained context', () => {
  const transcript = new TranscriptBuffer(5);

  transcript.push({ channel: 'them', text: '123456789' });
  assert.equal(transcript.snapshot()[0].text, '56789');

  transcript.clear();
  assert.equal(transcript.length, 0);
});
