/** Locale dictionaries for the waste status bar. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'iAmRich'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'period.today': '今日',
  'period.month': '本月',
  'period.total': '累计',
  'waste.unit': 'Token',
  'waste.aria': 'Token 浪费统计',
  'waste.tooltip': '今日 {today} · 本月 {month} · 累计 {total}',
  'waste.calls': '{calls} 次调用（已计费）',
  'waste.unpriced': '另有 {calls} 次调用未报告用量',
  'waste.none': '还没浪费 Token',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<IAmRichKey, string> = {
  'period.today': 'Today',
  'period.month': 'This month',
  'period.total': 'All time',
  'waste.unit': 'tokens',
  'waste.aria': 'Token waste statistics',
  'waste.tooltip': 'Today {today} · This month {month} · All time {total}',
  'waste.calls': '{calls} billed calls',
  'waste.unpriced': '{calls} more calls reported no usage',
  'waste.none': 'No tokens wasted yet',
}

/** Key domain of the `iAmRich` namespace (zh is the source of truth). */
export type IAmRichKey = keyof typeof zh