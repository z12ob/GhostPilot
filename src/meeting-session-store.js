const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const SESSION_FILE = 'session.json';
const TRANSCRIPT_JSONL_FILE = 'transcript.jsonl';
const TRANSCRIPT_TEXT_FILE = 'transcript.txt';
const NOTES_FILE = 'notes.md';
const NOTES_DATA_FILE = 'notes.json';
const NOTES_PROGRESS_FILE = 'notes-progress.json';

function writeJsonAtomic(filePath, value) {
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  fs.renameSync(temporaryPath, filePath);
}

function readJson(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readTurns(filePath) {
  try {
    const turns = [];
    for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
      if (!line) continue;
      try {
        turns.push(JSON.parse(line));
      } catch {}
    }
    return turns;
  } catch {
    return [];
  }
}

function channelLabel(channel) {
  return channel === 'you' ? 'You' : 'Meeting';
}

function transcriptLine(turn) {
  const timestamp = new Date(turn.ts).toISOString().slice(11, 19);
  return `[${timestamp}] ${channelLabel(turn.channel)}: ${turn.text}\n`;
}

class MeetingSessionStore {
  constructor(rootDirectory, options = {}) {
    if (!rootDirectory) throw new TypeError('rootDirectory is required');
    this.rootDirectory = path.resolve(rootDirectory);
    this.now = options.now || Date.now;
    this.current = null;
    fs.mkdirSync(this.rootDirectory, { recursive: true });
    this.restoreLatest();
  }

  restoreLatest() {
    const entries = fs.readdirSync(this.rootDirectory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const directory = path.join(this.rootDirectory, entry.name);
        const session = readJson(path.join(directory, SESSION_FILE));
        return session ? { ...session, directory } : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.startedAt - left.startedAt);

    this.current = entries[0] || null;
    let metadataChanged = false;
    if (this.current) {
      const turns = readTurns(path.join(this.current.directory, TRANSCRIPT_JSONL_FILE));
      const expectedText = turns.map(transcriptLine).join('');
      let readableText = '';
      try {
        readableText = fs.readFileSync(path.join(this.current.directory, TRANSCRIPT_TEXT_FILE), 'utf8');
      } catch {}
      if (readableText !== expectedText) {
        fs.writeFileSync(path.join(this.current.directory, TRANSCRIPT_TEXT_FILE), expectedText, 'utf8');
      }
      if (this.current.turnCount !== turns.length) {
        this.current.turnCount = turns.length;
        metadataChanged = true;
      }
    }
    if (this.current?.status === 'recording') {
      this.current.status = 'interrupted';
      this.current.endedAt = this.now();
      this.current.recovered = true;
      metadataChanged = true;
    }
    if (metadataChanged) this.writeCurrentMetadata();
    return this.current;
  }

  startSession(startedAt = this.now(), details = {}) {
    if (this.current?.status === 'recording') this.stopSession(startedAt, 'interrupted');
    const kind = details.kind === 'interview' ? 'interview' : 'meeting';
    const suppliedTitle = String(details.title || '').trim().slice(0, 200);
    const id = crypto.randomUUID();
    const datePart = new Date(startedAt).toISOString().replace(/[:.]/g, '-');
    const directory = path.join(this.rootDirectory, `${datePart}_${id.slice(0, 8)}`);
    fs.mkdirSync(directory, { recursive: false });
    this.current = {
      id,
      kind,
      title: suppliedTitle || `${kind === 'interview' ? 'Interview' : 'Meeting / class'} ${new Date(startedAt).toLocaleString()}`,
      startedAt,
      endedAt: null,
      status: 'recording',
      turnCount: 0,
      directory
    };
    fs.writeFileSync(path.join(directory, TRANSCRIPT_JSONL_FILE), '', 'utf8');
    fs.writeFileSync(path.join(directory, TRANSCRIPT_TEXT_FILE), '', 'utf8');
    this.writeCurrentMetadata();
    return { ...this.current };
  }

  appendTurn(turn) {
    if (!this.current) this.startSession();
    const text = String(turn?.text || '').trim();
    if (!text) return null;
    const retained = {
      channel: turn.channel === 'you' ? 'you' : 'them',
      text,
      ts: Number.isFinite(turn.ts) ? turn.ts : this.now()
    };
    fs.appendFileSync(
      path.join(this.current.directory, TRANSCRIPT_JSONL_FILE),
      `${JSON.stringify(retained)}\n`,
      'utf8'
    );
    fs.appendFileSync(
      path.join(this.current.directory, TRANSCRIPT_TEXT_FILE),
      transcriptLine(retained),
      'utf8'
    );
    this.current.turnCount = (this.current.turnCount || 0) + 1;
    return retained;
  }

  stopSession(endedAt = this.now(), status = 'completed') {
    if (!this.current || this.current.status !== 'recording') return this.current;
    this.current.endedAt = endedAt;
    this.current.status = status;
    this.writeCurrentMetadata();
    return { ...this.current };
  }

  saveNotesProgress(partialNotes, totalSections) {
    if (!this.current) return null;
    const progress = {
      sessionId: this.current.id,
      updatedAt: this.now(),
      completedSections: partialNotes.length,
      totalSections,
      partialNotes
    };
    writeJsonAtomic(path.join(this.current.directory, NOTES_PROGRESS_FILE), progress);
    return progress;
  }

  saveNotes(content, details = {}) {
    if (!this.current) return null;
    const normalized = `${String(content || '').trim()}\n`;
    fs.writeFileSync(path.join(this.current.directory, NOTES_FILE), normalized, 'utf8');
    writeJsonAtomic(path.join(this.current.directory, NOTES_DATA_FILE), {
      sessionId: this.current.id,
      generatedAt: this.now(),
      provider: details.provider || null,
      model: details.model || null,
      content: normalized.trim()
    });
    fs.rmSync(path.join(this.current.directory, NOTES_PROGRESS_FILE), { force: true });
    this.current.notesUpdatedAt = this.now();
    this.writeCurrentMetadata();
    return path.join(this.current.directory, NOTES_FILE);
  }

  getSnapshot(options = {}) {
    if (!this.current) {
      return { session: null, turns: [], turnCount: 0, transcriptText: '', hasNotes: false };
    }
    const turns = readTurns(path.join(this.current.directory, TRANSCRIPT_JSONL_FILE));
    const maxTurns = Number.isInteger(options.maxTurns) ? options.maxTurns : turns.length;
    let transcriptText = '';
    try {
      transcriptText = fs.readFileSync(path.join(this.current.directory, TRANSCRIPT_TEXT_FILE), 'utf8');
    } catch {}
    return {
      session: { ...this.current },
      turns: turns.slice(-maxTurns),
      turnCount: turns.length,
      transcriptText,
      hasNotes: fs.existsSync(path.join(this.current.directory, NOTES_FILE))
    };
  }

  writeCurrentMetadata() {
    if (!this.current) return;
    const { directory, ...metadata } = this.current;
    writeJsonAtomic(path.join(directory, SESSION_FILE), metadata);
  }
}

module.exports = { MeetingSessionStore };
