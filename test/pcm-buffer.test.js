const assert = require('node:assert/strict');
const test = require('node:test');
const { pcmBufferBytes, pushPcmChunk, clearPcmBuffer } = require('../src/pcm-buffer');

test('pushPcmChunk keeps total size within the configured cap', () => {
  const chunks = [];
  const chunk = Buffer.alloc(1000, 1);
  for (let i = 0; i < 200; i++) pushPcmChunk(chunks, chunk, 50000);
  assert.ok(pcmBufferBytes(chunks) <= 50000);
  assert.ok(chunks.length > 1);
});

test('pushPcmChunk trims an oversized single chunk', () => {
  const chunks = [];
  pushPcmChunk(chunks, Buffer.alloc(8000, 2), 5000);
  assert.equal(chunks.length, 1);
  assert.equal(chunks[0].length, 5000);
});

test('clearPcmBuffer removes retained audio', () => {
  const chunks = [Buffer.alloc(32)];
  clearPcmBuffer(chunks);
  assert.equal(chunks.length, 0);
});
