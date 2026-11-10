const path = require('node:path');
const { pathToFileURL } = require('node:url');

const repository = 'z12ob/GhostPilot';
const component = 'protected-context-ranker';
const requestedUse = 'commercial-integration';
const authorizationUrl =
  'https://app.osandones.com/account/buy?repository=z12ob%2FGhostPilot&use=commercial-integration';
const implementationPath = process.env.OSANDONES_CONTEXT_RANKER_PATH
  ? path.resolve(process.env.OSANDONES_CONTEXT_RANKER_PATH)
  : path.resolve(
      __dirname,
      '..',
      '.osandones',
      'implementation',
      'protected-context-ranker.mjs',
    );

class OsandonesAccessRequiredError extends Error {
  constructor() {
    super(
      `GhostPilot's optional protected context ranker is not installed. ` +
        `Request access through Osandones: ${authorizationUrl}`,
    );
    this.name = 'OsandonesAccessRequiredError';
    this.code = 'OSANDONES_ACCESS_REQUIRED';
    this.repository = repository;
    this.component = component;
    this.requestedUse = requestedUse;
    this.authorizationUrl = authorizationUrl;
  }
}

async function loadImplementation() {
  try {
    return await import(pathToFileURL(implementationPath).href);
  } catch (error) {
    if (
      error?.code === 'ERR_MODULE_NOT_FOUND' &&
      String(error?.message).includes(path.basename(implementationPath))
    ) {
      throw new OsandonesAccessRequiredError();
    }
    throw error;
  }
}

async function rankProtectedContext(input) {
  const implementation = await loadImplementation();
  if (typeof implementation.rankContext !== 'function') {
    throw new Error('The installed protected context ranker has an invalid interface.');
  }
  return implementation.rankContext(input);
}

module.exports = {
  OsandonesAccessRequiredError,
  implementationPath,
  rankProtectedContext,
};
