const path = require('path');
const { Arch } = require('builder-util');
const { prepareWhisperRuntime } = require('./prepare-whisper-runtime');

module.exports = async function afterPack(context) {
  if (!process.env.GHOSTPILOT_BUNDLE_WHISPER) {
    console.log('[GhostPilot] Skipping the bundled whisper runtime (set GHOSTPILOT_BUNDLE_WHISPER=1 to include it).');
    return;
  }
  const platform = context.packager.platform.nodeName;
  const architecture = typeof context.arch === 'number' ? Arch[context.arch] : context.arch;
  if (!platform || !architecture) throw new Error('electron-builder did not provide a runtime target.');

  const outputDirectory = path.join(context.appOutDir, 'resources', 'whisper-runtime');
  await prepareWhisperRuntime({ platform, architecture, outputDirectory });
};
