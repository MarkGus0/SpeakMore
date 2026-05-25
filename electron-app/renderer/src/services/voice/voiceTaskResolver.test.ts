import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolveVoiceTask, type VoiceTask } from './voiceTaskResolver'
import type { FocusedInfo, FocusedSelectionSnapshot } from './focusedContext'

const focusInfo = {
  appInfo: {
    app_name: 'Notepad',
    app_identifier: 'notepad.exe',
    window_title: 'note.txt',
    app_type: 'native_app',
    app_metadata: { hwnd: '100' },
    browser_context: null,
  },
  elementInfo: {
    role: '',
    focused: true,
    editable: true,
    selected: true,
    bounds: { x: 0, y: 0, width: 0, height: 0 },
  },
}

function reader(snapshot: FocusedSelectionSnapshot) {
  return async () => snapshot
}

function focusedReader(snapshot: FocusedInfo | null) {
  return async () => snapshot
}

function countingReader(snapshot: FocusedSelectionSnapshot) {
  let calls = 0
  const read = async () => {
    calls += 1
    return snapshot
  }
  return {
    read,
    getCalls: () => calls,
  }
}

function assertTask(actual: VoiceTask, expected: VoiceTask) {
  assert.deepEqual(actual, expected)
}

test('普通听写意图无选区时保持 Dictate 录音粘贴', async () => {
  const task = await resolveVoiceTask('DictateShortcut', reader({
    selectedText: '',
    source: 'none',
    confidence: 'none',
    focusInfo: null,
  }), focusedReader(focusInfo))

  assertTask(task, {
    mode: 'Dictate',
    selectedText: '',
    source: 'none',
    confidence: 'none',
    focusInfo,
    delivery: 'paste',
  })
})

test('普通听写意图有 UIA 选区时仍保持 Dictate 录音粘贴', async () => {
  const task = await resolveVoiceTask('DictateShortcut', reader({
    selectedText: '你好',
    source: 'uia',
    confidence: 'confirmed',
    focusInfo,
  }), focusedReader(focusInfo))

  assertTask(task, {
    mode: 'Dictate',
    selectedText: '',
    source: 'none',
    confidence: 'none',
    focusInfo,
    delivery: 'paste',
  })
})

test('普通听写意图不读取 UIA 选区，避免连接前无用等待', async () => {
  const source = countingReader({
    selectedText: '你好',
    source: 'uia',
    confidence: 'confirmed',
    focusInfo,
  })

  const task = await resolveVoiceTask('DictateShortcut', source.read, focusedReader(focusInfo))

  assert.equal(source.getCalls(), 0)
  assertTask(task, {
    mode: 'Dictate',
    selectedText: '',
    source: 'none',
    confidence: 'none',
    focusInfo,
    delivery: 'paste',
  })
})

test('自由提问意图无选区时录音并展示悬浮结果', async () => {
  const task = await resolveVoiceTask('AskShortcut', reader({
    selectedText: '',
    source: 'none',
    confidence: 'none',
    focusInfo: null,
  }))

  assertTask(task, {
    mode: 'Ask',
    selectedText: '',
    source: 'none',
    confidence: 'none',
    focusInfo: null,
    delivery: 'floating-panel',
  })
})

test('自由提问意图有 UIA 选区时录音并展示悬浮结果', async () => {
  const task = await resolveVoiceTask('AskShortcut', reader({
    selectedText: 'const a = 1',
    source: 'uia',
    confidence: 'confirmed',
    focusInfo,
  }))

  assertTask(task, {
    mode: 'Ask',
    selectedText: 'const a = 1',
    source: 'uia',
    confidence: 'confirmed',
    focusInfo,
    delivery: 'floating-panel',
  })
})

test('自由提问意图接受 clipboard fallback 作为上下文并展示悬浮结果', async () => {
  const task = await resolveVoiceTask('AskShortcut', reader({
    selectedText: 'current line copied by app',
    source: 'clipboard',
    confidence: 'fallback',
    focusInfo,
  }))

  assertTask(task, {
    mode: 'Ask',
    selectedText: 'current line copied by app',
    source: 'clipboard',
    confidence: 'fallback',
    focusInfo,
    delivery: 'floating-panel',
  })
})

test('普通听写意图忽略非 confirmed 选区文本', async () => {
  const task = await resolveVoiceTask('DictateShortcut', reader({
    selectedText: 'current line copied by app',
    source: 'none',
    confidence: 'none',
    focusInfo: null,
  }), focusedReader(focusInfo))

  assertTask(task, {
    mode: 'Dictate',
    selectedText: '',
    source: 'none',
    confidence: 'none',
    focusInfo,
    delivery: 'paste',
  })
})

test('翻译意图有选区时仍录音并把翻译结果粘贴到光标位置', async () => {
  const task = await resolveVoiceTask('TranslateShortcut', reader({
    selectedText: '你好',
    source: 'uia',
    confidence: 'confirmed',
    focusInfo,
  }), focusedReader(focusInfo))

  assertTask(task, {
    mode: 'Translate',
    selectedText: '',
    source: 'none',
    confidence: 'none',
    focusInfo,
    delivery: 'paste',
  })
})

test('语音翻译意图不读取 UIA 选区，避免连接前无用等待', async () => {
  const source = countingReader({
    selectedText: '你好',
    source: 'uia',
    confidence: 'confirmed',
    focusInfo,
  })

  const task = await resolveVoiceTask('TranslateShortcut', source.read, focusedReader(focusInfo))

  assert.equal(source.getCalls(), 0)
  assertTask(task, {
    mode: 'Translate',
    selectedText: '',
    source: 'none',
    confidence: 'none',
    focusInfo,
    delivery: 'paste',
  })
})

test('翻译意图无选区时保留语音翻译粘贴', async () => {
  const task = await resolveVoiceTask('TranslateShortcut', reader({
    selectedText: '',
    source: 'none',
    confidence: 'none',
    focusInfo: null,
  }), focusedReader(focusInfo))

  assertTask(task, {
    mode: 'Translate',
    selectedText: '',
    source: 'none',
    confidence: 'none',
    focusInfo,
    delivery: 'paste',
  })
})
