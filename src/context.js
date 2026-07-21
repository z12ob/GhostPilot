

const { MODES } = require('./prompts');

function buildContext(state) {
  const { transcript = [], userText = '', settings = {} } = state;
  const rt = getRecent(transcript, 12);
  return {
    transcript,
    recent: rt,
    userText,
    profile: settings.context || '',
    smart: !!settings.smart,
    memory: state.memory || []
  };
}

function getRecent(turns, n) {
  return turns.slice(-n);
}

function buildSystem(def, ctx) {
  let system = typeof def.buildSystem === 'function' ? def.buildSystem('') : (def.system || '');
  if (ctx.profile && ['assist', 'say', 'ask'].includes(def.key)) {
    system = 'Here is my background and experience. Weave it into my answer naturally. Name the projects, the tech, the results. This keeps my answer real instead of generic.\n\n---\n' + ctx.profile + '\n---\n\n' + system;
  }
  return system;
}

function buildUserTurn(def, ctx) {
  return def.build({ transcript: ctx.recent, userText: ctx.userText, memory: ctx.memory });
}

const MODE_WINDOW = { assist: 12, say: 14, followup: 20, recap: 0, ask: 12, leetcode: 0 };

function windowFor(mode) {
  const n = MODE_WINDOW[mode];
  return n == null ? 12 : n;
}

module.exports = { buildContext, getRecent, buildSystem, buildUserTurn, windowFor };