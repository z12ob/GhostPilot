const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const test = require('node:test');

const { createUpdateManager } = require('../src/updater');

function createFixture(overrides = {}) {
  const updater = new EventEmitter();
  updater.checks = 0;
  updater.installs = 0;
  updater.checkForUpdates = async () => { updater.checks += 1; };
  updater.quitAndInstall = () => { updater.installs += 1; };

  const scheduled = [];
  const published = [];
  const manager = createUpdateManager({
    updater,
    isPackaged: true,
    platform: 'win32',
    appImagePath: '',
    currentVersion: '1.2.0',
    publishState: (state) => published.push(state),
    setTimeoutFn: (callback) => { scheduled.push(callback); return scheduled.length; },
    clearTimeoutFn: () => {},
    setIntervalFn: () => 1,
    clearIntervalFn: () => {},
    ...overrides
  });

  return { manager, updater, scheduled, published };
}

test('packaged Windows builds check for updates and require an explicit restart to install', async () => {
  const { manager, updater, scheduled } = createFixture();

  manager.start();
  assert.equal(updater.autoDownload, true);
  assert.equal(updater.autoInstallOnAppQuit, false);
  assert.equal(scheduled.length, 1);

  await scheduled[0]();
  assert.equal(updater.checks, 1);

  updater.emit('update-available', { version: '1.3.0' });
  updater.emit('download-progress', { percent: 48.7 });
  updater.emit('update-downloaded', { version: '1.3.0' });
  assert.deepEqual(manager.getState(), {
    supported: true,
    currentVersion: '1.2.0',
    status: 'ready',
    availableVersion: '1.3.0',
    progress: 100,
    message: 'Version 1.3.0 is ready. Restart GhostPilot to install it.'
  });

  assert.deepEqual(manager.install(), { ok: true });
  assert.equal(updater.installs, 1);
});

test('development and unsupported packages never contact the release feed', async () => {
  const { manager, updater, scheduled } = createFixture({ isPackaged: false });

  manager.start();
  assert.equal(scheduled.length, 0);
  assert.equal(updater.checks, 0);
  assert.equal(manager.getState().supported, false);
  assert.deepEqual(await manager.check(), manager.getState());
  assert.equal(updater.checks, 0);
});

test('manual checks report current and failed states without throwing into the UI', async () => {
  const { manager, updater } = createFixture();

  await manager.check();
  assert.equal(manager.getState().status, 'checking');

  updater.emit('update-not-available', { version: '1.2.0' });
  assert.equal(manager.getState().status, 'current');

  updater.emit('error', new Error('private path and request details'));
  assert.equal(manager.getState().status, 'error');
  assert.equal(manager.getState().message, 'GhostPilot could not check for updates. Try again later.');
  assert.doesNotMatch(manager.getState().message, /private path/);
});
