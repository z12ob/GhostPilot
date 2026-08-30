const assert = require('node:assert/strict');
const test = require('node:test');

const { buildDisplayMediaStreams } = require('../src/display-media');

test('requests Electron loopback audio with the selected display', () => {
  const source = { id: 'screen:0:0' };

  assert.deepEqual(buildDisplayMediaStreams(source, true), {
    video: source,
    audio: 'loopback'
  });
});

test('omits loopback audio when display audio was not requested', () => {
  const source = { id: 'screen:0:0' };

  assert.deepEqual(buildDisplayMediaStreams(source, false), { video: source });
  assert.equal(buildDisplayMediaStreams(null, true), null);
});
