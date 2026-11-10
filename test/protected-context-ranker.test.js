const assert = require('node:assert/strict');
const { mkdtemp, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const path = require('node:path');
const test = require('node:test');

const modulePath = require.resolve('../src/protected-context-ranker');

function loadRanker(implementationPath) {
  process.env.OSANDONES_CONTEXT_RANKER_PATH = implementationPath;
  delete require.cache[modulePath];
  return require(modulePath);
}

test('the optional protected context ranker exposes a structured access requirement', async () => {
  const {
    rankProtectedContext,
    OsandonesAccessRequiredError,
  } = loadRanker(path.join(tmpdir(), 'missing-osandones-context-ranker.mjs'));
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

test('an acquired context ranker executes independently of the default installation state', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'ghostpilot-context-ranker-'));
  t.after(async () => {
    delete process.env.OSANDONES_CONTEXT_RANKER_PATH;
    delete require.cache[modulePath];
    await rm(root, { recursive: true, force: true });
  });
  const implementationPath = path.join(root, 'protected-context-ranker.mjs');
  await writeFile(
    implementationPath,
    `export function rankContext({ candidates }) {
      return [...candidates].sort((left, right) => right.text.length - left.text.length);
    }\n`,
  );
  const { rankProtectedContext } = loadRanker(implementationPath);

  assert.deepEqual(
    await rankProtectedContext({
      query: 'payment settlement',
      candidates: [
        { id: 'ui', text: 'Toolbar' },
        { id: 'payments', text: 'Confirm payment settlement' },
      ],
    }),
    [
      { id: 'payments', text: 'Confirm payment settlement' },
      { id: 'ui', text: 'Toolbar' },
    ],
  );
});

test('the default installer contract uses the component-specific filename', () => {
  delete process.env.OSANDONES_CONTEXT_RANKER_PATH;
  delete require.cache[modulePath];
  const { implementationPath } = require(modulePath);
  assert.equal(path.basename(implementationPath), 'protected-context-ranker.mjs');
});
