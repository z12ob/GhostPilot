const assert = require('node:assert/strict');
const test = require('node:test');

test('overlay window uses screen-saver always-on-top level', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(src, /setAlwaysOnTop\(true,\s*'screen-saver'/);
  assert.match(src, /setContentProtection\(true\)/);
  assert.match(src, /backgroundColor:\s*'#00000000'/);
});

test('LLM requests support abort signals', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'llm.js'), 'utf8');
  assert.match(src, /signal\?\.aborted/);
  assert.match(src, /AbortError/);
});

test('capture pipeline caps PCM buffers', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
  assert.match(src, /pushPcmChunk/);
  assert.match(src, /clearPcmBuffer/);
});
