const {
  createEmptyFocusedInfo,
  normalizeFocusedInfo,
  normalizeFocusedTextTargetResult,
  normalizeUiaSelectionResult,
} = require('./normalizers');
const { readSelectedTextByClipboard } = require('./clipboard');
const {
  FOCUSED_TEXT_TARGET_SCRIPT,
  FOCUSED_WINDOW_SCRIPT,
  UIA_SELECTION_SCRIPT,
} = require('./scripts');
const { powershellJsonCommand } = require('./powershell');

async function readFocusedInfo({
  readWindowInfo = powershellJsonCommand(FOCUSED_WINDOW_SCRIPT),
} = {}) {
  try {
    // 这里先拿窗口级信息，再统一整理成内部结构，避免上层关心 PowerShell 原始字段。
    const windowInfo = await readWindowInfo();
    const processName = typeof windowInfo.process_name === 'string' ? windowInfo.process_name : '';
    const windowTitle = typeof windowInfo.window_title === 'string' ? windowInfo.window_title : '';
    const hwnd = typeof windowInfo.hwnd === 'string' ? windowInfo.hwnd : '';
    const processId = Number(windowInfo.process_id || 0);

    return normalizeFocusedInfo({
      appInfo: {
        app_name: processName,
        app_identifier: processName ? `${processName}.exe` : '',
        window_title: windowTitle,
        app_type: 'native_app',
        app_metadata: { hwnd, process_id: processId },
        browser_context: null,
      },
      elementInfo: {
        role: '',
        focused: Boolean(hwnd),
        editable: true,
        selected: false,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      },
    });
  } catch {
    return createEmptyFocusedInfo();
  }
}

async function readSelectedTextByUia({
  readUiaSelection = powershellJsonCommand(UIA_SELECTION_SCRIPT),
} = {}) {
  try {
    // UIA 是首选来源，优先走可信选区而不是依赖剪贴板副作用。
    return normalizeUiaSelectionResult(await readUiaSelection());
  } catch (error) {
    // UIA 失败不能抛给上层，必须给出可解释的失败结果，方便降级到其他路径。
    return {
      success: false,
      text: '',
      source: 'none',
      confidence: 'none',
      reason: 'uia_failed',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readFocusedTextTarget({
  readTextTarget = powershellJsonCommand(FOCUSED_TEXT_TARGET_SCRIPT),
} = {}) {
  try {
    // 这个结果只描述当前焦点控件是否适合输入，不直接承诺一定能粘贴。
    return normalizeFocusedTextTargetResult(await readTextTarget());
  } catch (error) {
    // 这里也要返回结构化失败，避免调用方把异常当成“可以输入”。
    return {
      success: false,
      source: 'none',
      confidence: 'none',
      reason: 'text_target_failed',
      valuePattern: false,
      textPattern: false,
      isReadOnly: false,
      controlType: '',
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

async function readSelectionSnapshot({
  clipboard,
  readFocusedInfo: readFocus = readFocusedInfo,
  readUiaSelection,
  sendCopyShortcut,
  wait,
  marker,
  copyWaitMs,
} = {}) {
  // 快照要同时保留当前焦点和选区信息，供快捷键和语音任务解析使用。
  const focusInfo = normalizeFocusedInfo(await readFocus());
  const selection = await readSelectedTextByUia({ readUiaSelection });

  if (clipboard && sendCopyShortcut) {
    // 剪贴板兜底只用于兼容场景；即使读取失败，也不影响已经拿到的 UIA 结果。
    await readSelectedTextByClipboard({
      clipboard,
      sendCopyShortcut,
      wait,
      marker,
      copyWaitMs,
    });
  }

  return {
    ...selection,
    // 焦点信息和选区分开保存，避免上层把“当前焦点”误解成“当前有选区”。
    focusInfo,
  };
}

module.exports = {
  readFocusedInfo,
  readFocusedTextTarget,
  readSelectedTextByUia,
  readSelectionSnapshot,
};
