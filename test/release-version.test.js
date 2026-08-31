const assert = require('node:assert/strict');
const test = require('node:test');

const { verifyReleaseVersion } = require('../scripts/verify-release-version');

test('release tag must match the package version exactly', () => {
  assert.deepEqual(verifyReleaseVersion('v1.2.0', '1.2.0'), { tag: 'v1.2.0', version: '1.2.0' });
  assert.throws(() => verifyReleaseVersion('v1.2.1', '1.2.0'), /does not match package version/);
  assert.throws(() => verifyReleaseVersion('release-1.2.0', '1.2.0'), /valid release tag/);
});
