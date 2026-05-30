const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createAppPaths } = require('./app-paths');

test('createAppPaths 生成本地数据和辅助路径', () => {
  const appPaths = createAppPaths({
    baseDir: 'C:\\repo\\SpeakMore\\electron-app',
    getUserDataPath: () => 'C:\\Users\\tester\\AppData\\Roaming\\SpeakMore',
  });

  assert.equal(appPaths.localDataDir(), path.join('C:\\Users\\tester\\AppData\\Roaming\\SpeakMore', 'local-data'));
  assert.equal(appPaths.localDataPath('settings.json'), path.join('C:\\Users\\tester\\AppData\\Roaming\\SpeakMore', 'local-data', 'settings.json'));
  assert.equal(appPaths.logFilePath(), path.join('C:\\Users\\tester\\AppData\\Roaming\\SpeakMore', 'local-data', 'recording.log'));
  assert.equal(appPaths.recordingsDir(), path.join('C:\\Users\\tester\\AppData\\Roaming\\SpeakMore', 'local-data', 'recordings'));
  assert.equal(appPaths.preloadPath(), path.join('C:\\repo\\SpeakMore\\electron-app', 'preload.js'));
  assert.equal(appPaths.iconPath(), path.join('C:\\repo\\SpeakMore\\release-artifacts', 'assets', 'tray-placeholder.png'));
  assert.equal(appPaths.trayIconPath(), path.join('C:\\repo\\SpeakMore\\release-artifacts', 'assets', 'tray-placeholder.png'));
  assert.equal(appPaths.rightAltListenerPath(), path.join('C:\\repo\\SpeakMore\\electron-app', 'right-alt-listener.ps1'));
  assert.equal(appPaths.audioSessionControlPath(), path.join('C:\\repo\\SpeakMore\\electron-app', 'audio-session-control.ps1'));
  assert.equal(appPaths.textObserverExecutablePath(), path.join('C:\\repo\\SpeakMore\\release-artifacts', 'helper', 'WindowsTextObserver.exe'));
  assert.equal(appPaths.dotnetRootPath(), path.join('C:\\repo\\SpeakMore\\release-artifacts', 'dotnet'));
});

test('createAppPaths 在打包态使用 resources 目录中的发布资源', () => {
  const appPaths = createAppPaths({
    baseDir: 'C:\\Program Files\\SpeakMore\\resources\\app.asar\\electron-app',
    resourcesPath: 'C:\\Program Files\\SpeakMore\\resources',
    isPackaged: true,
    getUserDataPath: () => 'C:\\Users\\tester\\AppData\\Roaming\\SpeakMore',
  });

  assert.equal(appPaths.iconPath(), path.join('C:\\Program Files\\SpeakMore\\resources', 'assets', 'tray-placeholder.png'));
  assert.equal(appPaths.trayIconPath(), path.join('C:\\Program Files\\SpeakMore\\resources', 'assets', 'tray-placeholder.png'));
  assert.equal(appPaths.backendExecutablePath(), path.join('C:\\Program Files\\SpeakMore\\resources', 'backend', 'speakmore-backend.exe'));
  assert.equal(appPaths.ffmpegExecutablePath(), path.join('C:\\Program Files\\SpeakMore\\resources', 'ffmpeg', 'bin', 'ffmpeg.exe'));
  assert.equal(appPaths.textObserverExecutablePath(), path.join('C:\\Program Files\\SpeakMore\\resources', 'helper', 'WindowsTextObserver.exe'));
  assert.equal(appPaths.rightAltListenerPath(), path.join('C:\\Program Files\\SpeakMore\\resources\\app.asar.unpacked\\electron-app', 'right-alt-listener.ps1'));
  assert.equal(appPaths.audioSessionControlPath(), path.join('C:\\Program Files\\SpeakMore\\resources\\app.asar.unpacked\\electron-app', 'audio-session-control.ps1'));
});
