import test from 'node:test'
import assert from 'node:assert/strict'
import { formatShortcut, getShortcutLabelSet } from './shortcutLabels'

test('getShortcutLabelSet 在 Windows 平台展示 Right Alt 系列快捷键', () => {
  assert.deepEqual(getShortcutLabelSet('win32'), {
    dictation: ['Right Alt'],
    ask: ['Right Alt', 'Space'],
    translate: ['Right Alt', 'Right Shift'],
  })
})

test('getShortcutLabelSet 在 macOS 平台展示右 Option 系列快捷键', () => {
  assert.deepEqual(getShortcutLabelSet('darwin'), {
    dictation: ['Right Option'],
    ask: ['Right Option', 'Right Command'],
    translate: ['Right Option', 'Shift'],
  })
})

test('formatShortcut 使用统一加号格式', () => {
  assert.equal(formatShortcut(['Right Option', 'Right Command']), 'Right Option + Right Command')
})
