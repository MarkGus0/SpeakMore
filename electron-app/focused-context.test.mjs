import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isSameFocusedContext,
  normalizeFocusedTextTargetResult,
  normalizeSelectedTextResult,
  readSelectionSnapshot,
  readSelectedTextByClipboard,
  readFocusedTextTarget,
  readSelectedTextByUia,
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

test('readFocusedTextTarget 在 UIA 探测失败时返回不可粘贴目标', async () => {
  const result = await readFocusedTextTarget({
    readTextTarget: async () => {
      throw new Error('uia boom');
    },
  });

  assert.equal(result.success, false);
  assert.equal(result.reason, 'text_target_failed');
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
    }),
  });

  assert.deepEqual(result, {
    success: true,
    text: 'selected by uia',
    source: 'uia',
    confidence: 'confirmed',
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
