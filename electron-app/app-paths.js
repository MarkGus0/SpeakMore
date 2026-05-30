const path = require('path');

function createAppPaths({
  baseDir = __dirname,
  resourcesPath = path.join(baseDir, '..'),
  isPackaged = false,
  getUserDataPath = () => '',
} = {}) {
  function localDataDir() {
    return path.join(getUserDataPath(), 'local-data');
  }

  function localDataPath(fileName) {
    return path.join(localDataDir(), fileName);
  }

  function resourcePath(...segments) {
    if (isPackaged) return path.join(resourcesPath, ...segments);
    return path.join(baseDir, ...segments);
  }

  function packagedResourcePath(...segments) {
    return isPackaged
      ? path.join(resourcesPath, ...segments)
      : path.join(baseDir, '..', 'release-artifacts', ...segments);
  }

  function unpackedAppPath(...segments) {
    const unpackedBaseDir = isPackaged
      ? baseDir.replace(`${path.sep}app.asar${path.sep}`, `${path.sep}app.asar.unpacked${path.sep}`)
      : baseDir;
    return path.join(unpackedBaseDir, ...segments);
  }

  return {
    localDataDir,
    localDataPath,
    logFilePath: () => localDataPath('recording.log'),
    recordingsDir: () => localDataPath('recordings'),
    preloadPath: () => path.join(baseDir, 'preload.js'),
    iconPath: () => packagedResourcePath('assets', 'tray-placeholder.png'),
    trayIconPath: () => packagedResourcePath('assets', 'tray-placeholder.png'),
    rightAltListenerPath: () => unpackedAppPath('right-alt-listener.ps1'),
    audioSessionControlPath: () => unpackedAppPath('audio-session-control.ps1'),
    backendExecutablePath: () => packagedResourcePath('backend', 'speakmore-backend.exe'),
    ffmpegExecutablePath: () => packagedResourcePath('ffmpeg', 'bin', 'ffmpeg.exe'),
    textObserverExecutablePath: () => packagedResourcePath('helper', 'WindowsTextObserver.exe'),
    dotnetRootPath: () => packagedResourcePath('dotnet'),
    resourcePath,
    packagedResourcePath,
    unpackedAppPath,
  };
}

module.exports = {
  createAppPaths,
};
