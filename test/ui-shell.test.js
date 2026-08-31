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
  assert.equal((main.match(/ipcMain\.handle\('app:quit'/g) || []).length, 1);
});

test('overlay hit testing is driven by main-process cursor polling', () => {
  const renderer = read('renderer/renderer.js');
  const preload = read('preload.js');
  const main = read('main.js');

  assert.doesNotMatch(renderer, /setIgnore\(true\)/);
  assert.match(renderer, /setInteractiveRegions/);
  assert.match(preload, /mouse:regions/);
  assert.match(main, /isPointInRegions/);
});

test('toolbar Quit button invokes the application quit path', () => {
  const renderer = read('renderer/renderer.js');

  assert.match(renderer, /#quit-btn'\)\.addEventListener\('click', \(\) => ghostPilot\.quit\(\)\)/);
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

test('listen starts browser media inside the user click handler', () => {
  const renderer = read('renderer/renderer.js');
  const handler = renderer.match(/#stop-btn'\)\.addEventListener\('click', async \(\) => \{([\s\S]*?)\n  \}\);/);

  assert.ok(handler, 'listen click handler should exist');
  assert.match(handler[1], /startMic\(\)/);
  assert.match(handler[1], /startSystemAudio\(\)/);
  const startBranch = handler[1].slice(handler[1].indexOf('const mediaStarts'));
  assert.ok(startBranch.indexOf('startMic()') < startBranch.indexOf('await ghostPilot.captureToggle()'));
  assert.ok(startBranch.indexOf('startSystemAudio()') < startBranch.indexOf('await ghostPilot.captureToggle()'));
});

test('audio worklets stay connected through silent output sinks', () => {
  const renderer = read('renderer/renderer.js');

  assert.match(renderer, /source\.connect\(micWorklet\);[\s\S]*micWorklet\.connect\(sink\);[\s\S]*sink\.connect\(audioCtx\.destination\)/);
  assert.match(renderer, /source\.connect\(sysWorklet\);[\s\S]*sysWorklet\.connect\(sink\);[\s\S]*sink\.connect\(sysCtx\.destination\)/);
});

test('meeting controls distinguish capture, notes, screen use, and question sending', () => {
  const html = read('renderer/index.html');
  const renderer = read('renderer/renderer.js');

  assert.match(html, /id="meeting-complete-actions"[^>]*[\s\S]*?id="generate-notes-btn"[^>]*data-mode="recap"/);
  assert.match(html, /<span>Generate notes<\/span>/);
  assert.match(html, /Screen is used only when you ask or choose Assist/);
  assert.match(renderer, /icon\('arrow-up'/);
  assert.match(renderer, /Stop and save/);
  assert.match(renderer, /notesButton\.disabled = active/);
  assert.match(renderer, /meetingActions\.classList\.toggle\('hidden'/);
});

test('live transcript exposes saved raw text actions', () => {
  const html = read('renderer/index.html');
  const preload = read('preload.js');

  assert.match(html, /id="copy-transcript-btn"[^>]*>Copy raw<\/button>/);
  assert.match(html, /id="open-session-folder-btn"[^>]*>Open folder<\/button>/);
  assert.match(preload, /sessionTranscriptText/);
  assert.match(preload, /sessionOpenFolder/);
});
