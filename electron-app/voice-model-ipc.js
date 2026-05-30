function registerVoiceModelIpcHandlers({
  ipcMain,
  ensureVoiceBackendStarted,
  getVoiceModelStatus,
  startVoiceModelDownload,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (typeof ensureVoiceBackendStarted !== 'function') {
    throw new Error('ensureVoiceBackendStarted is required');
  }
  if (typeof getVoiceModelStatus !== 'function' || typeof startVoiceModelDownload !== 'function') {
    throw new Error('voice model client methods are required');
  }

  ipcMain.handle('voice-model:get-status', async () => {
    const startResult = await ensureVoiceBackendStarted();
    if (startResult?.success === false) return startResult;
    return getVoiceModelStatus();
  });

  ipcMain.handle('voice-model:start-download', async () => {
    const startResult = await ensureVoiceBackendStarted();
    if (startResult?.success === false) return startResult;
    return startVoiceModelDownload();
  });
}

module.exports = {
  registerVoiceModelIpcHandlers,
};
