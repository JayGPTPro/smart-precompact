export type Meter = {
  percent: number
  tokens: number
  window: number
  /** What the session has cost so far, in US dollars, as /cost totals it. */
  costUsd?: number
  /** How much of the five-hour usage limit is used, 0 to 100. */
  fiveHour?: number
}

/** What the last compact took out of the context, shown after it as a receipt. */
export type Receipt = {
  before: number
  /** Filled in by the first reading after the compact when the compact did not report it. */
  after?: number
  /** When it ran, ms. */
  at: number
}

declare module 'claude-code' {
  interface PluginState {
    'smart-precompact-mod': {
      meter: Meter | null
      hasHandoff: boolean
      /** Hide holds the band back while the tier is below this; 0 shows it. */
      hiddenAtTier: number
      /** What a press is doing, and since when (ms); a stale one is ignored. */
      busy: { label: string; at: number } | null
      receipt: Receipt | null
    }
  }
}
