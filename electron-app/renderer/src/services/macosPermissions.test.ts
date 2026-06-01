import test from 'node:test'
import assert from 'node:assert/strict'
import {
  isMacOSRuntime,
  normalizeMacOSAccessibilityStatus,
} from './macosPermissions'

test('isMacOSRuntime 只在 darwin 平台返回 true', () => {
  assert.equal(isMacOSRuntime('darwin'), true)
  assert.equal(isMacOSRuntime('win32'), false)
  assert.equal(isMacOSRuntime('browser'), false)
})

test('normalizeMacOSAccessibilityStatus 归一化权限状态', () => {
  assert.deepEqual(normalizeMacOSAccessibilityStatus({
    success: true,
    trusted: true,
    reason: 'accessibility_trusted',
  }), {
    success: true,
    trusted: true,
    reason: 'accessibility_trusted',
  })

  assert.deepEqual(normalizeMacOSAccessibilityStatus(null), {
    success: false,
    trusted: false,
    reason: 'invalid_result',
  })
})
