function registerFocusedContextIpcHandlers({
  ipcMain,
  clipboard,
  readFocusedInfo,
  readSelectedTextByClipboard,
  readSelectionSnapshot,
  isSameFocusedContext,
  logger = console,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (typeof readFocusedInfo !== 'function' || typeof readSelectedTextByClipboard !== 'function' || typeof readSelectionSnapshot !== 'function') {
    throw new Error('focused context readers are required');
  }
  if (typeof isSameFocusedContext !== 'function') {
    throw new Error('isSameFocusedContext is required');
  }

  function summarizeTextResult(value = {}) {
    const text = typeof value.text === 'string' ? value.text.trim() : '';
    return {
      success: Boolean(value.success),
      source: typeof value.source === 'string' ? value.source : 'unknown',
      confidence: typeof value.confidence === 'string' ? value.confidence : 'unknown',
      reason: typeof value.reason === 'string' ? value.reason : '',
      selectionScope: typeof value.selectionScope === 'string' ? value.selectionScope : '',
      focusedReason: typeof value.focusedReason === 'string' ? value.focusedReason : '',
      foregroundScanned: Number.isFinite(Number(value.foregroundScanned)) ? Number(value.foregroundScanned) : null,
      hasText: Boolean(text),
      length: text.length,
      preview: text ? text.replace(/\s+/g, ' ').slice(0, 80) : '',
      appIdentifier: value.focusInfo?.appInfo?.app_identifier || '',
      windowTitle: value.focusInfo?.appInfo?.window_title || '',
    };
  }

  function logSelection(message, details = {}) {
    logger?.info?.(`[focused-context][selection] ${message}`, details);
  }

  ipcMain.handle('focused-context:get-last-focused-info', () => readFocusedInfo());
  ipcMain.handle('focused-context:get-selected-text', () => readSelectedTextByClipboard({ clipboard }));
  ipcMain.handle('focused-context:get-selection-snapshot', async () => {
    logSelection('IPC get-selection-snapshot 开始');
    const result = await readSelectionSnapshot({ clipboard, logger });
    logSelection('IPC get-selection-snapshot 返回', summarizeTextResult(result));
    return result;
  });
  ipcMain.handle('focused-context:is-current-focus', async (_, previousFocusInfo) => {
    const currentFocusInfo = await readFocusedInfo();
    return {
      success: true,
      same: isSameFocusedContext(previousFocusInfo, currentFocusInfo),
      currentFocusInfo,
    };
  });
  ipcMain.handle('focused-context:get-full-context', () => ({ success: true, data: null }));
}

module.exports = {
  registerFocusedContextIpcHandlers,
};
