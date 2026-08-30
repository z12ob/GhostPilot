

function buildNotesPrompt(transcript) {
  const who = (t) => (t.channel === 'them' ? 'Them' : 'You');
  const lines = transcript.map((t) => who(t) + ': ' + t.text).join('\n');
  return (
    'Meeting transcript:\n' +
    (lines || '(empty)') +
    '\n\nWrite structured meeting notes with EXACTLY these seven headings, each ' +
    'heading alone on its own line:\n' +
    'Meeting Summary:\n' +
    'Cheat Sheet:\n' +
    'Topics and Connections:\n' +
    'Decisions:\n' +
    'Action Items:\n' +
    'Open Questions:\n' +
    'Follow-Up:\n' +
    'Use a hyphen at the start of each bullet. Keep the summary to 2-3 sentences. ' +
    'Prioritize the most important concepts, explain how they relate, name owners and deadlines when stated, and never invent missing details.'
  );
}

function chunkTranscript(transcript, maxCharacters = 18000) {
  if (!Array.isArray(transcript) || !transcript.length) return [];
  const chunks = [];
  let current = [];
  let characters = 0;

  for (const turn of transcript) {
    const size = String(turn.text || '').length + 8;
    if (current.length && characters + size > maxCharacters) {
      chunks.push(current);
      current = [];
      characters = 0;
    }
    current.push(turn);
    characters += size;
  }

  if (current.length) chunks.push(current);
  return chunks;
}

function buildPartialNotesPrompt(transcript, index, total) {
  const who = (turn) => (turn.channel === 'them' ? 'Them' : 'You');
  const lines = transcript.map((turn) => `${who(turn)}: ${turn.text}`).join('\n');
  return (
    `Meeting transcript section ${index} of ${total}:\n${lines}\n\n` +
    'Capture only facts from this section. Summarize the important topics and how they connect, decisions, action items with owners or deadlines, open questions, and useful details for a cheat sheet. ' +
    'Keep the result under 180 words. Do not add a preamble or invent details.'
  );
}

function buildCombinedNotesPrompt(partialNotes) {
  return buildNotesPrompt(partialNotes.map((text, index) => ({
    channel: 'them',
    text: `Section ${index + 1}: ${text}`
  })));
}

const HEADERS = [
  ['summary', /^meeting summary\s*:?\s*$/i],
  ['keyPoints', /^key points\s*:?\s*$/i],
  ['decisions', /^decisions\s*:?\s*$/i],
  ['actionItems', /^action items\s*:?\s*$/i],
  ['followUp', /^follow[- ]up\s*:?\s*$/i]
];

function parseNotes(text) {
  const out = { summary: '', keyPoints: [], decisions: [], actionItems: [], followUp: [] };
  if (!text || !text.trim()) return out;

  const lines = text.split(/\r?\n/);
  let cur = null;
  const buckets = { summary: [], keyPoints: [], decisions: [], actionItems: [], followUp: [] };
  for (const raw of lines) {
    const line = raw.trim();
    const matched = HEADERS.find(([, re]) => re.test(line));
    if (matched) { cur = matched[0]; continue; }
    if (!cur) continue;
    if (!line) { cur = null; continue; }
    buckets[cur].push(line);
  }
  for (const [k, arr] of Object.entries(buckets)) {
    if (k === 'summary') { out.summary = arr.join(' ').trim(); continue; }
    out[k] = arr.map((l) => l.replace(/^[-*•]\s*/, '').replace(/^\[[ x]\]\s*/, '').replace(/^[0-9]+[.)]\s*/, '').trim()).filter(Boolean);
  }

  const anything = Object.values(buckets).some((a) => a.length);
  if (!anything && text.trim()) out.summary = text.trim();
  return out;
}

module.exports = {
  buildCombinedNotesPrompt,
  buildNotesPrompt,
  buildPartialNotesPrompt,
  chunkTranscript,
  parseNotes
};
