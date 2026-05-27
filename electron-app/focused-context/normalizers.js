// 旧版选区读取可能只返回字符串，这里统一转成带 success/source/reason 的结构。
function normalizeSelectedTextResult(value) {
  if (typeof value === 'string') {
    return { success: Boolean(value.trim()), text: value.trim(), source: 'legacy' };
  }

  if (!value || typeof value !== 'object') {
    return { success: false, text: '', source: 'unknown', reason: 'invalid_result' };
  }

  const text = typeof value.text === 'string' ? value.text.trim() : '';
  return {
    success: Boolean(value.success) && Boolean(text),
    text: Boolean(value.success) ? text : '',
    source: typeof value.source === 'string' ? value.source : 'unknown',
    ...(typeof value.reason === 'string' ? { reason: value.reason } : {}),
  };
}

// UIA 选区只有在来源、置信度和文本都明确可信时才允许进入后续业务判断。
function normalizeUiaSelectionResult(value) {
  if (!value || typeof value !== 'object') {
    return { success: false, text: '', source: 'none', confidence: 'none', reason: 'invalid_result' };
  }

  const text = typeof value.text === 'string' ? value.text.trim() : '';
  const selectionScope = typeof value.selection_scope === 'string'
    ? value.selection_scope
    : typeof value.selectionScope === 'string'
      ? value.selectionScope
      : '';
  const focusedReason = typeof value.focused_reason === 'string'
    ? value.focused_reason
    : typeof value.focusedReason === 'string'
      ? value.focusedReason
      : '';
  const foregroundScanned = Number(value.foreground_scanned ?? value.foregroundScanned ?? value.scanned);
  const isConfirmed = value.success === true
    && value.source === 'uia'
    && value.confidence === 'confirmed'
    && Boolean(text);

  if (!isConfirmed) {
    return {
      success: false,
      text: '',
      source: 'none',
      confidence: 'none',
      reason: typeof value.reason === 'string' ? value.reason : 'empty',
      ...(focusedReason ? { focusedReason } : {}),
      ...(Number.isFinite(foregroundScanned) ? { foregroundScanned } : {}),
    };
  }

  return {
    success: true,
    text,
    source: 'uia',
    confidence: 'confirmed',
    ...(selectionScope ? { selectionScope } : {}),
    ...(Number.isFinite(foregroundScanned) ? { foregroundScanned } : {}),
  };
}

// 焦点信息缺失时返回完整空结构，避免调用方到处写空值防御。
function createEmptyFocusedInfo() {
  return {
    appInfo: {
      app_name: '',
      app_identifier: '',
      window_title: '',
      app_type: 'native_app',
      app_metadata: {},
      browser_context: null,
    },
    elementInfo: {
      role: '',
      focused: false,
      editable: true,
      selected: false,
      bounds: { x: 0, y: 0, width: 0, height: 0 },
    },
  };
}

// 原生焦点读取结果可能缺字段或类型不稳定，这里收敛成 renderer/main 都能安全消费的结构。
function normalizeFocusedInfo(value) {
  if (!value || typeof value !== 'object') return createEmptyFocusedInfo();

  const appInfo = value.appInfo && typeof value.appInfo === 'object' ? value.appInfo : {};
  const elementInfo = value.elementInfo && typeof value.elementInfo === 'object' ? value.elementInfo : {};

  return {
    appInfo: {
      app_name: typeof appInfo.app_name === 'string' ? appInfo.app_name : '',
      app_identifier: typeof appInfo.app_identifier === 'string' ? appInfo.app_identifier : '',
      window_title: typeof appInfo.window_title === 'string' ? appInfo.window_title : '',
      app_type: typeof appInfo.app_type === 'string' ? appInfo.app_type : 'native_app',
      app_metadata: appInfo.app_metadata && typeof appInfo.app_metadata === 'object' ? appInfo.app_metadata : {},
      browser_context: appInfo.browser_context ?? null,
    },
    elementInfo: {
      role: typeof elementInfo.role === 'string' ? elementInfo.role : '',
      focused: Boolean(elementInfo.focused),
      editable: elementInfo.editable !== false,
      selected: Boolean(elementInfo.selected),
      bounds: elementInfo.bounds && typeof elementInfo.bounds === 'object'
        ? elementInfo.bounds
        : { x: 0, y: 0, width: 0, height: 0 },
    },
  };
}

// 自动粘贴前必须确认当前焦点是真正可写文本目标，不能只凭控件存在就发送 Ctrl+V。
function normalizeStringArray(value) {
  return Array.isArray(value)
    ? value.filter((item) => typeof item === 'string' && item.trim()).map((item) => item.trim())
    : [];
}

function normalizeFocusedTextTargetResult(value) {
  if (!value || typeof value !== 'object') {
    return {
      success: false,
      source: 'none',
      confidence: 'none',
      reason: 'invalid_result',
      valuePattern: false,
      textPattern: false,
      isReadOnly: false,
      controlType: '',
      appFamily: '',
      foregroundHwnd: '',
      focusHwnd: '',
      caretHwnd: '',
      matchedSignals: [],
    };
  }

  const source = typeof value.source === 'string' ? value.source : 'none';
  const confidence = typeof value.confidence === 'string' ? value.confidence : 'none';
  const reason = typeof value.reason === 'string' ? value.reason : 'text_target_unavailable';
  const valuePattern = Boolean(value.value_pattern ?? value.valuePattern);
  const textPattern = Boolean(value.text_pattern ?? value.textPattern);
  const isReadOnly = Boolean(value.is_read_only ?? value.isReadOnly);
  // 原生脚本和 JS 调用方字段命名不同，归一化时同时兼容 snake_case 与 camelCase。
  const controlType = typeof value.control_type === 'string'
    ? value.control_type
    : typeof value.controlType === 'string'
      ? value.controlType
      : '';
  const appFamily = typeof value.app_family === 'string'
    ? value.app_family
    : typeof value.appFamily === 'string'
      ? value.appFamily
      : '';
  const foregroundHwnd = String(value.foreground_hwnd ?? value.foregroundHwnd ?? '');
  const focusHwnd = String(value.focus_hwnd ?? value.focusHwnd ?? '');
  const caretHwnd = String(value.caret_hwnd ?? value.caretHwnd ?? '');
  const matchedSignals = normalizeStringArray(value.matched_signals ?? value.matchedSignals);
  const isUiaSuccess = source === 'uia'
    && confidence === 'confirmed'
    && !isReadOnly
    && (valuePattern || textPattern);
  const isCaretSuccess = source === 'win32_caret'
    && (confidence === 'confirmed' || confidence === 'high')
    && Boolean(caretHwnd);
  const isAppCompatSuccess = source === 'app_compat'
    && (confidence === 'weak' || confidence === 'app_specific')
    && Boolean(appFamily)
    && matchedSignals.length > 0;
  const success = Boolean(value.success) && (isUiaSuccess || isCaretSuccess || isAppCompatSuccess);

  return {
    success,
    source: success ? source : 'none',
    confidence: success ? confidence : 'none',
    reason,
    valuePattern,
    textPattern,
    isReadOnly,
    controlType,
    appFamily,
    foregroundHwnd,
    focusHwnd,
    caretHwnd,
    matchedSignals,
  };
}

// Windows 句柄比窗口标题更稳定，优先用它判断两次焦点是否属于同一个窗口。
function getWindowHandle(focusedInfo) {
  return String(focusedInfo?.appInfo?.app_metadata?.hwnd || '');
}

// 有 hwnd 时按窗口句柄比较；没有 hwnd 时退回到应用标识和窗口标题。
function isSameFocusedContext(previous, current) {
  const normalizedPrevious = normalizeFocusedInfo(previous);
  const normalizedCurrent = normalizeFocusedInfo(current);
  const previousHwnd = getWindowHandle(normalizedPrevious);
  const currentHwnd = getWindowHandle(normalizedCurrent);

  if (previousHwnd || currentHwnd) return Boolean(previousHwnd && previousHwnd === currentHwnd);

  return normalizedPrevious.appInfo.app_identifier === normalizedCurrent.appInfo.app_identifier
    && normalizedPrevious.appInfo.window_title === normalizedCurrent.appInfo.window_title;
}

module.exports = {
  createEmptyFocusedInfo,
  getWindowHandle,
  isSameFocusedContext,
  normalizeFocusedInfo,
  normalizeFocusedTextTargetResult,
  normalizeStringArray,
  normalizeSelectedTextResult,
  normalizeUiaSelectionResult,
};
