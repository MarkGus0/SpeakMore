import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  calculateDashboardPersonalization,
  DASHBOARD_PERSONALIZATION_ANCHORS,
} from './dashboardPersonalization'

const fullDurationMs = DASHBOARD_PERSONALIZATION_ANCHORS.durationMinutes * 60000

test('calculateDashboardPersonalization 没有本地积累时返回 0', () => {
  assert.equal(calculateDashboardPersonalization({
    totalDurationMs: 0,
    totalTextLength: 0,
    activeDictionaryCount: 0,
  }), 0)
})

test('calculateDashboardPersonalization 按确认权重计算三项满分贡献', () => {
  assert.equal(calculateDashboardPersonalization({
    totalDurationMs: fullDurationMs,
    totalTextLength: 0,
    activeDictionaryCount: 0,
  }), 25)

  assert.equal(calculateDashboardPersonalization({
    totalDurationMs: 0,
    totalTextLength: DASHBOARD_PERSONALIZATION_ANCHORS.textLength,
    activeDictionaryCount: 0,
  }), 30)

  assert.equal(calculateDashboardPersonalization({
    totalDurationMs: 0,
    totalTextLength: 0,
    activeDictionaryCount: DASHBOARD_PERSONALIZATION_ANCHORS.dictionaryCount,
  }), 45)
})

test('calculateDashboardPersonalization 达到或超过长期锚点时返回 100', () => {
  assert.equal(calculateDashboardPersonalization({
    totalDurationMs: fullDurationMs,
    totalTextLength: DASHBOARD_PERSONALIZATION_ANCHORS.textLength,
    activeDictionaryCount: DASHBOARD_PERSONALIZATION_ANCHORS.dictionaryCount,
  }), 100)

  assert.equal(calculateDashboardPersonalization({
    totalDurationMs: fullDurationMs * 2,
    totalTextLength: DASHBOARD_PERSONALIZATION_ANCHORS.textLength * 2,
    activeDictionaryCount: DASHBOARD_PERSONALIZATION_ANCHORS.dictionaryCount * 2,
  }), 100)
})

test('calculateDashboardPersonalization 会裁剪非法负值', () => {
  assert.equal(calculateDashboardPersonalization({
    totalDurationMs: -1,
    totalTextLength: -1,
    activeDictionaryCount: -1,
  }), 0)
})
