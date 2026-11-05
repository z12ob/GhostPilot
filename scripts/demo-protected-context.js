const { rankProtectedContext } = require('../src/protected-context-ranker');

const candidates = [
  {
    id: 'visual-shell',
    text: 'The overlay renderer controls toolbar spacing, themes, and panel visibility.',
  },
  {
    id: 'payment-recovery',
    text: 'A payment callback must be independently confirmed before settlement grants access.',
  },
  {
    id: 'session-recovery',
    text: 'Interrupted meeting sessions restore the latest transcript and saved context.',
  },
];

rankProtectedContext({
  query: process.argv.slice(2).join(' ') || 'confirm payment settlement after callback',
  candidates,
  limit: 2,
})
  .then((ranked) => process.stdout.write(`${JSON.stringify(ranked, null, 2)}\n`))
  .catch((error) => {
    if (error?.code === 'OSANDONES_ACCESS_REQUIRED') {
      process.stderr.write(`${error.code}: ${error.message}\n`);
      process.stderr.write(`Repository: ${error.repository}\n`);
      process.stderr.write(`Component: ${error.component}\n`);
      process.exitCode = 2;
      return;
    }
    throw error;
  });
