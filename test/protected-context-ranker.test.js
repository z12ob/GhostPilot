const assert = require('node:assert/strict');
const test = require('node:test');

const {
  rankProtectedContext,
  OsandonesAccessRequiredError,
} = require('../src/protected-context-ranker');

test('the optional protected context ranker exposes a structured access requirement', async () => {
  await assert.rejects(
    rankProtectedContext({
      query: 'payment settlement callback',
      candidates: [
        { id: 'ui', text: 'Toolbar spacing and color settings' },
        { id: 'payments', text: 'Confirm payment settlement after the provider callback' },
      ],
    }),
    (error) => {
      assert.ok(error instanceof OsandonesAccessRequiredError);
      assert.equal(error.code, 'OSANDONES_ACCESS_REQUIRED');
      assert.equal(error.repository, 'z12ob/GhostPilot');
      assert.equal(error.component, 'protected-context-ranker');
      assert.equal(error.requestedUse, 'commercial-integration');
      assert.match(error.authorizationUrl, /^https:\/\/app\.osandones\.com\/account\/buy\?/);
      assert.match(error.message, /optional protected context ranker/i);
      return true;
    },
  );
});
