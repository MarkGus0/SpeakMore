function registerPermissionIpcHandlers({
  ipcMain,
} = {}) {
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }

  ipcMain.handle('permission:request', () => true);
  ipcMain.handle('permission:check-with-child-process', () => true);
  ipcMain.handle('permission:reset-accessibility-permission', () => true);
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
