const pkg = require('../package.json');

function verifyReleaseVersion(tag, version) {
  if (!/^v\d+\.\d+\.\d+$/.test(tag || '')) {
    throw new Error(`Expected a valid release tag such as v${version}. Received ${tag || 'nothing'}.`);
  }
  if (tag.slice(1) !== version) {
    throw new Error(`Release tag ${tag} does not match package version ${version}.`);
  }
  return { tag, version };
}

if (require.main === module) {
  const result = verifyReleaseVersion(process.env.GITHUB_REF_NAME, pkg.version);
  process.stdout.write(`Release version verified: ${result.tag}\n`);
}

module.exports = { verifyReleaseVersion };
