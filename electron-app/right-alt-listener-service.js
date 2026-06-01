const { spawn, spawnSync } = require('child_process');
const os = require('os');
const path = require('path');
const { createRightAltRelay } = require('./right-alt-relay');

function createRightAltListenerService({
  emitKeyboardState,
  handleEscapeKeydown = () => undefined,
  createRelay = createRightAltRelay,
  rightAltListenerPath = () => '',
  macosOptionListenerPath = () => '',
  macosOptionListenerExecutablePath = () => '',
  clangExecutablePath = () => '/usr/bin/clang',
  processPlatform = process.platform,
  processEnv = process.env,
  spawnProcess = spawn,
  spawnSyncProcess = spawnSync,
  debugLog = () => undefined,
} = {}) {
  let rightAltRelay = null;
  let rightAltListener = null;
  let rightAltListenerStdout = '';

  function getRightAltRelay() {
    if (rightAltRelay) return rightAltRelay;

    rightAltRelay = createRelay({
      emitKeyboardState,
      setTimer: setTimeout,
      clearTimer: clearTimeout,
      now: () => Date.now(),
      debugLog,
    });

    return rightAltRelay;
  }

  function handleListenerLine(line) {
    if (!line.trim()) return;

    try {
      const payload = JSON.parse(line);
      debugLog('right-alt-listener:payload', payload);
      if (payload.key === 'Escape') {
        if (payload.isKeydown) {
          handleEscapeKeydown(payload);
        }
        return;
      }
      getRightAltRelay().handlePayload(payload);
    } catch (error) {
      console.error('Right Alt 监听器输出解析失败:', error);
    }
  }

  function attachListenerProcess(child, errorLabel) {
    rightAltListener = child;
    rightAltListener.stdout.on('data', (chunk) => {
      rightAltListenerStdout += chunk.toString('utf8');
      const lines = rightAltListenerStdout.split(/\r?\n/);
      rightAltListenerStdout = lines.pop() || '';
      lines.forEach(handleListenerLine);
    });

    rightAltListener.stderr.on('data', (chunk) => {
      console.error(`${errorLabel}: ${chunk.toString('utf8').trim()}`);
    });

    rightAltListener.on('exit', () => {
      rightAltListener = null;
      rightAltListenerStdout = '';
    });
  }

  function startWindowsListener() {
    if (rightAltListener && !rightAltListener.killed) return true;

    const child = spawnProcess('powershell.exe', [
      '-NoProfile',
      '-ExecutionPolicy',
      'Bypass',
      '-WindowStyle',
      'Hidden',
      '-File',
      rightAltListenerPath(),
    ], {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      env: {
        SystemRoot: processEnv.SystemRoot,
        PATH: processEnv.PATH,
        TEMP: processEnv.TEMP,
        TMP: processEnv.TMP,
        USERPROFILE: processEnv.USERPROFILE,
        APPDATA: processEnv.APPDATA,
      },
    });

    attachListenerProcess(child, 'Right Alt 监听器错误');
    return true;
  }

  function macosListenerBinaryPath() {
    const configuredPath = macosOptionListenerExecutablePath();
    if (configuredPath) return configuredPath;
    return path.join(processEnv.TMPDIR || os.tmpdir(), 'speakmore-macos-option-listener');
  }

  function compileMacosListener() {
    const outputPath = macosListenerBinaryPath();
    const result = spawnSyncProcess(clangExecutablePath(), [
      '-framework',
      'ApplicationServices',
      macosOptionListenerPath(),
      '-o',
      outputPath,
    ], {
      encoding: 'utf8',
      env: { ...processEnv },
    });

    if (result.error) {
      console.error('Option 监听器编译失败:', result.error);
      return '';
    }
    if (result.status !== 0) {
      console.error('Option 监听器编译失败:', (result.stderr || '').trim());
      return '';
    }
    return outputPath;
  }

  function startMacosListener() {
    if (rightAltListener && !rightAltListener.killed) return true;

    const binaryPath = compileMacosListener();
    if (!binaryPath) return false;

    const child = spawnProcess(binaryPath, [], {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...processEnv },
    });

    attachListenerProcess(child, 'Option 监听器错误');
    return true;
  }

  function start() {
    if (processPlatform === 'win32') return startWindowsListener();
    if (processPlatform === 'darwin') return startMacosListener();
    return false;
  }

  function stop() {
    if (!rightAltListener || rightAltListener.killed) return;
    rightAltListener.kill();
    rightAltListener = null;
  }

  function dispose() {
    if (rightAltRelay) {
      rightAltRelay.dispose();
      rightAltRelay = null;
    }
    stop();
  }

  return {
    getRightAltRelay,
    handleListenerLine,
    start,
    stop,
    dispose,
  };
}

module.exports = {
  createRightAltListenerService,
};
