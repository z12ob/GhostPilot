const assert = require('node:assert');
const test = require('node:test');

const { getZipExtractor } = require('../scripts/prepare-whisper-runtime');

test('resolves the ZIP extractor exported by the installed package', () => {
  const extractor = getZipExtractor(require('@electron-internal/extract-zip'));
  assert.strictEqual(typeof extractor, 'function');
});

test('rejects a ZIP module without an extractor', () => {
  assert.throws(
    () => getZipExtractor({}),
    /does not export an extraction function/
  );
});
