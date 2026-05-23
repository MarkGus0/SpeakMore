/**
 * 首页最近结果筛选规则
 *
 * 需要从历史记录中提取非自由提问的最近完成结果时看这里。
 */
import type { VoiceHistoryItem } from './historyStore'

export const RECENT_DASHBOARD_RESULT_LIMIT = 3

export type RecentDashboardResult = {
  id: string
  text: string
}

function finalResultText(item: Pick<VoiceHistoryItem, 'rawText' | 'refinedText'>): string {
  return (item.refinedText || item.rawText).trim()
}

function toRecentDashboardResult(item: VoiceHistoryItem): RecentDashboardResult | null {
  if (item.status !== 'completed') return null
  if (item.mode === 'Ask') return null

  const text = finalResultText(item)
  return text ? { id: item.id, text } : null
}

function normalizeRecentDashboardResult(result: RecentDashboardResult): RecentDashboardResult | null {
  const text = result.text.trim()
  return text ? { id: result.id, text } : null
}

export function selectRecentDashboardResults(
  items: VoiceHistoryItem[],
  limit = RECENT_DASHBOARD_RESULT_LIMIT,
): RecentDashboardResult[] {
  const results: RecentDashboardResult[] = []

  for (const item of items) {
    if (results.length >= limit) break

    const result = toRecentDashboardResult(item)
    if (result) results.push(result)
  }

  return results
}

export function prependRecentDashboardResult(
  current: RecentDashboardResult[],
  next: RecentDashboardResult,
  limit = RECENT_DASHBOARD_RESULT_LIMIT,
): RecentDashboardResult[] {
  const normalized = normalizeRecentDashboardResult(next)
  if (!normalized) return current.slice(0, limit)

  return [
    normalized,
    ...current.filter((item) => item.id !== normalized.id),
  ].slice(0, limit)
}
