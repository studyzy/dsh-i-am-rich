/** Locale dictionaries for the waste status bar. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'iAmRich'

/**
 * The money bag that leads the bar.
 *
 * A glyph rather than an icon component: the bar ships as a bundle that keeps
 * React external, and a character renders identically in both dictionaries
 * without adding an SVG dependency or a second locale key.
 *
 * A money bag rather than U+1FA99 "COIN", which is the glyph literally named
 * after a coin: Apple renders U+1FA99 as a pale, silver-toned coin that reads
 * as a generic token rather than as money. U+1F4B0 is unmistakably gold on the
 * same font, so the bar actually looks like the wealth it is counting.
 *
 * The spacing between this glyph and the label beside it is NOT baked in here.
 * It is the icon's own `marginRight` in `StatusBar.tsx`, so this string stays a
 * bare glyph — no trailing space to leak into the tooltip, into a copied
 * figure, or into a test that reads the text.
 */
export const COIN = '💰'

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
  // The fortune tier picker, shown above the periods when the bar is expanded.
  'fortune.legend': '富豪程度',
  'fortune.millionaire': '千万富翁',
  'fortune.billionaire': '亿万富翁',
  'fortune.hint.millionaire': '第二份请求与原请求完全相同，通常会命中提示词缓存，按缓存读取价计费。',
  'fortune.hint.billionaire': '第二份请求前面插入一段前缀，改变提示词前缀使缓存必然不命中，按缓存写入价计费，费用高得多。',
  'fortune.saving': '正在保存…',
  'fortune.saved': '已保存，立即生效',
  'fortune.failed': '保存失败，仍是原来的档位',
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
  // Mirrors zh: the same legend, the same two tiers, the same two mechanisms.
  'fortune.legend': 'Fortune',
  'fortune.millionaire': 'Millionaire',
  'fortune.billionaire': 'Billionaire',
  'fortune.hint.millionaire': 'The second request is identical to the first, so it usually rides the prompt cache and is billed at the cache-read rate.',
  'fortune.hint.billionaire': 'The second request carries an inserted prefix, so the prompt prefix changes, the cache always misses, and it is billed at the cache-write rate — far more expensive.',
  'fortune.saving': 'Saving…',
  'fortune.saved': 'Saved, active now',
  'fortune.failed': 'Could not save; still on the previous tier',
}

/** Key domain of the `iAmRich` namespace (zh is the source of truth). */
export type IAmRichKey = keyof typeof zh