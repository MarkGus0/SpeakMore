/**
 * 文本观察 helper 桥接
 *
 * 需要理解自动学习如何监听本轮粘贴后的文本修改，以及 helper 失效时如何降级时看这里。
 */
const { spawn } = require('child_process');
const path = require('path');
const { createTextObservationSessionManager } = require('./text-observation-session');

function createTextObserverService({
  exePath = '',
  processPlatform = process.platform,
  processEnv = process.env,
  spawnProcess = spawn,
  fileExists = () => true,
  dotnetRoot = '',
  createSessionManager = createTextObservationSessionManager,
  learnCorrection = async () => undefined,
  emitDictionaryChanged = () => undefined,
  macosPlatformCapabilities = null,
  logger = console,
  timeoutMs = 120000,
  startResponseTimeoutMs = 3000,
  macosPollIntervalMs = 800,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  now = () => new Date().toISOString(),
} = {}) {
  let textObserverProcess = null;
  let textObserverStdoutBuffer = '';
  let macosObservation = null;
  const pendingStartResponses = new Map();

  function log(level, message, details = {}) {
    logger?.[level]?.(`[auto-learning][observer] ${message}`, details);
  }

  // helper 是可替换的短链路依赖；管道断开后必须清空引用，避免后续继续写入坏 stdin。
  function clearTextObserverProcess(child = textObserverProcess) {
    if (child && child === textObserverProcess) {
      log('info', '清空 helper 进程引用', {
        pid: child.pid || null,
      });
      textObserverProcess = null;
      textObserverStdoutBuffer = '';
    }
  }

  function resolvePendingStartResponse(audioId, result) {
    const pending = pendingStartResponses.get(audioId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    pendingStartResponses.delete(audioId);
    pending.resolve(result);
    return true;
  }

  function waitForStartResponse(audioId) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingStartResponses.delete(audioId);
        const result = { success: false, code: 'native_observer_start_timeout' };
        log('warn', '等待 helper observe-started 超时', {
          audioId,
          timeoutMs: startResponseTimeoutMs,
          result,
        });
        resolve(result);
      }, startResponseTimeoutMs);
      pendingStartResponses.set(audioId, { resolve, timer });
    });
  }

  // helper 只通过 stdout 回传 JSON 行；只有 observed-text 会进入自动学习，其它响应仅作为握手状态。
  function handleTextObserverLine(line) {
    log('info', '收到 helper stdout 行', { line });
    try {
      const message = JSON.parse(line);
      log('info', '解析 helper stdout 成功', { message });
      if (message.type === 'observe-started') {
        const result = message.success
          ? { success: true }
          : { success: false, code: message.code || 'native_observation_failed' };
        const matched = resolvePendingStartResponse(message.audioId, result);
        log(matched ? 'info' : 'warn', '收到 helper observe-started 响应', {
          message,
          matched,
          result,
        });
        return;
      }
      if (message.type === 'observed-text') {
        void textObservationManager.handleObservedText(message);
        return;
      }
      log('info', '收到 helper 非 observed-text 响应', { message });
    } catch (error) {
      log('error', '解析文本观察 helper 消息失败', { line, error });
    }
  }

  // Windows 子进程可能还活着，但 stdin 已经关闭；写入前同时检查进程和管道状态，避免 EPIPE 冒泡到主进程。
  function isTextObserverProcessUsable(child) {
    return Boolean(
      child
      && !child.killed
      && child.stdin
      && child.stdin.writable
      && !child.stdin.destroyed
      && !child.stdin.closed,
    );
  }

  function buildTextObserverEnv() {
    const env = { ...processEnv };
    if (dotnetRoot && fileExists(dotnetRoot)) {
      const pathDelimiter = processPlatform === 'win32' ? ';' : path.delimiter;
      env.DOTNET_ROOT = dotnetRoot;
      env['DOTNET_ROOT(x64)'] = dotnetRoot;
      env.PATH = [dotnetRoot, env.PATH].filter(Boolean).join(pathDelimiter);
      log('info', '已为 helper 注入本地 dotnet runtime', {
        dotnetRoot,
        hasPath: Boolean(env.PATH),
      });
    } else {
      log('warn', '本地 dotnet runtime 不存在，helper 将依赖系统 .NET', {
        dotnetRoot,
      });
    }
    return env;
  }

  function ensureTextObserverProcess() {
    // 文本观察依赖 Windows UI Automation；非 Windows 平台不启动 helper，自动学习自然降级。
    if (processPlatform !== 'win32') {
      log('info', '当前平台非 Windows，跳过 helper 启动', { processPlatform });
      return null;
    }
    if (isTextObserverProcessUsable(textObserverProcess)) {
      log('info', '复用已有 helper 进程', { pid: textObserverProcess.pid || null });
      return textObserverProcess;
    }
    clearTextObserverProcess();
    if (!exePath || !fileExists(exePath)) {
      log('warn', 'helper 可执行文件缺失，无法启动', { exePath });
      return null;
    }

    // helper 常驻复用，避免每次粘贴都拉起 .NET 进程；失败时由事件监听清理并在下次需要时重建。
    textObserverProcess = spawnProcess(exePath, [], {
      windowsHide: true,
      env: buildTextObserverEnv(),
    });
    const child = textObserverProcess;
    log('info', '启动 helper 进程', {
      exePath,
      pid: child.pid || null,
    });
    textObserverStdoutBuffer = '';
    child.stdout?.setEncoding?.('utf8');
    child.stdout?.on?.('data', (chunk) => {
      log('info', '收到 helper stdout chunk', { chunk });
      textObserverStdoutBuffer += chunk;
      const lines = textObserverStdoutBuffer.split(/\r?\n/);
      textObserverStdoutBuffer = lines.pop() || '';
      lines.filter(Boolean).forEach(handleTextObserverLine);
    });
    child.stderr?.setEncoding?.('utf8');
    child.stderr?.on?.('data', (chunk) => {
      const lines = String(chunk || '').split(/\r?\n/).filter(Boolean);
      for (const line of lines) {
        log('info', '收到 helper stderr 行', { line });
      }
    });
    // helper 退出或管道关闭只代表本轮观察不可用，不能影响录音、粘贴和主窗口。
    child.stdin?.on?.('error', (error) => {
      log('error', '文本观察 helper stdin 错误', { pid: child.pid || null, error });
      clearTextObserverProcess(child);
    });
    child.stdin?.on?.('close', () => {
      log('info', '文本观察 helper stdin 关闭', { pid: child.pid || null });
      clearTextObserverProcess(child);
    });
    child.on?.('error', (error) => {
      log('error', '文本观察 helper 进程错误', { pid: child.pid || null, error });
      clearTextObserverProcess(child);
    });
    child.on?.('exit', (code, signal) => {
      log('info', '文本观察 helper 退出', { pid: child.pid || null, code, signal });
      clearTextObserverProcess(child);
    });
    return child;
  }

  function sendTextObserverMessage(message) {
    const child = ensureTextObserverProcess();
    if (!isTextObserverProcessUsable(child)) {
      log('warn', 'helper 不可用，跳过消息发送', { message });
      return false;
    }
    try {
      // 每条消息独占一行，和 helper 的 Console.In.ReadLine 协议保持一致。
      log('info', '写入 helper stdin', { message });
      child.stdin.write(`${JSON.stringify(message)}\n`);
    } catch (error) {
      log('error', '文本观察 helper 写入失败', { message, error });
      clearTextObserverProcess(child);
      return false;
    }
    log('info', 'helper stdin 写入成功', { message });
    return true;
  }

  function clearMacosObservation(reason = 'stopped') {
    const observation = macosObservation;
    macosObservation = null;
    if (observation?.timer) clearTimer(observation.timer);
    if (observation) {
      log('info', '清理 macOS 文本观察', {
        audioId: observation.audioId,
        reason,
      });
    }
  }

  function scheduleMacosPoll(observation) {
    observation.timer = setTimer(() => {
      void pollMacosObservedText(observation);
    }, Math.max(50, Number(macosPollIntervalMs) || 800));
  }

  async function pollMacosObservedText(observation) {
    if (macosObservation !== observation) return;
    if (observation.reading) {
      scheduleMacosPoll(observation);
      return;
    }

    observation.reading = true;
    try {
      const result = await macosPlatformCapabilities.getFocusedTextForObservation({
        startFocusInfo: observation.focusInfo,
      });

      if (!result?.success) {
        log('info', 'macOS 观察目标不可用，停止本轮观察', {
          audioId: observation.audioId,
          result,
        });
        await textObservationManager.stop(result?.reason || 'macos_observation_unavailable');
        return;
      }

      const text = String(result.text || '').trim();
      if (text && text !== observation.lastText) {
        observation.lastText = text;
        await textObservationManager.handleObservedText({
          type: 'observed-text',
          audioId: observation.audioId,
          text,
        });
      }
    } catch (error) {
      log('info', 'macOS 文本观察读取异常，停止本轮观察', {
        audioId: observation.audioId,
        error: error instanceof Error ? error.message : String(error),
      });
      await textObservationManager.stop('macos_observation_read_failed');
      return;
    } finally {
      observation.reading = false;
    }

    if (macosObservation === observation) scheduleMacosPoll(observation);
  }

  async function startMacosTextObservation(session) {
    clearMacosObservation('replaced');
    if (!macosPlatformCapabilities || typeof macosPlatformCapabilities.getFocusedTextForObservation !== 'function') {
      log('info', 'macOS 文本观察能力不可用', {
        audioId: session.audioId,
      });
      return { success: false, code: 'native_observer_unavailable' };
    }

    const initial = await macosPlatformCapabilities.getFocusedTextForObservation({
      startFocusInfo: session.focusInfo,
    });
    if (!initial?.success) {
      log('info', 'macOS 文本观察启动失败', {
        audioId: session.audioId,
        result: initial,
      });
      return { success: false, code: initial?.reason || 'native_observer_unavailable' };
    }

    macosObservation = {
      audioId: session.audioId,
      pastedText: session.pastedText,
      focusInfo: session.focusInfo || null,
      lastText: String(initial.text || '').trim(),
      reading: false,
      timer: null,
    };
    log('info', 'macOS 文本观察启动成功', {
      audioId: session.audioId,
      textLength: macosObservation.lastText.length,
    });
    scheduleMacosPoll(macosObservation);
    return { success: true };
  }

  const textObservationManager = createSessionManager({
    startNativeObservation: async (session) => {
      if (processPlatform === 'darwin') {
        return startMacosTextObservation(session);
      }

      // pastedText 是本轮 SpeakMore 自动粘贴的结果，后续只允许围绕这段文本识别用户修正。
      log('info', '启动原生观察', {
        audioId: session.audioId,
        pastedText: session.pastedText,
        timeoutMs: session.timeoutMs,
      });
      const startResponse = waitForStartResponse(session.audioId);
      const sent = sendTextObserverMessage({
        type: 'observe-start',
        audioId: session.audioId,
        pastedText: session.pastedText,
        timeoutMs: session.timeoutMs,
      });
      if (!sent) {
        resolvePendingStartResponse(session.audioId, {
          success: false,
          code: 'native_observer_unavailable',
        });
      }
      const result = await startResponse;
      log('info', '原生观察启动返回', {
        audioId: session.audioId,
        result,
      });
      return result;
    },
    stopNativeObservation: async (session) => {
      if (processPlatform === 'darwin') {
        clearMacosObservation(session.reason);
        return;
      }

      // 停止失败不需要向上抛；观察窗口结束后 helper 失效只会影响自动学习，不影响用户已得到的文本结果。
      log('info', '停止原生观察', {
        audioId: session.audioId,
        reason: session.reason,
      });
      sendTextObserverMessage({ type: 'observe-stop', audioId: session.audioId });
    },
    learnCorrection: async (candidate) => {
      log('info', '进入词典学习', { candidate });
      const result = await learnCorrection(candidate);
      // 页面只关心词典结果发生变化，不展示学习过程；promoted 用于区分候选刷新和正式词条刷新。
      emitDictionaryChanged({
        reason: result?.promotedEntry ? 'auto-learning-promoted' : 'auto-learning-candidate',
      });
      log('info', '词典学习完成', {
        candidate,
        result,
      });
      return result;
    },
    now,
    timeoutMs,
    logger,
  });

  return {
    textObservationManager,
    ensureTextObserverProcess,
    sendTextObserverMessage,
    getProcess: () => textObserverProcess,
    getMacosObservation: () => macosObservation,
  };
}

module.exports = {
  createTextObserverService,
};
