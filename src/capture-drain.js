async function waitForIdle(isBusy, options = {}) {
  const timeoutMs = options.timeoutMs || 15000;
  const pollMs = options.pollMs || 50;
  const deadline = Date.now() + timeoutMs;
  while (isBusy()) {
    if (Date.now() >= deadline) return false;
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return true;
}

module.exports = { waitForIdle };
