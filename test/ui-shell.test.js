const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.join(__dirname, '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('onboarding is an accessible dialog with close and quit paths', () => {
  const html = read('renderer/index.html');
  const renderer = read('renderer/renderer.js');

  assert.match(html, /id="onboard"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="ob-close"[^>]*aria-label="Close setup guide"/);
  assert.match(html, /id="ob-quit"[^>]*>Quit GhostPilot</);
  assert.match(renderer, /#ob-close[^\n]*finishOnboard/);
  assert.match(renderer, /#ob-quit[^\n]*ghostPilot\.quit/);
  assert.match(renderer, /e\.key === 'Escape'[^\n]*finishOnboard/);
});

test('standalone permission window always exposes close and Escape exits', () => {
  const html = read('renderer/permissions.html');
  const main = read('main.js');

  assert.match(html, /id="perm-close"[^>]*aria-label="Close GhostPilot"/);
  assert.match(html, /id="quit-btn"[^>]*>Quit GhostPilot</);
  assert.match(html, /addEventListener\('keydown',[\s\S]*e\.key === 'Escape'[\s\S]*ghostPilot\.quit\(\)/);
  assert.equal((main.match(/ipcMain\.on\('app:quit'/g) || []).length, 1);
});

test('Windows onboarding explains the desktop-app microphone switch', () => {
  const renderer = read('renderer/renderer.js');

  assert.match(renderer, /Allow desktop apps to access your microphone/i);
  assert.match(renderer, /will not appear as a separate toggle/i);
  assert.doesNotMatch(renderer, /ms-settings:privacy-screenrecorder/);
});

test('settings has one validation-aware open and close path', () => {
  const renderer = read('renderer/renderer.js');

  assert.equal((renderer.match(/function openSettings\(/g) || []).length, 1);
  assert.equal((renderer.match(/function closeSettings\(/g) || []).length, 1);
  assert.match(renderer, /async function closeSettings\(\)[\s\S]*if \(await saveSettings\(\)\)[\s\S]*classList\.add\('hidden'\)/);
});
