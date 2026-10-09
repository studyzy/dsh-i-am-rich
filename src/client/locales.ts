/** Locale dictionaries for the waste status bar. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'richPerson'

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh = {
  'waste.today': '咱今天又浪费了 {tokens} Token',
  'waste.todayTooltip': '这些 Token 由重复发送后丢弃的请求消耗：{calls} 次调用',
  'waste.none': '今天还没浪费 Token',
  'waste.unpriced': '另有 {calls} 次调用未报告用量',
} as const

/** English dictionary, key-identical to the Chinese source of truth. */
export const en: Record<RichPersonKey, string> = {
  'waste.today': 'Wasted {tokens} tokens today',
  'waste.todayTooltip': 'Burned by requests sent twice and discarded: {calls} calls',
  'waste.none': 'No tokens wasted today',
  'waste.unpriced': '{calls} more calls reported no usage',
}

/** Key domain of the `richPerson` namespace (zh is the source of truth). */
export type RichPersonKey = keyof typeof zh