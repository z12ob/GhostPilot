const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const builder = require('../electron-builder.cjs');
const pkg = require('../package.json');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('defines explicit Windows x64 package targets', () => {
  assert.equal(pkg.scripts['pack:win'], 'electron-builder --win --dir');
  assert.equal(pkg.scripts['dist:win'], 'electron-builder --win');
  assert.deepEqual(builder.win.target, [
    { target: 'nsis', arch: ['x64'] },
    { target: 'zip', arch: ['x64'] }
  ]);
});

test('ships every runtime directory in packaged builds', () => {
  assert.ok(builder.files.includes('main.js'));
  assert.ok(builder.files.includes('preload.js'));
  assert.ok(builder.files.includes('src/**/*'));
  assert.ok(builder.files.includes('renderer/**/*'));
});

test('uses the GhostPilot identity in Windows runtime and development metadata', () => {
  const main = read('main.js');
  const renameScript = read('scripts/rename-electron.js');

  assert.equal(pkg.productName, 'GhostPilot');
  assert.match(main, /app\.setName\('GhostPilot'\)/);
  assert.match(main, /app\.setAppUserModelId\('com\.ghostpilot\.app'\)/);
  assert.doesNotMatch(main, /MicrosoftEdgeUpdate|Microsoft Edge Update/);
  assert.match(renameScript, /DISPLAY_NAME\s*=\s*'GhostPilot\.exe'/);
  assert.match(renameScript, /BUILDER_NAME\s*=\s*'electron\.exe'/);
  assert.match(renameScript, /fs\.copyFileSync\(target, builderTarget\)/);
  assert.match(renameScript, /FileDescription:\s*'GhostPilot'/);
  assert.match(renameScript, /ProductName:\s*'GhostPilot'/);
  assert.doesNotMatch(renameScript, /FileDescription:\s*'Microsoft|ProductName:\s*'Microsoft|CompanyName:\s*'Microsoft/);
});

test('Windows permission status checks the desktop microphone switch', async () => {
  const { resolvePermissionStatus } = require('../src/permissions');
  const calls = [];
  const status = await resolvePermissionStatus({
    platform: 'win32',
    getMediaAccessStatus(mediaType) {
      calls.push(mediaType);
      return 'denied';
    },
    verifyScreenAccess() {
      throw new Error('Windows screen capture should not use the macOS probe');
    }
  });

  assert.deepEqual(status, { mic: 'denied', screen: 'granted' });
  assert.deepEqual(calls, ['microphone']);
});
