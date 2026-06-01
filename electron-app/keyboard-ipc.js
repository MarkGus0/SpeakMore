/**
 * 键盘粘贴 IPC
 *
 * 需要理解语音结果如何自动粘贴、剪贴板如何恢复，以及自动学习观察何时启动时看这里。
 */
const { spawn } = require('child_process');

function registerKeyboardIpcHandlers({
  ipcMain,
  clipboard,
  spawnProcess = spawn,
  readFocusedTextTarget,
  createClipboardSnapshot,
  restoreClipboardSnapshot,
  readFocusedInfo,
  textObservationManager,
  macosPlatformCapabilities = null,
  platform = process.platform,
  randomUUID = () => require('crypto').randomUUID(),
  processEnv = process.env,
  logger = console,
} = {}) {
  function log(level, message, details = {}) {
    logger?.[level]?.(`[auto-learning][keyboard] ${message}`, details);
  }

  // 这些依赖都由 main.js 注入；启动期直接失败比运行到半截静默丢结果更容易定位接线问题。
  if (!ipcMain || typeof ipcMain.handle !== 'function') {
    throw new Error('ipcMain is required');
  }
  if (!clipboard || typeof clipboard.writeText !== 'function') {
    throw new Error('clipboard.writeText is required');
  }
  if (typeof readFocusedTextTarget !== 'function' || typeof createClipboardSnapshot !== 'function' || typeof restoreClipboardSnapshot !== 'function' || typeof readFocusedInfo !== 'function') {
    throw new Error('keyboard dependencies are required');
  }
  if (!textObservationManager || typeof textObservationManager.start !== 'function') {
    throw new Error('textObservationManager.start is required');
  }

  async function startWindowsTextObservation(pastedText) {
    const focusInfo = await readFocusedInfo();
    log('info', '读取当前焦点信息完成', {
      pastedText,
      focusInfo,
    });
    try {
      const observationResult = await textObservationManager.start({
        audioId: randomUUID(),
        pastedText,
        focusInfo,
      });
      log('info', '观察会话启动结果', {
        pastedText,
        observationResult,
      });
    } catch (error) {
      // 自动学习是粘贴后的后台能力；失败不能影响用户已经拿到的文本结果。
      log('info', '观察会话启动异常，已静默结束', {
        pastedText,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function pasteWithWindowsSendKeys(pastedText, startFocusInfo) {
    log('info', '开始检查焦点目标', { startFocusInfo });
    const textTarget = await readFocusedTextTarget({ startFocusInfo });
    log('info', '焦点目标检查结果', { textTarget });
    if (!textTarget.success) {
      log('warn', '焦点目标不可用，终止自动粘贴', { textTarget, pastedText });
      return { success: false, reason: textTarget.reason || 'focused_text_target_unavailable' };
    }

    // 自动粘贴必须临时借用系统剪贴板；先做快照，才能在 finally 中尽量恢复用户原本的剪贴板内容。
    const previousClipboard = createClipboardSnapshot(clipboard);
    log('info', '已创建剪贴板快照', {
      pastedText,
      target: textTarget,
    });
    let restoreFailed = false;

    try {
      clipboard.writeText(pastedText);
      log('info', '已写入系统剪贴板', { pastedText });
      // Electron 主进程不能直接把文本写进任意第三方输入框；这里使用系统 SendKeys 模拟 Ctrl+V。
      // 100ms 延迟给目标应用一点时间接收焦点，减少刚切回输入框时粘贴丢失的概率。
      log('info', '准备调用 SendKeys', {
        pastedText,
        processEnv: {
          hasSystemRoot: Boolean(processEnv.SystemRoot),
          hasPath: Boolean(processEnv.PATH),
          hasTemp: Boolean(processEnv.TEMP),
          hasTmp: Boolean(processEnv.TMP),
        },
      });
      const ps = spawnProcess('powershell.exe', [
        '-NoProfile', '-Command',
        'Add-Type -AssemblyName System.Windows.Forms; Start-Sleep -Milliseconds 100; [System.Windows.Forms.SendKeys]::SendWait("^v")',
      ], {
        windowsHide: true,
        env: {
          SystemRoot: processEnv.SystemRoot,
          PATH: processEnv.PATH,
          TEMP: processEnv.TEMP,
          TMP: processEnv.TMP,
        },
      });
      // SendKeys 只能告诉我们命令是否执行完成，不能证明目标应用实际接收了全部文本；失败时直接返回给 renderer 走兜底展示。
      log('info', 'SendKeys 子进程已启动', { pastedText });
      const pasteSucceeded = await new Promise((resolve) => {
        ps.on('exit', (code, signal) => {
          log('info', 'SendKeys 子进程退出', { code, signal, pastedText });
          resolve(code === 0);
        });
        ps.on('error', (error) => {
          log('error', 'SendKeys 子进程错误', { error, pastedText });
          resolve(false);
        });
      });
      log('info', 'SendKeys 执行结果', { pasteSucceeded, pastedText });
      if (pasteSucceeded && pastedText.trim()) {
        // 自动学习当前只接 Windows UIA 文本观察，macOS 后续阶段单独实现。
        await startWindowsTextObservation(pastedText);
      }
      return { success: pasteSucceeded };
    } finally {
      // 恢复剪贴板放在 finally，确保粘贴失败、观察启动失败或 PowerShell 异常时也不会长期占用用户剪贴板。
      try {
        restoreClipboardSnapshot(clipboard, previousClipboard);
        log('info', '已恢复剪贴板', { pastedText });
      } catch {
        restoreFailed = true;
        log('error', '恢复剪贴板失败', { pastedText });
      }

      if (restoreFailed) {
        logger.warn?.('自动粘贴后恢复剪贴板失败');
      }
    }
  }

  async function pasteWithMacos(pastedText, startFocusInfo) {
    if (!macosPlatformCapabilities || typeof macosPlatformCapabilities.pasteText !== 'function') {
      return { success: false, reason: 'macos_auto_paste_unavailable' };
    }

    const result = await macosPlatformCapabilities.pasteText(pastedText, { startFocusInfo });
    log(result?.success ? 'info' : 'warn', 'macOS 自动粘贴结果', {
      pastedText,
      result,
    });
    return result;
  }

  // 自动粘贴的唯一主进程入口。renderer 只提交最终文本，是否真的能粘贴由主进程基于当前焦点环境判断。
  ipcMain.handle('keyboard:type-transcript', async (_, text, pasteContext = {}) => {
    const pastedText = String(text || '');
    log('info', '收到转写结果', {
      pastedText,
      length: pastedText.length,
      pasteContext,
    });
    if (!pastedText) return false;

    // 录音开始前记录的焦点信息用于防止焦点漂移；如果当前目标已经不是可信输入框，就不能误发粘贴快捷键。
    const startFocusInfo = pasteContext && typeof pasteContext === 'object'
      ? pasteContext.startFocusInfo || null
      : null;

    if (platform === 'darwin') {
      return pasteWithMacos(pastedText, startFocusInfo);
    }

    if (platform !== 'win32') {
      return { success: false, reason: 'auto_paste_unsupported_platform' };
    }

    return pasteWithWindowsSendKeys(pastedText, startFocusInfo);
  });
}

module.exports = {
  registerKeyboardIpcHandlers,
};
