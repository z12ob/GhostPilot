const UPDATE_CHECK_DELAY_MS = 12000;
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;

function canAutoUpdate({ isPackaged, platform, appImagePath }) {
  if (!isPackaged) return false;
  if (platform === 'win32') return true;
  return platform === 'linux' && !!appImagePath;
}

function createUpdateManager({
  updater,
  isPackaged,
  platform,
  appImagePath,
  currentVersion,
  publishState = () => {},
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval
}) {
  const supported = canAutoUpdate({ isPackaged, platform, appImagePath });
  let delayTimer = null;
  let intervalTimer = null;
  let state = {
    supported,
    currentVersion,
    status: supported ? 'idle' : 'unavailable',
    availableVersion: null,
    progress: 0,
    message: supported
      ? 'GhostPilot checks GitHub Releases for updates.'
      : 'Update checks are available in packaged Windows builds and Linux AppImages.'
  };

  function updateState(patch) {
    state = { ...state, ...patch };
    publishState({ ...state });
    return { ...state };
  }

  function getState() {
    return { ...state };
  }

  function onChecking() {
    updateState({ status: 'checking', progress: 0, message: 'Checking for updates...' });
  }

  function onAvailable(info = {}) {
    const version = info.version || null;
    updateState({
      status: 'downloading',
      availableVersion: version,
      progress: 0,
      message: version ? `Downloading GhostPilot ${version}...` : 'Downloading the latest GhostPilot update...'
    });
  }

  function onProgress(progress = {}) {
    const percent = Math.max(0, Math.min(100, Number(progress.percent) || 0));
    updateState({
      status: 'downloading',
      progress: percent,
      message: `Downloading update... ${Math.round(percent)}%`
    });
  }

  function onDownloaded(info = {}) {
    const version = info.version || state.availableVersion;
    updateState({
      status: 'ready',
      availableVersion: version,
      progress: 100,
      message: version
        ? `Version ${version} is ready. Restart GhostPilot to install it.`
        : 'An update is ready. Restart GhostPilot to install it.'
    });
  }

  function onCurrent() {
    updateState({
      status: 'current',
      availableVersion: null,
      progress: 0,
      message: `GhostPilot ${currentVersion} is up to date.`
    });
  }

  function onError() {
    updateState({
      status: 'error',
      progress: 0,
      message: 'GhostPilot could not check for updates. Try again later.'
    });
  }

  const listeners = [
    ['checking-for-update', onChecking],
    ['update-available', onAvailable],
    ['download-progress', onProgress],
    ['update-downloaded', onDownloaded],
    ['update-not-available', onCurrent],
    ['error', onError]
  ];
  listeners.forEach(([event, listener]) => updater.on(event, listener));

  async function check() {
    if (!supported) return getState();
    if (state.status === 'checking' || state.status === 'downloading') return getState();
    onChecking();
    try {
      await updater.checkForUpdates();
    } catch {
      onError();
    }
    return getState();
  }

  function start() {
    if (!supported || delayTimer !== null) return;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    delayTimer = setTimeoutFn(() => check(), UPDATE_CHECK_DELAY_MS);
    intervalTimer = setIntervalFn(() => check(), UPDATE_CHECK_INTERVAL_MS);
  }

  function install() {
    if (!supported || state.status !== 'ready') {
      return { ok: false, message: 'No downloaded update is ready to install.' };
    }
    updater.quitAndInstall(false, true);
    return { ok: true };
  }

  function dispose() {
    if (delayTimer !== null) clearTimeoutFn(delayTimer);
    if (intervalTimer !== null) clearIntervalFn(intervalTimer);
    delayTimer = null;
    intervalTimer = null;
    if (typeof updater.off === 'function') {
      listeners.forEach(([event, listener]) => updater.off(event, listener));
    }
  }

  return { start, check, install, getState, dispose };
}

module.exports = { canAutoUpdate, createUpdateManager };
