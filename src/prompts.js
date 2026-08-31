const { appendAiRules } = require('./profile-context');

function formatTranscript(turns = [], limit, workMode = 'interview') {
  const recent = limit ? turns.slice(-limit) : turns;
  const otherLabel = workMode === 'meeting' ? 'Other speaker' : 'Them';
  return recent
    .map((turn) => (turn.channel === 'them' ? `${otherLabel}: ` : 'You: ') + turn.text)
    .join('\n');
}

function prependContext(base, contextBlock) {
  return contextBlock ? `${contextBlock}\n\n${base}` : base;
}

function applyRules(prompt, aiRules, mode) {
  return mode === 'leetcode' ? prompt : appendAiRules(prompt, aiRules);
}

function useMeetingMode(workMode) {
  return workMode === 'meeting';
}

function buildModeSystem({ interview, meeting, contextBlock, aiRules, mode, workMode }) {
  const prompt = useMeetingMode(workMode) ? meeting : interview;
  return applyRules(prependContext(prompt, contextBlock), aiRules, mode);
}

const BASE_RULES =
  'Always respond in clear, natural English. Never switch languages unless the user explicitly asks. ' +
  'Use only facts supported by the transcript and saved context. Never invent names, experience, decisions, or commitments. ';

const MODES = {
  assist: {
    needsScreen: true,
    screenOptional: true,
    userBubble: null,
    small: false,
    resumeMode: 'assist',
    buildSystem(contextBlock, aiRules, workMode) {
      return buildModeSystem({
        contextBlock,
        aiRules,
        mode: 'assist',
        workMode,
        interview:
          'You are GhostPilot, a real-time interview copilot. ' + BASE_RULES +
          'Use the recent transcript and optional screen snapshot to decide what the user needs now. ' +
          'If a question was asked, draft a direct first person answer the candidate can say. ' +
          'For behavioral questions, use a supported STAR example. For technical questions, explain the concept clearly. ' +
          'If saved context does not contain a required fact, say so briefly instead of fabricating it. No preamble.',
        meeting:
          'You are GhostPilot, a real-time copilot for an online meeting or class. ' + BASE_RULES +
          'Use the recent transcript and optional screen snapshot to provide the most useful help right now. ' +
          'Clarify the latest point, connect related concepts, identify a decision or risk, or suggest a concise contribution. ' +
          'If someone asked the user a direct question, draft a natural response. Do not assume this is a job interview. ' +
          'Lead with the useful answer and keep it easy to scan.'
      });
    },
    build(ctx) {
      const workMode = ctx.workMode === 'meeting' ? 'meeting' : 'interview';
      const transcript = formatTranscript(ctx.transcript, workMode === 'meeting' ? 20 : 14, workMode);
      return workMode === 'meeting'
        ? `Live meeting or class transcript:\n${transcript || '(no final transcript yet)'}\n\nBrief me on what matters now and what I can usefully do or say next.`
        : `Recent interview conversation:\n${transcript || '(none)'}\n\nRespond with exactly what I should say or do right now.`;
    }
  },

  say: {
    needsScreen: false,
    requiresTranscript: true,
    userBubble: (workMode) => useMeetingMode(workMode) ? 'Draft response' : 'What should I say?',
    small: false,
    resumeMode: 'say',
    buildSystem(contextBlock, aiRules, workMode) {
      return buildModeSystem({
        contextBlock,
        aiRules,
        mode: 'say',
        workMode,
        interview:
          'You are GhostPilot, drafting the answer a candidate should say out loud during a live interview. ' + BASE_RULES +
          'Write one natural, confident, first-person answer to the latest question. ' +
          'Use supported STAR details for behavioral questions and clear examples for technical questions. ' +
          'Do not add quotes or a preamble. Write the actual words to say in 2 to 5 sentences.',
        meeting:
          'You are GhostPilot, drafting a useful response for the user during a live meeting or class. ' + BASE_RULES +
          'Write the actual words the user can say next. The response may answer a question, clarify an assumption, confirm a decision, or add a useful point. ' +
          'Match the user role and goal from saved context. If the transcript does not support a confident answer, draft a concise clarification question. ' +
          'No quotes or preamble. Keep it natural and brief.'
      });
    },
    build(ctx) {
      const workMode = ctx.workMode === 'meeting' ? 'meeting' : 'interview';
      const transcript = formatTranscript(ctx.transcript, 18, workMode);
      return workMode === 'meeting'
        ? `Live meeting or class transcript:\n${transcript || '(no final transcript yet)'}\n\nDraft the most useful response I can say next.`
        : `Interview conversation so far:\n${transcript || '(listening not started yet)'}\n\nWhat should I say next?`;
    }
  },

  followup: {
    needsScreen: false,
    requiresTranscript: true,
    userBubble: (workMode) => useMeetingMode(workMode) ? 'Questions' : 'Follow-up questions',
    small: true,
    resumeMode: 'followup',
    buildSystem(contextBlock, aiRules, workMode) {
      return buildModeSystem({
        contextBlock,
        aiRules,
        mode: 'followup',
        workMode,
        interview:
          'You are GhostPilot. Suggest 2 to 4 sharp follow-up questions the candidate could ask the interviewer. ' + BASE_RULES +
          'Base them on what was discussed and the target role. Prioritize questions that clarify expectations, challenges, team practices, or success measures. ' +
          'Return a bullet list only with no preamble.',
        meeting:
          'You are GhostPilot. Identify 2 to 4 important questions raised by the meeting or class transcript. ' + BASE_RULES +
          'Prioritize unclear assumptions, unresolved decisions, dependencies, next steps, or concepts that need a deeper explanation. ' +
          'Phrase each question so the user can ask it naturally. Return a bullet list only with no preamble.'
      });
    },
    build(ctx) {
      const workMode = ctx.workMode === 'meeting' ? 'meeting' : 'interview';
      const transcript = formatTranscript(ctx.transcript, 24, workMode);
      return workMode === 'meeting'
        ? `Meeting or class transcript so far:\n${transcript || '(none)'}\n\nList the most important questions raised by what has been discussed.`
        : `Interview conversation so far:\n${transcript || '(none)'}\n\nSuggest useful follow-up questions for the interviewer.`;
    }
  },

  recap: {
    needsScreen: false,
    userBubble: 'Generate notes',
    small: true,
    resumeMode: 'recap',
    buildSystem(contextBlock, aiRules, workMode) {
      return buildModeSystem({
        contextBlock,
        aiRules,
        mode: 'recap',
        workMode,
        interview: 'You are GhostPilot. Turn the interview transcript into accurate, concise notes. Separate questions, answers, strengths, concerns, and follow-up items.',
        meeting: 'You are GhostPilot. Turn the meeting or class transcript into accurate, concise notes. Preserve topics, connections, decisions, action items, open questions, and important explanations.'
      });
    },
    build(ctx) {
      const workMode = ctx.workMode === 'meeting' ? 'meeting' : 'interview';
      const transcript = formatTranscript(ctx.transcript, 0, workMode);
      return `Full ${workMode === 'meeting' ? 'meeting or class' : 'interview'} transcript:\n${transcript || '(nothing captured yet)'}\n\nGenerate structured notes.`;
    }
  },

  ask: {
    needsScreen: true,
    screenOptional: true,
    userBubble: null,
    small: false,
    resumeMode: 'ask',
    buildSystem(contextBlock, aiRules, workMode) {
      return buildModeSystem({
        contextBlock,
        aiRules,
        mode: 'ask',
        workMode,
        interview:
          'You are GhostPilot, a real-time interview copilot with an optional screen snapshot. ' + BASE_RULES +
          'Answer the user question directly. Use their real background when relevant and explain concepts clearly. No preamble.',
        meeting:
          'You are GhostPilot, a real-time copilot for a meeting or class with an optional screen snapshot. ' + BASE_RULES +
          'Answer the user question directly using the transcript, saved context, and visible material when available. ' +
          'Separate confirmed facts from suggestions. No preamble.'
      });
    },
    build(ctx) {
      const workMode = ctx.workMode === 'meeting' ? 'meeting' : 'interview';
      const transcript = formatTranscript(ctx.transcript, 16, workMode);
      return `${transcript ? `Recent conversation:\n${transcript}\n\n` : ''}Question: ${ctx.userText}`;
    }
  },

  answerThis: {
    needsScreen: false,
    userBubble: null,
    small: false,
    resumeMode: 'say',
    buildSystem(contextBlock, aiRules, workMode) {
      return buildModeSystem({
        contextBlock,
        aiRules,
        mode: 'answerThis',
        workMode,
        interview:
          'You are GhostPilot. Draft a direct first-person answer to one interview question. ' + BASE_RULES +
          'Use supported experience and STAR details when relevant. Write the actual words to say in 2 to 5 sentences with no preamble.',
        meeting:
          'You are GhostPilot. Draft a direct answer to one question asked during a meeting or class. ' + BASE_RULES +
          'Use the user role and saved context when relevant. If a necessary fact is missing, ask for clarification rather than inventing it. ' +
          'Write the actual words to say with no preamble.'
      });
    },
    build(ctx) {
      const workMode = ctx.workMode === 'meeting' ? 'meeting' : 'interview';
      return `Answer this specific ${workMode === 'meeting' ? 'meeting or class' : 'interview'} question:\n\n"${ctx.userText || '(no question provided)'}"\n\nGive the complete response I can say out loud.`;
    }
  },

  leetcode: {
    needsScreen: true,
    screenOptional: false,
    userBubble: 'Solve what is on screen',
    small: false,
    resumeMode: 'leetcode',
    buildSystem() {
      return 'You are an expert competitive programmer. The screenshot contains a coding problem. ' +
        'Respond with a one-line restatement, a short approach, a clean and correct solution in a fenced code block, and time and space complexity. ' +
        'Use the language shown on screen, otherwise use Python. Keep prose tight.';
    },
    build() {
      return 'Solve the coding problem shown in the screenshot.';
    }
  }
};

module.exports = { MODES, formatTranscript };
