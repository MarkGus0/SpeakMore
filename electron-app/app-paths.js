const path = require('path');

function createAppPaths({
  baseDir = __dirname,
  getUserDataPath = () => '',
} = {}) {
  function localDataDir() {
    return path.join(getUserDataPath(), 'local-data');
  }

  function localDataPath(fileName) {
    return path.join(localDataDir(), fileName);
  }

  function extractedPath(...segments) {
    return path.join(baseDir, '..', 'app-extracted', ...segments);
  }

  return {
    localDataDir,
    localDataPath,
    logFilePath: () => localDataPath('recording.log'),
    recordingsDir: () => localDataPath('recordings'),
    preloadPath: () => path.join(baseDir, 'preload.js'),
    iconPath: () => extractedPath('build', 'icons', 'png', '32x32.png'),
    trayIconPath: () => path.join(baseDir, 'assets', 'tray-placeholder.png'),
    rightAltListenerPath: () => path.join(baseDir, 'right-alt-listener.ps1'),
    audioSessionControlPath: () => path.join(baseDir, 'audio-session-control.ps1'),
    textObserverExecutablePath: () => path.join(baseDir, 'windows-text-observer', 'bin', 'Debug', 'net8.0-windows', 'WindowsTextObserver.exe'),
    dotnetRootPath: () => path.join(baseDir, '..', '.tmp-dotnet'),
    extractedPath,
    extractedRendererPath: (fileName) => extractedPath('dist', 'renderer', fileName),
  };
}

module.exports = {
  createAppPaths,
};
