const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const path = require('node:path');

const pkg = require('../package.json');

test('package.json has no "build" field shadowing electron-builder.cjs', () => {
  assert.equal(Object.prototype.hasOwnProperty.call(pkg, 'build'), false);
});

test('dist/pack scripts do not pass an inline --config that could bypass electron-builder.cjs', () => {
  for (const [name, script] of Object.entries(pkg.scripts)) {
    if (!/electron-builder/.test(script)) continue;
    assert.ok(!/--config/.test(script), `${name} script unexpectedly overrides config: ${script}`);
  }
});

test('release scripts never auto-publish and mac security claims require a real certificate', () => {
  const original = { ...process.env };
  try {
    delete require.cache[require.resolve('../electron-builder.cjs')];
    delete process.env.MAC_SIGN;
    delete process.env.APPLE_ID;
    delete process.env.APPLE_APP_SPECIFIC_PASSWORD;
    delete process.env.APPLE_TEAM_ID;
    const unsigned = require('../electron-builder.cjs');

    assert.deepEqual(unsigned.publish, [{ provider: 'github', owner: 'z12ob', repo: 'GhostPilot' }]);
    for (const scriptName of ['dist', 'dist:mac', 'dist:win', 'dist:linux', 'dist:linux:arm64', 'dist:linux:all']) {
      assert.match(pkg.scripts[scriptName], /--publish never/);
    }

    assert.equal(unsigned.mac.identity, null);
    assert.equal(unsigned.mac.hardenedRuntime, false);
    assert.equal(unsigned.mac.notarize, false);

    delete require.cache[require.resolve('../electron-builder.cjs')];
    process.env.MAC_SIGN = '1';
    process.env.APPLE_ID = 'dev@example.com';
    process.env.APPLE_APP_SPECIFIC_PASSWORD = 'app-specific-password';
    process.env.APPLE_TEAM_ID = 'TEAMID1234';
    const signed = require('../electron-builder.cjs');

    assert.deepEqual(signed.publish, [{ provider: 'github', owner: 'z12ob', repo: 'GhostPilot' }]);
    assert.equal(signed.mac.identity, undefined);
    assert.equal(signed.mac.hardenedRuntime, true);
    assert.equal(signed.mac.notarize, true);
  } finally {
    process.env = original;
    delete require.cache[require.resolve('../electron-builder.cjs')];
  }
});

test('mac config ships the zip target with entitlements files that exist on disk', () => {
  delete require.cache[require.resolve('../electron-builder.cjs')];
  const builder = require('../electron-builder.cjs');
  assert.deepEqual(builder.mac.target, [{ target: 'zip', arch: ['x64', 'arm64'] }]);
  const root = path.join(__dirname, '..');
  assert.ok(fs.existsSync(path.join(root, builder.mac.entitlements)));
  assert.ok(fs.existsSync(path.join(root, builder.mac.entitlementsInherit)));

  const entitlementsXml = fs.readFileSync(path.join(root, builder.mac.entitlements), 'utf8');
  assert.match(entitlementsXml, /com\.apple\.security\.device\.audio-input/);
});

test('packaged apps use the branded GhostPilot icon source', () => {
  delete require.cache[require.resolve('../electron-builder.cjs')];
  const builder = require('../electron-builder.cjs');
  const root = path.join(__dirname, '..');

  assert.equal(builder.win.icon, 'build-resources/icon.svg');
  assert.equal(builder.mac.icon, 'build-resources/icon.svg');
  assert.equal(builder.linux.icon, 'build-resources/icon.svg');
  assert.ok(fs.existsSync(path.join(root, 'build-resources', 'icon.svg')));
});

test('packaged JavaScript uses ASAR while native speech runtime stays external', () => {
  delete require.cache[require.resolve('../electron-builder.cjs')];
  const builder = require('../electron-builder.cjs');
  const afterPack = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'after-pack.js'), 'utf8');

  assert.equal(builder.asar, true);
  assert.match(afterPack, /resources', 'whisper-runtime/);
});
