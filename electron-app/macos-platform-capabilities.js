const { spawn, spawnSync } = require('child_process');
const os = require('os');
const path = require('path');
const {
  createClipboardSnapshot: defaultCreateClipboardSnapshot,
  restoreClipboardSnapshot: defaultRestoreClipboardSnapshot,
} = require('./focused-context/clipboard');
const {
  createEmptyFocusedInfo,
  normalizeFocusedInfo,
  normalizeFocusedTextTargetResult,
  normalizeUiaSelectionResult,
} = require('./focused-context/normalizers');

const ACCESSIBILITY_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
const DEFAULT_HELPER_TIMEOUT_MS = 3000;
const DEFAULT_PASTE_SETTLE_MS = 180;
const OBSERVATION_BOUNDS_TOLERANCE = 4;

function unavailable(reason = 'macos_capability_unavailable', detail = '') {
  return {
    success: false,
    source: 'macos_platform',
    confidence: 'none',
    reason,
    ...(detail ? { detail } : {}),
  };
}

function createMacosPlatformCapabilities({
  clipboard = null,
  createClipboardSnapshot = defaultCreateClipboardSnapshot,
  restoreClipboardSnapshot = defaultRestoreClipboardSnapshot,
  helperSourcePath = () => '',
  helperExecutablePath = () => '',
  clangExecutablePath = () => '/usr/bin/clang',
  processPlatform = process.platform,
  processEnv = process.env,
  shell = null,
  spawnProcess = spawn,
  spawnSyncProcess = spawnSync,
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  helperTimeoutMs = DEFAULT_HELPER_TIMEOUT_MS,
  pasteSettleMs = DEFAULT_PASTE_SETTLE_MS,
  logger = console,
} = {}) {
  let compiledHelperPath = '';

  function isMacOS() {
    return processPlatform === 'darwin';
  }

  function helperBinaryPath() {
    const configuredPath = helperExecutablePath();
    if (configuredPath) return configuredPath;
    return path.join(processEnv.TMPDIR || os.tmpdir(), 'speakmore-macos-platform-helper');
  }

  function compileHelper() {
    if (!isMacOS()) return unavailable();
    if (compiledHelperPath) return { success: true, path: compiledHelperPath };

    const sourcePath = helperSourcePath();
    if (!sourcePath) return unavailable('macos_helper_source_missing');

    const outputPath = helperBinaryPath();
    const result = spawnSyncProcess(clangExecutablePath(), [
      '-fobjc-arc',
      '-framework',
      'ApplicationServices',
      '-framework',
      'AppKit',
      '-framework',
      'Foundation',
      sourcePath,
      '-o',
      outputPath,
    ], {
      encoding: 'utf8',
      env: { ...processEnv },
    });

    if (result.error) {
      logger.error?.('macOS 平台 helper 编译失败:', result.error);
      return unavailable('macos_helper_compile_failed', result.error.message || String(result.error));
    }

    if (result.status !== 0) {
      const detail = (result.stderr || result.stdout || '').trim();
      logger.error?.('macOS 平台 helper 编译失败:', detail);
      return unavailable('macos_helper_compile_failed', detail);
    }

    compiledHelperPath = outputPath;
    return { success: true, path: outputPath };
  }

  function parseHelperOutput(stdout, stderr, command) {
    const text = String(stdout || '').trim();
    if (!text) {
      return unavailable('macos_helper_empty_output', String(stderr || '').trim());
    }

    try {
      return JSON.parse(text);
    } catch (error) {
      return unavailable('macos_helper_invalid_json', `${command}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  function wait(ms) {
    return new Promise((resolve) => {
      setTimer(resolve, Math.max(0, Number(ms) || 0));
    });
  }

  function hasFocusedTargetChanged(startFocusInfo, textTarget) {
    if (!startFocusInfo || typeof startFocusInfo !== 'object') return false;

    const metadata = startFocusInfo.appInfo?.app_metadata || {};
    const startBundleId = String(startFocusInfo.appInfo?.app_identifier || metadata.bundle_id || '');
    const currentBundleId = String(textTarget.foregroundHwnd || textTarget.appFamily || '');
    const startProcessId = String(metadata.process_id || '');
    const currentProcessId = String(textTarget.focusHwnd || '');

    if (startBundleId && currentBundleId && startBundleId !== currentBundleId) return true;
    if (startProcessId && currentProcessId && startProcessId !== currentProcessId) return true;
    return false;
  }

  function toFiniteNumber(value, fallback = 0) {
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function readElementBounds(value = {}) {
    const bounds = value && typeof value === 'object' ? value : {};
    return {
      x: toFiniteNumber(bounds.x),
      y: toFiniteNumber(bounds.y),
      width: toFiniteNumber(bounds.width),
      height: toFiniteNumber(bounds.height),
    };
  }

  function hasMeaningfulBounds(bounds) {
    return toFiniteNumber(bounds?.width) > 0 || toFiniteNumber(bounds?.height) > 0;
  }

  function isSameBounds(left, right) {
    const normalizedLeft = readElementBounds(left);
    const normalizedRight = readElementBounds(right);
    if (!hasMeaningfulBounds(normalizedLeft) || !hasMeaningfulBounds(normalizedRight)) return true;

    return Math.abs(normalizedLeft.x - normalizedRight.x) <= OBSERVATION_BOUNDS_TOLERANCE
      && Math.abs(normalizedLeft.y - normalizedRight.y) <= OBSERVATION_BOUNDS_TOLERANCE
      && Math.abs(normalizedLeft.width - normalizedRight.width) <= OBSERVATION_BOUNDS_TOLERANCE
      && Math.abs(normalizedLeft.height - normalizedRight.height) <= OBSERVATION_BOUNDS_TOLERANCE;
  }

  function hasObservationTargetChanged(startFocusInfo, observedTarget) {
    if (!startFocusInfo || typeof startFocusInfo !== 'object') return false;

    const metadata = startFocusInfo.appInfo?.app_metadata || {};
    const startBundleId = String(startFocusInfo.appInfo?.app_identifier || metadata.bundle_id || '');
    const currentBundleId = String(observedTarget.appIdentifier || observedTarget.appFamily || '');
    const startProcessId = String(metadata.process_id || '');
    const currentProcessId = String(observedTarget.processId || '');
    const startRole = String(startFocusInfo.elementInfo?.role || '');
    const currentRole = String(observedTarget.role || '');
    const startSubrole = String(startFocusInfo.elementInfo?.subrole || '');
    const currentSubrole = String(observedTarget.subrole || '');

    if (startBundleId && currentBundleId && startBundleId !== currentBundleId) return true;
    if (startProcessId && currentProcessId && startProcessId !== currentProcessId) return true;
    if (startRole && currentRole && startRole !== currentRole) return true;
    if (startSubrole && currentSubrole && startSubrole !== currentSubrole) return true;
    if (!isSameBounds(startFocusInfo.elementInfo?.bounds, observedTarget.bounds)) return true;
    return false;
  }

  function normalizeMacosSelectedTextResult(value) {
    if (!value || typeof value !== 'object') {
      return { success: false, text: '', source: 'none', confidence: 'none', reason: 'invalid_result' };
    }

    const normalized = normalizeUiaSelectionResult({
      ...value,
      source: value.source === 'macos_ax' ? 'uia' : value.source,
    });

    return {
      ...normalized,
      platformSource: typeof value.source === 'string' ? value.source : 'unknown',
      ...(typeof value.role === 'string' && value.role ? { role: value.role } : {}),
      ...(typeof value.subrole === 'string' && value.subrole ? { subrole: value.subrole } : {}),
      ...(typeof value.app_identifier === 'string' && value.app_identifier ? { appIdentifier: value.app_identifier } : {}),
      ...(value.process_id !== undefined ? { processId: Number(value.process_id) || 0 } : {}),
    };
  }

  function normalizeMacosObservedTextResult(value) {
    if (!value || typeof value !== 'object') {
      return {
        success: false,
        text: '',
        source: 'macos_ax',
        confidence: 'none',
        reason: 'invalid_result',
        appIdentifier: '',
        appFamily: '',
        processId: 0,
        role: '',
        subrole: '',
        bounds: readElementBounds(),
      };
    }

    const success = value.success === true
      && value.source === 'macos_ax'
      && value.confidence === 'confirmed';

    return {
      success,
      text: success && typeof value.text === 'string' ? value.text.trim() : '',
      source: typeof value.source === 'string' ? value.source : 'macos_ax',
      confidence: success ? 'confirmed' : 'none',
      reason: typeof value.reason === 'string' ? value.reason : (success ? 'macos_observed_text_read' : 'macos_observed_text_unavailable'),
      appIdentifier: typeof value.app_identifier === 'string' ? value.app_identifier : '',
      appFamily: typeof value.app_family === 'string' ? value.app_family : '',
      processId: toFiniteNumber(value.process_id),
      role: typeof value.role === 'string' ? value.role : '',
      subrole: typeof value.subrole === 'string' ? value.subrole : '',
      bounds: readElementBounds(value.bounds),
    };
  }

  async function runHelperCommand(command) {
    if (!isMacOS()) return unavailable();

    const compiled = compileHelper();
    if (!compiled.success) return compiled;

    return new Promise((resolve) => {
      let settled = false;
      let stdout = '';
      let stderr = '';
      let timer = null;
      const child = spawnProcess(compiled.path, [command], {
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...processEnv },
      });

      const finish = (result) => {
        if (settled) return;
        settled = true;
        if (timer !== null) clearTimer(timer);
        resolve(result);
      };

      timer = setTimer(() => {
        child.kill();
        finish(unavailable('macos_helper_timeout', command));
      }, helperTimeoutMs);

      child.stdout.on('data', (chunk) => {
        stdout += chunk.toString('utf8');
      });
      child.stderr.on('data', (chunk) => {
        stderr += chunk.toString('utf8');
      });
      child.on('error', (error) => {
        finish(unavailable('macos_helper_run_failed', error instanceof Error ? error.message : String(error)));
      });
      child.on('exit', (code) => {
        const parsed = parseHelperOutput(stdout, stderr, command);
        if (code === 0) {
          finish(parsed);
          return;
        }
        finish({
          ...parsed,
          success: false,
          reason: parsed.reason || 'macos_helper_run_failed',
          exitCode: code,
        });
      });
    });
  }

  async function getAccessibilityStatus() {
    return runHelperCommand('accessibility-status');
  }

  async function getFrontmostApp() {
    return runHelperCommand('frontmost-app');
  }

  async function getFocusedInfo() {
    return runHelperCommand('focused-info');
  }

  async function getSelectedText() {
    const result = await runHelperCommand('selected-text');
    return normalizeMacosSelectedTextResult(result);
  }

  async function getSelectionSnapshot() {
    if (!isMacOS()) {
      return {
        ...unavailable('macos_selection_not_supported'),
        text: '',
        source: 'none',
        focusInfo: createEmptyFocusedInfo(),
      };
    }

    const [focusedInfoResult, selectedTextResult] = await Promise.all([
      getFocusedInfo(),
      getSelectedText(),
    ]);
    const focusInfo = normalizeFocusedInfo(focusedInfoResult);

    return {
      ...selectedTextResult,
      focusInfo,
    };
  }

  async function getFocusedTextTarget() {
    const result = await runHelperCommand('focused-text-target');
    return normalizeFocusedTextTargetResult(result);
  }

  async function getFocusedTextTargetForPaste({ startFocusInfo = null } = {}) {
    const textTarget = await getFocusedTextTarget();
    if (!textTarget.success) return textTarget;

    if (hasFocusedTargetChanged(startFocusInfo, textTarget)) {
      return {
        ...textTarget,
        success: false,
        source: 'none',
        confidence: 'none',
        reason: 'macos_focused_target_changed',
      };
    }

    return textTarget;
  }

  async function getFocusedTextForObservation({ startFocusInfo = null } = {}) {
    if (!isMacOS()) return unavailable('macos_text_observation_unavailable');

    const observedTarget = normalizeMacosObservedTextResult(await runHelperCommand('focused-text-observation'));
    if (!observedTarget.success) return observedTarget;

    if (hasObservationTargetChanged(startFocusInfo, observedTarget)) {
      return {
        ...observedTarget,
        success: false,
        text: '',
        source: 'none',
        confidence: 'none',
        reason: 'macos_observation_target_changed',
      };
    }

    return observedTarget;
  }

  async function sendPasteShortcutForDiagnostics() {
    return runHelperCommand('send-paste-shortcut');
  }

  async function openAccessibilitySettings() {
    if (!isMacOS()) return unavailable();
    if (!shell || typeof shell.openExternal !== 'function') {
      return unavailable('macos_open_settings_unavailable');
    }

    try {
      await shell.openExternal(ACCESSIBILITY_SETTINGS_URL);
      return {
        success: true,
        source: 'macos_system_settings',
        confidence: 'sent',
        reason: 'macos_accessibility_settings_opened',
        url: ACCESSIBILITY_SETTINGS_URL,
      };
    } catch (error) {
      return unavailable('macos_open_settings_failed', error instanceof Error ? error.message : String(error));
    }
  }

  function diagnoseClipboardRoundTrip() {
    if (!isMacOS()) return unavailable();
    if (!clipboard || typeof clipboard.writeText !== 'function' || typeof clipboard.readText !== 'function') {
      return unavailable('clipboard_unavailable');
    }

    const snapshot = createClipboardSnapshot(clipboard);
    try {
      clipboard.writeText('__SPEAKMORE_MACOS_CLIPBOARD_DIAGNOSTIC__');
      restoreClipboardSnapshot(clipboard, snapshot);
      return {
        success: true,
        source: 'macos_clipboard',
        confidence: 'confirmed',
        reason: 'macos_clipboard_roundtrip_ok',
      };
    } catch (error) {
      try {
        restoreClipboardSnapshot(clipboard, snapshot);
      } catch {
        return unavailable('macos_clipboard_restore_failed', error instanceof Error ? error.message : String(error));
      }
      return unavailable('macos_clipboard_roundtrip_failed', error instanceof Error ? error.message : String(error));
    }
  }

  async function pasteText(text, { startFocusInfo = null } = {}) {
    if (!isMacOS()) return unavailable('macos_auto_paste_unavailable');

    const pastedText = String(text || '');
    if (!pastedText) return { success: false, reason: 'empty_text' };
    if (!clipboard || typeof clipboard.writeText !== 'function' || typeof clipboard.readText !== 'function') {
      return unavailable('clipboard_unavailable');
    }

    const textTarget = await getFocusedTextTargetForPaste({ startFocusInfo });
    if (!textTarget.success) {
      return {
        success: false,
        reason: textTarget.reason || 'macos_focused_target_unavailable',
        textTarget,
      };
    }

    const previousClipboard = createClipboardSnapshot(clipboard);
    let result = null;
    let restoreResult = { success: true };

    try {
      clipboard.writeText(pastedText);
      const pasteShortcut = await sendPasteShortcutForDiagnostics();
      if (!pasteShortcut.success) {
        result = {
          success: false,
          reason: pasteShortcut.reason || 'macos_event_injection_failed',
          textTarget,
          pasteShortcut,
        };
      } else {
        await wait(pasteSettleMs);
        result = {
          success: true,
          platform: 'darwin',
          textTarget,
          pasteShortcut,
        };
      }
    } catch (error) {
      result = unavailable('macos_auto_paste_failed', error instanceof Error ? error.message : String(error));
    }

    try {
      restoreClipboardSnapshot(clipboard, previousClipboard);
    } catch (error) {
      restoreResult = {
        success: false,
        reason: 'macos_clipboard_restore_failed',
        detail: error instanceof Error ? error.message : String(error),
      };
    }

    if (!restoreResult.success) {
      return {
        success: false,
        reason: 'macos_clipboard_restore_failed',
        restoreResult,
        pasteResult: result,
      };
    }

    return result;
  }

  async function getDiagnostics({ includeClipboard = false, includeEventInjection = false } = {}) {
    if (!isMacOS()) return unavailable();

    const accessibility = await getAccessibilityStatus();
    const frontmostApp = await getFrontmostApp();
    const focusedInfo = await getFocusedInfo();
    const focusedTextTarget = await getFocusedTextTarget();
    const diagnostics = {
      success: true,
      source: 'macos_platform',
      confidence: 'diagnostic',
      accessibility,
      frontmostApp,
      focusedInfo,
      focusedTextTarget,
    };

    if (includeClipboard) diagnostics.clipboard = diagnoseClipboardRoundTrip();
    if (includeEventInjection) diagnostics.pasteShortcut = await sendPasteShortcutForDiagnostics();
    return diagnostics;
  }

  return {
    ACCESSIBILITY_SETTINGS_URL,
    compileHelper,
    diagnoseClipboardRoundTrip,
    getAccessibilityStatus,
    getDiagnostics,
    getFocusedInfo,
    getFocusedTextForObservation,
    getFocusedTextTarget,
    getFocusedTextTargetForPaste,
    getFrontmostApp,
    getSelectedText,
    getSelectionSnapshot,
    helperBinaryPath,
    openAccessibilitySettings,
    pasteText,
    runHelperCommand,
    sendPasteShortcutForDiagnostics,
  };
}

module.exports = {
  ACCESSIBILITY_SETTINGS_URL,
  createMacosPlatformCapabilities,
};
