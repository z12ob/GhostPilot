const test = require('node:test');
const assert = require('node:assert');
const { normalizeWorkMode, buildSessionContext } = require('../src/session-mode');
const { MODES } = require('../src/prompts');

test('work mode defaults safely and accepts the two supported scenarios', () => {
  assert.equal(normalizeWorkMode(), 'interview');
  assert.equal(normalizeWorkMode('interview'), 'interview');
  assert.equal(normalizeWorkMode('meeting'), 'meeting');
  assert.equal(normalizeWorkMode('anything-else'), 'interview');
});

test('meeting context includes shared and meeting material without interview-only fields', () => {
  const context = buildSessionContext({
    workMode: 'meeting',
    profileText: 'I am a backend engineer learning distributed systems.',
    meetingTitle: 'Consensus algorithms class',
    meetingGoal: 'Understand Raft leader election.',
    meetingContext: 'The class compares Raft and Paxos.',
    meetingRole: 'Student who wants practical examples.',
    resumeText: 'Interview resume should stay out.',
    salaryTarget: '$200k should stay out.'
  }, 'followup', [{ channel: 'them', text: 'What happens during a split vote?' }]);

  assert.match(context, /backend engineer/);
  assert.match(context, /Consensus algorithms class/);
  assert.match(context, /Raft leader election/);
  assert.match(context, /Student who wants practical examples/);
  assert.doesNotMatch(context, /Interview resume/);
  assert.doesNotMatch(context, /\$200k/);
});

test('interview context includes shared profile and relevant interview preparation', () => {
  const context = buildSessionContext({
    workMode: 'interview',
    profileText: 'I prefer concise, evidence-based answers.',
    resumeText: 'Jane Doe\nEngineer\nExperience\nBuilt resilient services at Acme.',
    jobDescription: 'Backend engineer role',
    salaryTarget: '$150k to $170k'
  }, 'say', [{ channel: 'them', text: 'What are your salary expectations?' }]);

  assert.match(context, /evidence-based answers/);
  assert.match(context, /Acme/);
  assert.match(context, /Backend engineer role/i);
  assert.match(context, /\$150k to \$170k/);
});

test('meeting live actions analyze the transcript without interview assumptions', () => {
  const saySystem = MODES.say.buildSystem('', '', 'meeting');
  const followupSystem = MODES.followup.buildSystem('', '', 'meeting');
  const assistSystem = MODES.assist.buildSystem('', '', 'meeting');
  const turn = MODES.followup.build({
    workMode: 'meeting',
    transcript: [{ channel: 'them', text: 'The deadline depends on vendor approval.' }]
  });

  assert.match(saySystem, /meeting or class/i);
  assert.match(followupSystem, /questions raised/i);
  assert.match(assistSystem, /meeting or class/i);
  assert.match(turn, /vendor approval/);
  assert.doesNotMatch(saySystem, /candidate|salary|interviewer/i);
  assert.doesNotMatch(followupSystem, /candidate|salary|interviewer/i);
});

test('assist can continue with transcript and saved context when a screen snapshot is unavailable', () => {
  assert.equal(MODES.assist.needsScreen, true);
  assert.equal(MODES.assist.screenOptional, true);
});
