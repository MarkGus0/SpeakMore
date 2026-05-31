/**
 * 首页整体个性化分数
 *
 * 只负责把累计统计和启用词条数量转换为展示百分比。
 */
export const DASHBOARD_PERSONALIZATION_ANCHORS = {
  durationMinutes: 60000,
  textLength: 10000000,
  dictionaryCount: 2000,
} as const

export type DashboardPersonalizationInput = {
  totalDurationMs: number
  totalTextLength: number
  activeDictionaryCount: number
}

function normalizeScore(value: number, anchor: number) {
  const ratio = Math.max(0, Number(value) || 0) / anchor
  return Math.min(1, Math.pow(ratio, 0.55))
}

export function calculateDashboardPersonalization(input: DashboardPersonalizationInput): number {
  const durationMinutes = Math.max(0, Number(input.totalDurationMs) || 0) / 60000
  const durationScore = normalizeScore(durationMinutes, DASHBOARD_PERSONALIZATION_ANCHORS.durationMinutes)
  const textScore = normalizeScore(input.totalTextLength, DASHBOARD_PERSONALIZATION_ANCHORS.textLength)
  const dictionaryScore = normalizeScore(input.activeDictionaryCount, DASHBOARD_PERSONALIZATION_ANCHORS.dictionaryCount)

  return Math.round(100 * (
    0.25 * durationScore
    + 0.30 * textScore
    + 0.45 * dictionaryScore
  ))
}
