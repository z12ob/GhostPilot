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

test('overlay is resizable and saves its dimensions', () => {
  const main = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'main.js'), 'utf8');
  const settings = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'src', 'store.js'), 'utf8');

  assert.match(main, /resizable:\s*true/);
  assert.match(main, /win\.on\('resized'/);
  assert.match(main, /ipcMain\.on\('window:resize-start'/);
  assert.match(main, /ipcMain\.on\('window:resize-to'/);
  assert.match(settings, /windowWidth:\s*null/);
  assert.match(settings, /windowHeight:\s*null/);
});
