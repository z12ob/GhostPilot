const { contextBridge, ipcRenderer } = require('electron');
const platform = process.platform;

contextBridge.exposeInMainWorld('ghostPilot', {
  platform,
  settingsGet: () => ipcRenderer.invoke('settings:get'),
  settingsSet: (patch) => ipcRenderer.invoke('settings:set', patch),
  whisperModels: () => ipcRenderer.invoke('whisper:models'),
  whisperModelDownload: (modelId) => ipcRenderer.invoke('whisper:model-download', modelId),
  whisperModelCancel: (modelId) => ipcRenderer.invoke('whisper:model-cancel', modelId),
  whisperModelDelete: (modelId) => ipcRenderer.invoke('whisper:model-delete', modelId),
  whisperModelImport: (modelId) => ipcRenderer.invoke('whisper:model-import', modelId),
  platformInfo: () => ipcRenderer.invoke('platform:info'),
  ask: (payload) => ipcRenderer.send('ask', payload),
  captureToggle: () => ipcRenderer.invoke('capture:toggle').catch((err) => {
    console.error('[GhostPilot] captureToggle error', err);
    return false;
  }),
  captureState: () => ipcRenderer.invoke('capture:state'),
  micPcm: (arrayBuffer) => ipcRenderer.send('mic:pcm', arrayBuffer),
  systemPcm: (arrayBuffer) => ipcRenderer.send('system:pcm', arrayBuffer),
  setInteractiveRegions: (regions) => ipcRenderer.send('mouse:regions', regions),
  clearTranscript: () => ipcRenderer.invoke('transcript:clear'),
  sessionGet: () => ipcRenderer.invoke('session:get'),
  sessionTranscriptText: () => ipcRenderer.invoke('session:transcript-text'),
  sessionOpenFolder: () => ipcRenderer.invoke('session:open-folder'),
  updateState: () => ipcRenderer.invoke('update:get-state'),
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  moveStart: (point) => ipcRenderer.send('window:move-start', point),
  moveTo: (point) => ipcRenderer.send('window:move-to', point),
  moveEnd: (point) => ipcRenderer.send('window:move-end', point),
  resizeStart: (point, edge) => ipcRenderer.send('window:resize-start', point, edge),
  resizeTo: (point) => ipcRenderer.send('window:resize-to', point),
  resizeEnd: (point) => ipcRenderer.send('window:resize-end', point),
  openPane: (url) => ipcRenderer.send('open-pane', url),
  pickProfileDocument: () => ipcRenderer.invoke('profile:pickDocument'),
  quit: () => ipcRenderer.invoke('app:quit'),
  permissionsCheck: () => ipcRenderer.invoke('permissions:check'),
  permissionsRequest: () => ipcRenderer.invoke('permissions:request'),
  permissionsContinue: () => ipcRenderer.send('permissions:continue'),
  log: (msg) => ipcRenderer.send('log', msg),
  on: (channel, cb) => {
    const allowed = ['capture:state', 'llm:start', 'llm:token', 'llm:done', 'llm:error', 'status', 'transcript', 'stt:interim', 'stt:final', 'stt:status', 'vad:state', 'hide:toggle', 'quit:request', 'whisper:download-progress', 'whisper:models-changed', 'session:state', 'update:state'];
    if (!allowed.includes(channel)) return;
    ipcRenderer.on(channel, (_e, data) => cb(data));
  }
});
