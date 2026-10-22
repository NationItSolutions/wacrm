// Shared result shapes the dashboard components consume. Centralised
// here so each component stays thin and the page-level loader wires
// them up without type gymnastics.

export interface MetricDelta {
  current: number
  previous: number
}

export interface MetricsBundle {
  activeConversations: MetricDelta
  newContactsToday: MetricDelta
  openDealsValue: number
  openDealsCount: number
  messagesSentToday: MetricDelta
}

export interface ConversationsSeriesPoint {
  day: string // YYYY-MM-DD local
  incoming: number
  outgoing: number
}

export interface PipelineStageSlice {
  id: string
  name: string
  color: string
  dealCount: number
  totalValue: number
}

export interface PipelineDonutData {
  stages: PipelineStageSlice[]
  totalValue: number
}

export interface ResponseTimeBucket {
  /** 0 = Mon … 6 = Sun (Monday-first). */
  dow: number
  /** Average first-response time in minutes. Null means no samples. */
  avgMinutes: number | null
  samples: number
}

export interface ResponseTimeSummary {
  buckets: ResponseTimeBucket[]
  thisWeekAvg: number | null
  lastWeekAvg: number | null
}

export type ActivityKind =
  | 'message'
  | 'deal'
  | 'broadcast'
  | 'automation'
  | 'contact'

/**
 * Locale-free description of an activity line. The feed renders it via
 * `Dashboard.activityFeed.items.<key>` so the text follows the UI
 * language; `text` stays as the pre-formatted English fallback.
 * Empty-string values mean "unknown" and get a translated fallback.
 */
export type ActivityMessage =
  | { key: 'newMessage'; values: { who: string } }
  | { key: 'newContact'; values: { name: string } }
  | { key: 'dealInStage'; values: { title: string; stage: string } }
  | { key: 'dealUpdated'; values: { title: string } }
  | { key: 'broadcastSent'; values: { name: string; count: number } }
  | { key: 'broadcastStatus'; values: { name: string; status: string; count: number } }
  | { key: 'automationTriggered' | 'automationFailed'; values: { name: string; who: string } }

export interface ActivityItem {
  id: string
  kind: ActivityKind
  /** Primary line of text rendered in the feed. Pre-formatted (English). */
  text: string
  /** Structured form of `text` for localized rendering. */
  message?: ActivityMessage
  /** ISO timestamp the item happened at, drives relative-time + sort. */
  at: string
  /** Optional deep-link for the whole row (not all items have a target). */
  href?: string
}
