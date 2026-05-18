import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { VoiceHistoryItem } from './historyStore'
import {
  RECENT_DASHBOARD_RESULT_LIMIT,
  prependRecentDashboardResult,
  selectRecentDashboardResults,
} from './recentDashboardResults'

function historyItem(overrides: Partial<VoiceHistoryItem> & { id: string }): VoiceHistoryItem {
  return {
    createdAt: '2026-05-18T00:00:00.000Z',
    mode: 'Dictate',
    status: 'completed',
    rawText: '',
    refinedText: '',
    durationMs: 0,
    textLength: 0,
    ...overrides,
  }
}

test('selectRecentDashboardResults 只取非自由提问的最近三条完成结果', () => {
  const results = selectRecentDashboardResults([
    historyItem({ id: '1', refinedText: '第一条润色' }),
    historyItem({ id: '2', mode: 'Ask', refinedText: '自由提问不进首页' }),
    historyItem({ id: '3', rawText: '第二条原文' }),
    historyItem({ id: '4', status: 'error', refinedText: '错误不展示' }),
    historyItem({ id: '5', refinedText: '   ' }),
    historyItem({ id: '6', refinedText: '第三条润色' }),
    historyItem({ id: '7', refinedText: '第四条被截断' }),
  ])

  assert.equal(RECENT_DASHBOARD_RESULT_LIMIT, 3)
  assert.deepEqual(results, [
    { id: '1', text: '第一条润色' },
    { id: '3', text: '第二条原文' },
    { id: '6', text: '第三条润色' },
  ])
})

test('prependRecentDashboardResult 会把新结果放到顶部并按 id 去重', () => {
  const current = [
    { id: '1', text: '旧第一条' },
    { id: '2', text: '旧第二条' },
    { id: '3', text: '旧第三条' },
  ]

  assert.deepEqual(prependRecentDashboardResult(current, { id: '2', text: '更新后的第二条' }), [
    { id: '2', text: '更新后的第二条' },
    { id: '1', text: '旧第一条' },
    { id: '3', text: '旧第三条' },
  ])

  assert.deepEqual(prependRecentDashboardResult(current, { id: '4', text: '新结果' }), [
    { id: '4', text: '新结果' },
    { id: '1', text: '旧第一条' },
    { id: '2', text: '旧第二条' },
  ])
})
