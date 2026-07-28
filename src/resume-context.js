

const { buildResumeContext, parseResume } = require('./interview-context');

function buildResumeContextLegacy(resumeText, limit = 1200) {
  return buildResumeContext(resumeText, limit);
}

module.exports = { buildResumeContext, parseResume, buildResumeContextLegacy };
