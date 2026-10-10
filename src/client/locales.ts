/** Locale dictionaries for the waste status bar. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'iAmRich'

/**
 * The coin that leads the bar.
 *
 * A glyph rather than an icon component: the bar ships as a bundle that keeps
 * React external, and a character renders identically in both dictionaries
 * without adding an SVG dependency or a second locale key.
 */
export const COIN = '🪙'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  // Each label is a complete phrase so the figure reads as a sentence: the bar
  // says what was wasted, not merely when.
  'period.today': '今日浪费',
  'period.month': '本月浪费',
  'period.total': '累计浪费',
  // The magnitude units, as a Chinese reader groups large numbers.
  'unit.plain': '',
  'unit.wan': '万',
  'unit.yi': '亿',
  // English scales never reach the zh dictionary, but the key set must match.
  'unit.thousand': 'K',
  'unit.million': 'M',
  'unit.billion': 'B',
  'waste.unit': 'Token',
  'waste.scale': 'zh',
  'waste.aria': 'Token 浪费统计',
  'waste.tooltip': '今日浪费 {today} · 本月浪费 {month} · 累计浪费 {total}',
  'waste.calls': '{calls} 次调用（已计费）',
  'waste.unpriced': '另有 {calls} 次调用未报告用量',
  'waste.none': '还没浪费 Token',
  'waste.stale': '账本暂不可用，显示的是最后一次数据',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<IAmRichKey, string> = {
  // Mirrors zh: each label names the waste, not just the period.
  'period.today': 'Wasted today',
  'period.month': 'Wasted this month',
  'period.total': 'Wasted all time',
  // English readers group large numbers by thousands, not by 万/亿.
  'unit.plain': '',
  'unit.wan': 'K',
  'unit.yi': 'M',
  'unit.thousand': 'K',
  'unit.million': 'M',
  'unit.billion': 'B',
  'waste.unit': 'tokens',
  'waste.scale': 'en',
  'waste.aria': 'Token waste statistics',
  'waste.tooltip': 'Wasted today {today} · Wasted this month {month} · Wasted all time {total}',
  'waste.calls': '{calls} billed calls',
  'waste.unpriced': '{calls} more calls reported no usage',
  'waste.none': 'No tokens wasted yet',
  'waste.stale': 'Ledger unavailable, showing the last known figures',
}

/** Key domain of the `iAmRich` namespace (zh is the source of truth). */
export type IAmRichKey = keyof typeof zh