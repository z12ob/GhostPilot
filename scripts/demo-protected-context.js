const { rankProtectedContext } = require('../src/protected-context-ranker');

const expectation = process.argv.includes('--expect-locked')
  ? 'locked'
  : process.argv.includes('--expect-available')
    ? 'available'
    : 'either';
const query = process.argv
  .slice(2)
  .filter((argument) => !argument.startsWith('--expect-'))
  .join(' ');

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
  query: query || 'confirm payment settlement after callback',
  candidates,
  limit: 2,
})
  .then((ranked) => {
    if (expectation === 'locked') {
      throw new Error('Expected protected access to be unavailable, but the component is installed.');
    }
    process.stdout.write('ACCESS_GRANTED: protected-context-ranker\n');
    process.stdout.write(`${JSON.stringify(ranked, null, 2)}\n`);
  })
  .catch((error) => {
    if (error?.code === 'OSANDONES_ACCESS_REQUIRED') {
      if (expectation === 'available') {
        process.stderr.write('Expected acquired access, but the component is not installed.\n');
        process.exitCode = 2;
        return;
      }
      process.stderr.write(`${error.code}: ${error.message}\n`);
      process.stderr.write(`Repository: ${error.repository}\n`);
      process.stderr.write(`Component: ${error.component}\n`);
      return;
    }
    throw error;
  });
