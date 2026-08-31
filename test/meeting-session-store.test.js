const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const { MeetingSessionStore } = require('../src/meeting-session-store');

function createStore() {
  const rootDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'ghostpilot-sessions-'));
  return { rootDirectory, store: new MeetingSessionStore(rootDirectory) };
}

test('persists raw transcript turns in readable and structured files', () => {
  const { rootDirectory, store } = createStore();
  const session = store.startSession(1_700_000_000_000);
  store.appendTurn({ channel: 'you', text: 'My answer', ts: 1_700_000_001_000 });
  store.appendTurn({ channel: 'them', text: 'Next question', ts: 1_700_000_002_000 });
  store.stopSession(1_700_000_003_000);

  const restored = new MeetingSessionStore(rootDirectory).getSnapshot();
  assert.strictEqual(restored.session.id, session.id);
  assert.deepStrictEqual(restored.turns.map((turn) => turn.text), ['My answer', 'Next question']);
  assert.match(restored.transcriptText, /You: My answer/);
  assert.match(restored.transcriptText, /Meeting: Next question/);
});

test('preserves an interrupted session and starts a new recording separately', () => {
  const { rootDirectory, store } = createStore();
  const interrupted = store.startSession(1_700_000_000_000);
  store.appendTurn({ channel: 'them', text: 'Keep this', ts: 1_700_000_001_000 });

  const restoredStore = new MeetingSessionStore(rootDirectory, { now: () => 1_700_000_002_000 });
  const restored = restoredStore.getSnapshot();
  assert.strictEqual(restored.session.id, interrupted.id);
  assert.strictEqual(restored.session.status, 'interrupted');

  const next = restoredStore.startSession(1_700_000_003_000);
  assert.notStrictEqual(next.id, interrupted.id);
  assert.strictEqual(restoredStore.getSnapshot().transcriptText, '');
});

test('saves partial and final notes beside the raw transcript', () => {
  const { store } = createStore();
  const session = store.startSession();
  store.saveNotesProgress(['First section'], 3);
  store.saveNotes('# Meeting notes\n\nSummary');

  const snapshot = store.getSnapshot();
  assert.strictEqual(snapshot.hasNotes, true);
  assert.strictEqual(fs.readFileSync(path.join(session.directory, 'notes.md'), 'utf8'), '# Meeting notes\n\nSummary\n');
  assert.strictEqual(fs.existsSync(path.join(session.directory, 'notes-progress.json')), false);
});

test('keeps every raw turn while limiting the UI snapshot', () => {
  const { store } = createStore();
  store.startSession();
  for (let index = 0; index < 700; index += 1) {
    store.appendTurn({ channel: 'them', text: `Turn ${index}`, ts: index });
  }

  const snapshot = store.getSnapshot({ maxTurns: 400 });
  assert.strictEqual(snapshot.turnCount, 700);
  assert.strictEqual(snapshot.turns.length, 400);
  assert.strictEqual(snapshot.turns[0].text, 'Turn 300');
  assert.match(snapshot.transcriptText, /Turn 0/);
});

test('repairs the readable transcript from structured turns after an interrupted write', () => {
  const { rootDirectory, store } = createStore();
  const session = store.startSession();
  store.appendTurn({ channel: 'them', text: 'Durable source', ts: 1_700_000_001_000 });
  fs.writeFileSync(path.join(session.directory, 'transcript.txt'), '', 'utf8');

  const restored = new MeetingSessionStore(rootDirectory).getSnapshot();
  assert.match(restored.transcriptText, /Meeting: Durable source/);
  assert.strictEqual(restored.session.turnCount, 1);
});

test('keeps valid structured turns when a crash leaves an incomplete final line', () => {
  const { rootDirectory, store } = createStore();
  const session = store.startSession();
  store.appendTurn({ channel: 'them', text: 'Complete turn', ts: 1_700_000_001_000 });
  fs.appendFileSync(path.join(session.directory, 'transcript.jsonl'), '{"channel":"them"', 'utf8');

  const restored = new MeetingSessionStore(rootDirectory).getSnapshot();
  assert.strictEqual(restored.turnCount, 1);
  assert.strictEqual(restored.turns[0].text, 'Complete turn');
});
