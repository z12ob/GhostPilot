const fs = require('fs');
const path = require('path');

if (process.platform !== 'win32') process.exit(0);

const pkg = require('../package.json');
const DISPLAY_NAME = 'GhostPilot.exe';
const BUILDER_NAME = 'electron.exe';
const distDir = path.join(__dirname, '..', 'node_modules', 'electron', 'dist');
const pathTxt = path.join(__dirname, '..', 'node_modules', 'electron', 'path.txt');
const target = path.join(distDir, DISPLAY_NAME);
const builderTarget = path.join(distDir, BUILDER_NAME);
const legacyNames = ['MicrosoftEdgeUpdate.exe', 'RuntimeBroker.exe', 'SearchHost.exe'];
const candidates = [BUILDER_NAME, ...legacyNames];

const source = candidates
  .map((name) => path.join(distDir, name))
  .find((candidate) => fs.existsSync(candidate));

if (!source && !fs.existsSync(target)) {
  console.warn('[postinstall] No Electron executable found, skipping.');
  process.exit(0);
}

if (source) {
  fs.copyFileSync(source, target);
  console.log(`[postinstall] Copied ${path.basename(source)} -> ${DISPLAY_NAME}`);
}

for (const name of [...legacyNames, 'electron.exe.bak']) {
  const candidate = path.join(distDir, name);
  try {
    if (candidate !== target && fs.existsSync(candidate)) fs.unlinkSync(candidate);
  } catch (_) {}
}

if (!fs.existsSync(builderTarget)) fs.copyFileSync(target, builderTarget);

fs.writeFileSync(pathTxt, DISPLAY_NAME);
console.log(`[postinstall] path.txt -> ${DISPLAY_NAME}`);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function versionParts(version) {
  return version.split('.').map((part) => Number.parseInt(part, 10) || 0).slice(0, 4).concat([0, 0, 0, 0]).slice(0, 4);
}

async function patchExecutable() {
  let lastError;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      const ResEdit = require('resedit');
      const { NtExecutable, NtExecutableResource, Resource, Data } = ResEdit;
      const executable = NtExecutable.from(fs.readFileSync(target));
      const resources = NtExecutableResource.from(executable);
      const versions = Resource.VersionInfo.fromEntries(resources.entries);
      const [major, minor, patch, build] = versionParts(pkg.version);

      for (const version of versions) {
        const languages = version.getAllLanguagesForStringValues();
        for (const language of languages) {
          version.setFileVersion(major, minor, patch, build, language.lang);
          version.setProductVersion(major, minor, patch, build, language.lang);
          version.setStringValues(language, {
            FileDescription: 'GhostPilot',
            ProductName: 'GhostPilot',
            CompanyName: 'GhostPilot',
            LegalCopyright: `Copyright (c) ${new Date().getFullYear()} Guram Melikidze`,
            OriginalFilename: DISPLAY_NAME,
            InternalName: 'GhostPilot'
          });
        }
        version.outputToResourceEntries(resources.entries);
      }

      const iconPath = path.join(__dirname, '..', 'build-resources', 'icon.ico');
      if (fs.existsSync(iconPath)) {
        const iconFile = Data.IconFile.from(fs.readFileSync(iconPath));
        Resource.IconGroupEntry.replaceIconsForResource(
          resources.entries,
          1,
          1033,
          iconFile.icons.map((item) => item.data)
        );
      }

      resources.outputResource(executable);
      fs.writeFileSync(target, Buffer.from(executable.generate()));
      console.log(`[postinstall] Patched GhostPilot ${pkg.version} metadata.`);
      return;
    } catch (error) {
      lastError = error;
      if (attempt < 5) await sleep(1500);
    }
  }
  console.warn(`[postinstall] Could not patch GhostPilot metadata after 5 attempts: ${lastError.message}`);
}

patchExecutable();
