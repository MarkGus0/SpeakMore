function registerPermissionIpcHandlers({
  ipcMain,
  macosPlatformCapabilities = null,
  processPlatform = process.platform,
  systemPreferences = null,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }

  function isMacOS() {
    return processPlatform === 'darwin';
  }

  function macosCapabilityUnavailable() {
    return {
      success: false,
      source: 'macos_platform',
      confidence: 'none',
      reason: isMacOS() ? 'macos_capability_unavailable' : 'not_macos',
    };
  }

  function readMacOSAppAccessibilityStatus() {
    if (!isMacOS() || typeof systemPreferences?.isTrustedAccessibilityClient !== 'function') {
      return null;
    }

    try {
      const trusted = systemPreferences.isTrustedAccessibilityClient(false);
      return {
        success: true,
        source: 'electron_system_preferences',
        confidence: trusted ? 'confirmed' : 'none',
        trusted,
        reason: trusted ? 'accessibility_trusted' : 'macos_accessibility_permission_missing',
      };
    } catch (error) {
      return {
        success: false,
        source: 'electron_system_preferences',
        confidence: 'none',
        trusted: false,
        reason: 'macos_accessibility_status_failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }
  }

  ipcMain.handle('permission:request', () => true);
  ipcMain.handle('permission:check-with-child-process', () => true);
  ipcMain.handle('permission:reset-accessibility-permission', () => true);
  ipcMain.handle('permission:macos-accessibility-status', () => {
    const appStatus = readMacOSAppAccessibilityStatus();
    if (appStatus?.success) return appStatus;

    if (!isMacOS() || !macosPlatformCapabilities?.getAccessibilityStatus) {
      return appStatus || macosCapabilityUnavailable();
    }
    return macosPlatformCapabilities.getAccessibilityStatus();
  });
  ipcMain.handle('permission:open-macos-accessibility-settings', () => {
    if (!isMacOS() || !macosPlatformCapabilities?.openAccessibilitySettings) {
      return macosCapabilityUnavailable();
    }
    return macosPlatformCapabilities.openAccessibilitySettings();
  });
  ipcMain.handle('permission:macos-platform-diagnostics', (_, payload = {}) => {
    if (!isMacOS() || !macosPlatformCapabilities?.getDiagnostics) {
      return macosCapabilityUnavailable();
    }
    return macosPlatformCapabilities.getDiagnostics({
      includeClipboard: Boolean(payload?.includeClipboard),
      includeEventInjection: Boolean(payload?.includeEventInjection),
    });
  });
  ipcMain.handle('permission:update-auto-launch', () => {
    // 自动启动功能暂时停用，恢复时需要补系统真实状态读取和失败回滚。
    // app.setLoginItemSettings({ openAtLogin: Boolean(payload.enable), path: process.execPath });
    return { success: false, skipped: true, code: 'auto_launch_disabled' };
  });
  ipcMain.handle('permission:update-show-app-in-dock', () => true);

  ipcMain.handle('updater:check-for-update', () => null);
  ipcMain.handle('updater:download-update', () => null);
  ipcMain.handle('updater:quit-and-install', () => null);
  ipcMain.handle('updater:check-update-and-download-silently', () => null);
}

module.exports = {
  registerPermissionIpcHandlers,
};
