import test from 'node:test';
import assert from 'node:assert/strict';
import {
  detectAppCompatTextTarget,
  isSameFocusedContext,
  normalizeFocusedTextTargetResult,
  normalizeSelectedTextResult,
  readSelectionSnapshot,
  readSelectedTextByClipboard,
  readFocusedTextTarget,
  readSelectedTextByUia,
  UIA_SELECTION_SCRIPT,
} from './focused-context.js';

function createFakeClipboard(initialText = 'old clipboard') {
  let text = initialText;
  return {
    readText: () => text,
    writeText: (nextText) => {
      text = String(nextText || '');
    },
    current: () => text,
  };
}

function createRichFakeClipboard() {
  let data = {
    text: 'old text',
    html: '<b>old</b>',
    rtf: '{\\rtf1 old}',
    image: { isEmpty: () => false, id: 'old-image' },
  };

  return {
    readText: () => data.text || '',
    readHTML: () => data.html || '',
    readRTF: () => data.rtf || '',
    readImage: () => data.image || { isEmpty: () => true },
    writeText: (nextText) => {
      data = { text: String(nextText || '') };
    },
    write: (nextData) => {
      data = { ...nextData };
    },
    current: () => data,
  };
}

test('readSelectedTextByClipboard 读取选区后恢复原剪贴板文本', async () => {
  const clipboard = createFakeClipboard('old clipboard');
  const result = await readSelectedTextByClipboard({
    clipboard,
    sendCopyShortcut: async () => clipboard.writeText('selected text'),
    wait: async () => undefined,
    marker: 'TYPELESS_SELECTION_MARKER',
  });

  assert.deepEqual(result, {
    success: true,
    text: 'selected text',
    source: 'clipboard',
  });
  assert.equal(clipboard.current(), 'old clipboard');
});

test('normalizeFocusedTextTargetResult 只接受可输入文本目标', () => {
  assert.equal(normalizeFocusedTextTargetResult({
    success: true,
    source: 'uia',
    confidence: 'confirmed',
    value_pattern: true,
    text_pattern: false,
    is_read_only: false,
    control_type: 'ControlType.Edit',
  }).success, true);

  assert.equal(normalizeFocusedTextTargetResult({
    success: false,
    source: 'none',
    confidence: 'none',
    reason: 'no_focused_element',
  }).success, false);

  assert.equal(normalizeFocusedTextTargetResult({
    success: true,
    source: 'uia',
    confidence: 'confirmed',
    value_pattern: true,
    is_read_only: true,
  }).success, false);
});

test('normalizeFocusedTextTargetResult 接受 Win32 caret 和弱可信应用族来源', () => {
  assert.deepEqual(normalizeFocusedTextTargetResult({
    success: true,
    source: 'win32_caret',
    confidence: 'confirmed',
    reason: 'caret',
    focus_hwnd: '200',
    caret_hwnd: '201',
    foreground_hwnd: '100',
  }), {
    success: true,
    source: 'win32_caret',
    confidence: 'confirmed',
    reason: 'caret',
    valuePattern: false,
    textPattern: false,
    isReadOnly: false,
    controlType: '',
    appFamily: '',
    foregroundHwnd: '100',
    focusHwnd: '200',
    caretHwnd: '201',
    matchedSignals: [],
  });

  assert.deepEqual(normalizeFocusedTextTargetResult({
    success: true,
    source: 'app_compat',
    confidence: 'weak',
    reason: 'app_compat_match',
    app_family: 'wechat',
    foreground_hwnd: '300',
    matched_signals: ['process:wechat', 'class:MMUIRenderSubWindowHW'],
  }), {
    success: true,
    source: 'app_compat',
    confidence: 'weak',
    reason: 'app_compat_match',
    valuePattern: false,
    textPattern: false,
    isReadOnly: false,
    controlType: '',
    appFamily: 'wechat',
    foregroundHwnd: '300',
    focusHwnd: '',
    caretHwnd: '',
    matchedSignals: ['process:wechat', 'class:MMUIRenderSubWindowHW'],
  });

  assert.equal(normalizeFocusedTextTargetResult({
    success: true,
    source: 'foreground_window',
    confidence: 'weak',
    reason: 'too_broad',
  }).success, false);
});

test('readFocusedTextTarget 在 UIA 探测失败时返回不可粘贴目标', async () => {
  const result = await readFocusedTextTarget({
    readTextTarget: async () => {
      throw new Error('uia boom');
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'text_target_failed');
});

test('readFocusedTextTarget 在 UIA 不可用时接受 Win32 caret 目标', async () => {
  const result = await readFocusedTextTarget({
    readTextTarget: async () => ({
      success: false,
      source: 'none',
      confidence: 'none',
      reason: 'text_target_unavailable',
    }),
    readCaretTarget: async () => ({
      success: true,
      source: 'win32_caret',
      confidence: 'confirmed',
      reason: 'caret',
      foreground_hwnd: '100',
      focus_hwnd: '101',
      caret_hwnd: '101',
    }),
    readWindowTree: async () => ({
      success: false,
      reason: 'not_needed',
    }),
  });

  assert.equal(result.success, true);
  assert.equal(result.source, 'win32_caret');
  assert.equal(result.caretHwnd, '101');
});

test('detectAppCompatTextTarget 只允许已知聊天和桌面文本应用族的弱信号组合', () => {
  const wechat = detectAppCompatTextTarget({
    success: true,
    process_name: 'WeChat',
    foreground_hwnd: '500',
    window_title: '微信',
    class_names: ['Qt51514QWindowIcon', 'MMUIRenderSubWindowHW'],
    start_foreground_hwnd: '500',
  });

  assert.equal(wechat.success, true);
  assert.equal(wechat.source, 'app_compat');
  assert.equal(wechat.app_family, 'wechat');
  assert.deepEqual(wechat.matched_signals, [
    'process:wechat',
    'same_foreground_hwnd',
    'class:MMUIRenderSubWindowHW',
  ]);

  const desktop = detectAppCompatTextTarget({
    success: true,
    process_name: 'explorer',
    foreground_hwnd: '600',
    window_title: 'Desktop',
    class_names: ['WorkerW'],
    start_foreground_hwnd: '600',
  });

  assert.equal(desktop.success, false);
  assert.equal(desktop.reason, 'app_family_not_allowed');

  const allowedChromiumApps = [
    { appFamily: 'codex', processName: 'Codex' },
    { appFamily: 'claude_code', processName: 'Claude Code' },
    { appFamily: 'claude_code', processName: 'claude-code' },
    { appFamily: 'chatgpt', processName: 'ChatGPT' },
    { appFamily: 'vscode', processName: 'Code' },
    { appFamily: 'cursor', processName: 'Cursor' },
    { appFamily: 'slack', processName: 'Slack' },
    { appFamily: 'notion', processName: 'Notion' },
    { appFamily: 'spotify', processName: 'Spotify' },
  ];

  for (const app of allowedChromiumApps) {
    const result = detectAppCompatTextTarget({
      success: true,
      process_name: app.processName,
      foreground_hwnd: '700',
      window_title: `${app.processName} main`,
      class_names: ['Chrome_WidgetWin_1'],
      start_foreground_hwnd: '700',
    });

    assert.equal(result.success, true, app.appFamily);
    assert.equal(result.source, 'app_compat', app.appFamily);
    assert.equal(result.app_family, app.appFamily, app.appFamily);
    assert.deepEqual(result.matched_signals, [
      `process:${app.appFamily}`,
      'same_foreground_hwnd',
      'class:Chrome_WidgetWin_1',
    ], app.appFamily);
  }

  const blockedWindow = detectAppCompatTextTarget({
    success: true,
    process_name: 'Slack',
    foreground_hwnd: '701',
    window_title: 'Slack Settings',
    class_names: ['Chrome_WidgetWin_1'],
    start_foreground_hwnd: '701',
  });

  assert.equal(blockedWindow.success, false);
  assert.equal(blockedWindow.reason, 'blocked_window_title');

  const extensionFileWindow = detectAppCompatTextTarget({
    success: true,
    process_name: 'Cursor',
    foreground_hwnd: '702',
    window_title: 'Extension.ts - typeless - Cursor',
    class_names: ['Chrome_WidgetWin_1'],
    start_foreground_hwnd: '702',
  });

  assert.equal(extensionFileWindow.success, true);
  assert.equal(extensionFileWindow.app_family, 'cursor');

  const switchedWindow = detectAppCompatTextTarget({
    success: true,
    process_name: 'WeChat',
    foreground_hwnd: '501',
    window_title: '微信',
    class_names: ['MMUIRenderSubWindowHW'],
    start_foreground_hwnd: '500',
  });

  assert.equal(switchedWindow.success, false);
  assert.equal(switchedWindow.reason, 'foreground_changed');
});

test('readFocusedTextTarget 在 UIA 和 caret 都失败时接受 app_compat 目标', async () => {
  const result = await readFocusedTextTarget({
    startFocusInfo: {
      appInfo: { app_metadata: { hwnd: '500' } },
    },
    readTextTarget: async () => ({
      success: false,
      source: 'none',
      confidence: 'none',
      reason: 'text_target_unavailable',
    }),
    readCaretTarget: async () => ({
      success: false,
      source: 'none',
      confidence: 'none',
      reason: 'caret_unavailable',
      foreground_hwnd: '500',
    }),
    readWindowTree: async () => ({
      success: true,
      process_name: 'WeChat',
      foreground_hwnd: '500',
      window_title: '微信',
      class_names: ['Qt51514QWindowIcon', 'MMUIRenderSubWindowHW'],
    }),
  });

  assert.equal(result.success, true);
  assert.equal(result.source, 'app_compat');
  assert.equal(result.appFamily, 'wechat');
  assert.deepEqual(result.matchedSignals, [
    'process:wechat',
    'same_foreground_hwnd',
    'class:MMUIRenderSubWindowHW',
  ]);
});

test('readSelectedTextByClipboard 会恢复 HTML、RTF 和图片剪贴板内容', async () => {
  const clipboard = createRichFakeClipboard();
  const result = await readSelectedTextByClipboard({
    clipboard,
    sendCopyShortcut: async () => clipboard.writeText('selected text'),
    wait: async () => undefined,
    marker: 'TYPELESS_SELECTION_MARKER',
  });

  assert.equal(result.text, 'selected text');
  const restored = clipboard.current();
  assert.equal(restored.text, 'old text');
  assert.equal(restored.html, '<b>old</b>');
  assert.equal(restored.rtf, '{\\rtf1 old}');
  assert.equal(restored.image?.id, 'old-image');
});

test('readSelectedTextByClipboard 在复制超时仍是 marker 时返回 copy_timeout', async () => {
  const clipboard = createFakeClipboard('old clipboard');
  const result = await readSelectedTextByClipboard({
    clipboard,
    sendCopyShortcut: async () => undefined,
    wait: async () => undefined,
    marker: 'TYPELESS_SELECTION_MARKER',
    copyWaitMs: 40,
    copyPollIntervalMs: 10,
  });

  assert.deepEqual(result, {
    success: false,
    text: '',
    source: 'clipboard',
    reason: 'copy_timeout',
  });
  assert.equal(clipboard.current(), 'old clipboard');
});

test('readSelectedTextByClipboard 会轮询等待慢应用写入剪贴板', async () => {
  const clipboard = createFakeClipboard('old clipboard');
  let waitCount = 0;

  const result = await readSelectedTextByClipboard({
    clipboard,
    sendCopyShortcut: async () => undefined,
    wait: async () => {
      waitCount += 1;
      if (waitCount === 2) clipboard.writeText(' delayed selected ');
    },
    marker: 'TYPELESS_SELECTION_MARKER',
    copyWaitMs: 100,
    copyPollIntervalMs: 10,
  });

  assert.deepEqual(result, {
    success: true,
    text: 'delayed selected',
    source: 'clipboard',
  });
  assert.equal(waitCount, 2);
  assert.equal(clipboard.current(), 'old clipboard');
});

test('readSelectedTextByClipboard 在复制异常时恢复剪贴板并返回 copy_failed', async () => {
  const clipboard = createFakeClipboard('old clipboard');
  const result = await readSelectedTextByClipboard({
    clipboard,
    sendCopyShortcut: async () => {
      throw new Error('copy boom');
    },
    wait: async () => undefined,
    marker: 'TYPELESS_SELECTION_MARKER',
  });

  assert.equal(result.success, false);
  assert.equal(result.text, '');
  assert.equal(result.reason, 'copy_failed');
  assert.equal(clipboard.current(), 'old clipboard');
});

test('normalizeSelectedTextResult 同时兼容字符串和对象返回值', () => {
  assert.equal(normalizeSelectedTextResult(' abc ').text, 'abc');
  assert.equal(normalizeSelectedTextResult({ success: true, text: ' def ' }).text, 'def');
  assert.equal(normalizeSelectedTextResult({ success: false, text: 'ignored' }).text, '');
});

test('readSelectedTextByUia 返回 confirmed 选区', async () => {
  const result = await readSelectedTextByUia({
    readUiaSelection: async () => ({
      success: true,
      text: 'selected by uia',
      source: 'uia',
      confidence: 'confirmed',
      selection_scope: 'foreground_descendant',
      scanned: 3,
    }),
  });

  assert.deepEqual(result, {
    success: true,
    text: 'selected by uia',
    source: 'uia',
    confidence: 'confirmed',
    selectionScope: 'foreground_descendant',
    foregroundScanned: 3,
  });
});

test('readSelectedTextByUia 在 UIA 空文本时返回 none', async () => {
  const result = await readSelectedTextByUia({
    readUiaSelection: async () => ({
      success: true,
      text: '',
      source: 'uia',
      confidence: 'confirmed',
    }),
  });

  assert.deepEqual(result, {
    success: false,
    text: '',
    source: 'none',
    confidence: 'none',
    reason: 'empty',
  });
});

test('readSelectionSnapshot 会同时返回前台窗口信息和 UIA confirmed 选区文本', async () => {
  const clipboard = createFakeClipboard('old clipboard');
  const result = await readSelectionSnapshot({
    clipboard,
    readFocusedInfo: async () => ({
      appInfo: {
        app_name: 'Notepad',
        app_identifier: 'notepad.exe',
        window_title: 'note.txt',
        app_type: 'native_app',
        app_metadata: { hwnd: '100', process_id: 123 },
        browser_context: null,
      },
      elementInfo: {
        role: '',
        focused: true,
        editable: true,
        selected: true,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      },
    }),
    readUiaSelection: async () => ({
      success: true,
      text: 'selected text',
      source: 'uia',
      confidence: 'confirmed',
    }),
    sendCopyShortcut: async () => clipboard.writeText('clipboard fallback should be ignored'),
    wait: async () => undefined,
    marker: 'TYPELESS_SELECTION_MARKER',
  });

  assert.equal(result.success, true);
  assert.equal(result.text, 'selected text');
  assert.equal(result.source, 'uia');
  assert.equal(result.confidence, 'confirmed');
  assert.equal(result.focusInfo.appInfo.app_identifier, 'notepad.exe');
  assert.equal(result.focusInfo.appInfo.app_metadata.hwnd, '100');
  assert.equal(clipboard.current(), 'old clipboard');
});

test('readSelectionSnapshot 在 UIA 无 confirmed 选区时返回剪贴板 fallback', async () => {
  const clipboard = createFakeClipboard('old clipboard');
  const result = await readSelectionSnapshot({
    clipboard,
    readFocusedInfo: async () => ({
      appInfo: {
        app_name: 'Code',
        app_identifier: 'Code.exe',
        window_title: 'main.ts',
        app_type: 'native_app',
        app_metadata: { hwnd: '100', process_id: 123 },
        browser_context: null,
      },
      elementInfo: {
        role: '',
        focused: true,
        editable: true,
        selected: false,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      },
    }),
    readUiaSelection: async () => ({
      success: false,
      text: '',
      source: 'none',
      confidence: 'none',
      reason: 'empty',
    }),
    sendCopyShortcut: async () => clipboard.writeText('current line copied by app'),
    wait: async () => undefined,
    marker: 'TYPELESS_SELECTION_MARKER',
  });

  assert.equal(result.success, true);
  assert.equal(result.text, 'current line copied by app');
  assert.equal(result.source, 'clipboard');
  assert.equal(result.confidence, 'fallback');
  assert.equal(result.focusInfo.appInfo.app_identifier, 'Code.exe');
  assert.equal(clipboard.current(), 'old clipboard');
});

test('readSelectionSnapshot 未显式传入复制快捷键时仍会尝试剪贴板 fallback', async () => {
  const clipboard = createFakeClipboard('old clipboard');
  const result = await readSelectionSnapshot({
    clipboard,
    readFocusedInfo: async () => ({
      appInfo: {
        app_name: 'Code',
        app_identifier: 'Code.exe',
        window_title: 'main.ts',
        app_type: 'native_app',
        app_metadata: { hwnd: '100', process_id: 123 },
        browser_context: null,
      },
      elementInfo: {
        role: '',
        focused: true,
        editable: true,
        selected: false,
        bounds: { x: 0, y: 0, width: 0, height: 0 },
      },
    }),
    readUiaSelection: async () => ({
      success: false,
      text: '',
      source: 'none',
      confidence: 'none',
      reason: 'empty',
    }),
    readClipboardSelection: async ({ clipboard: receivedClipboard, sendCopyShortcut }) => {
      assert.equal(receivedClipboard, clipboard);
      assert.equal(sendCopyShortcut, undefined);
      return { success: true, text: 'clipboard from default shortcut path', source: 'clipboard' };
    },
  });

  assert.equal(result.success, true);
  assert.equal(result.text, 'clipboard from default shortcut path');
  assert.equal(result.source, 'clipboard');
  assert.equal(result.confidence, 'fallback');
});

test('isSameFocusedContext 使用窗口句柄优先比较', () => {
  const previous = {
    appInfo: {
      app_name: 'Notepad',
      app_identifier: 'notepad.exe',
      window_title: 'note.txt',
      app_type: 'native_app',
      app_metadata: { hwnd: '100', process_id: 123 },
      browser_context: null,
    },
  };
  const same = {
    appInfo: {
      app_name: 'Notepad',
      app_identifier: 'notepad.exe',
      window_title: 'changed title',
      app_type: 'native_app',
      app_metadata: { hwnd: '100', process_id: 123 },
      browser_context: null,
    },
  };
  const different = {
    appInfo: {
      app_name: 'Chrome',
      app_identifier: 'chrome.exe',
      window_title: 'page',
      app_type: 'native_app',
      app_metadata: { hwnd: '200', process_id: 456 },
      browser_context: null,
    },
  };

  assert.equal(isSameFocusedContext(previous, same), true);
  assert.equal(isSameFocusedContext(previous, different), false);
});

test('UIA_SELECTION_SCRIPT 会在前台窗口子树中兜底查找 TextPattern 选区', () => {
  assert.match(UIA_SELECTION_SCRIPT, /Win32SelectionForeground/);
  assert.match(UIA_SELECTION_SCRIPT, /GetForegroundWindow/);
  assert.match(UIA_SELECTION_SCRIPT, /Find-ForegroundSelection/);
  assert.match(UIA_SELECTION_SCRIPT, /IsTextPatternAvailableProperty/);
  assert.match(UIA_SELECTION_SCRIPT, /ControlType\]::Document/);
  assert.match(UIA_SELECTION_SCRIPT, /foreground_descendant/);
});
