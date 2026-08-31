const assert = require('node:assert');
const test = require('node:test');

const { waitForIdle } = require('../src/capture-drain');

test('waits for an in-flight transcription before the final flush', async () => {
  let busy = true;
  setTimeout(() => { busy = false; }, 20);
  const idle = await waitForIdle(() => busy, { timeoutMs: 200, pollMs: 5 });
  assert.strictEqual(idle, true);
});

test('returns false when a transcription does not settle in time', async () => {
  const idle = await waitForIdle(() => true, { timeoutMs: 15, pollMs: 5 });
  assert.strictEqual(idle, false);
});
