import type { Candle } from './binance'
import type { MaCrossInfo, MaCrossPair, MaCrossPairKey, Signal, SignalChange, TfSignalHistory, VidyaInfo } from './types'

export function closes(candles: Candle[]): number[] {
  return candles.map((c) => c.close)
}

export function ema(values: number[], period: number): number {
  if (values.length === 0) return 0
  const k = 2 / (period + 1)
  let e = values[0]
  for (let i = 1; i < values.length; i++) e = values[i] * k + e * (1 - k)
  return e
}

/** Full EMA series (same length as input) — needed for rolling calcs like MA crosses. */
export function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return []
  const k = 2 / (period + 1)
  const out: number[] = [values[0]]
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k))
  return out
}

/** Simple Moving Average — arithmetic mean of the last `period` closes, same definition TradingView uses. */
export function sma(values: number[], period: number): number {
  if (values.length === 0) return 0
  const p = Math.min(period, values.length)
  let sum = 0
  for (let i = values.length - p; i < values.length; i++) sum += values[i]
  return sum / p
}

export function rsi(values: number[], period = 14): number {
  if (values.length < period + 1) return 50
  let gains = 0
  let losses = 0
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1]
    if (diff >= 0) gains += diff
    else losses -= diff
  }
  if (losses === 0) return 100
  const rs = gains / period / (losses / period)
  return 100 - 100 / (1 + rs)
}

export function macdHist(values: number[]): number {
  if (values.length < 26) return 0
  const fastSeries = emaSeries(values, 12)
  const slowSeries = emaSeries(values, 26)
  const macdLine = fastSeries.map((f, i) => f - slowSeries[i])
  const signalLine = emaSeries(macdLine, 9)
  return macdLine[macdLine.length - 1] - signalLine[signalLine.length - 1]
}

function slopePct(values: number[]): number {
  if (values.length < 2) return 0
  const first = values[0]
  const last = values[values.length - 1]
  if (first === 0) return 0
  return ((last - first) / Math.abs(first)) * 100
}

/** True Range series. */
function trueRange(candles: Candle[]): number[] {
  const out: number[] = []
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      out.push(candles[i].high - candles[i].low)
      continue
    }
    const prevClose = candles[i - 1].close
    const hl = candles[i].high - candles[i].low
    const hc = Math.abs(candles[i].high - prevClose)
    const lc = Math.abs(candles[i].low - prevClose)
    out.push(Math.max(hl, hc, lc))
  }
  return out
}

/** Wilder ATR (RMA smoothing). NaN until `period` candles exist. */
export function atrSeries(candles: Candle[], period: number): number[] {
  const tr = trueRange(candles)
  const out: number[] = []
  let prevAtr = 0
  for (let i = 0; i < tr.length; i++) {
    if (i < period) {
      // seed with simple average of the first `period` TRs
      prevAtr = tr.slice(0, period).reduce((a, b) => a + b, 0) / period
      out.push(i === period - 1 ? prevAtr : NaN)
    } else {
      prevAtr = (prevAtr * (period - 1) + tr[i]) / period
      out.push(prevAtr)
    }
  }
  return out
}

/**
 * Latest real Wilder ATR value in price units — used for ATR-based stop-loss sizing.
 * Gracefully shrinks the period for short candle series instead of returning 0/NaN.
 */
export function atr(candles: Candle[], period = 14): number {
  if (candles.length < 2) return 0
  const effectivePeriod = Math.max(1, Math.min(period, candles.length - 1))
  const series = atrSeries(candles, effectivePeriod)
  for (let i = series.length - 1; i >= 0; i--) {
    if (!Number.isNaN(series[i])) return series[i]
  }
  return 0
}

export interface VidyaOptions {
  /** VIDYA smoothing length (alpha = 2 / (length + 1)). */
  length?: number
  /** Chande Momentum Oscillator window. */
  momentum?: number
  /** ATR multiplier for the upper/lower flip bands. */
  bandFactor?: number
  /** SMA smoothing applied to the raw VIDYA line. */
  smooth?: number
  /** Wilder ATR length for the bands. */
  atrLength?: number
}

interface VidyaCore {
  cl: number[]
  line: number[]
  /** Trend after each bar: true = UP, false = DOWN, null = no confirmed flip yet. */
  upSeries: (boolean | null)[]
  flipIndex: number
  lastUpper: number
  lastLower: number
}

/** Shared VIDYA engine: line, ATR flip bands and the per-bar trend. Used by vidya() and vidyaSignalSeries(). */
function vidyaCore(candles: Candle[], opts: VidyaOptions): VidyaCore | null {
  const { length = 10, momentum = 20, bandFactor = 2, smooth = 15, atrLength = 200 } = opts
  const n = candles.length
  if (n < 20) return null

  const cl = candles.map((c) => c.close)
  const alpha = 2 / (length + 1)

  // --- raw VIDYA (CMO-adaptive) ---
  const raw: number[] = new Array(n)
  raw[0] = cl[0]
  const pos: number[] = new Array(n).fill(0)
  const neg: number[] = new Array(n).fill(0)
  let sumPos = 0
  let sumNeg = 0
  for (let i = 1; i < n; i++) {
    const diff = cl[i] - cl[i - 1]
    pos[i] = diff > 0 ? diff : 0
    neg[i] = diff < 0 ? -diff : 0
    sumPos += pos[i]
    sumNeg += neg[i]
    const drop = i - momentum
    if (drop >= 1) {
      sumPos -= pos[drop]
      sumNeg -= neg[drop]
    }
    const denom = sumPos + sumNeg
    const absCmo = denom === 0 ? 0 : Math.abs((sumPos - sumNeg) / denom) // 0..1
    const k = alpha * absCmo
    raw[i] = k * cl[i] + (1 - k) * raw[i - 1]
  }

  // --- SMA smoothing (partial window at the start) ---
  const line: number[] = new Array(n)
  let run = 0
  for (let i = 0; i < n; i++) {
    run += raw[i]
    if (i >= smooth) run -= raw[i - smooth]
    line[i] = run / Math.min(i + 1, smooth)
  }

  // --- ATR flip bands ---
  const atrPeriod = Math.max(1, Math.min(atrLength, n - 1))
  const atrs = atrSeries(candles, atrPeriod)

  // --- trend ---
  const upSeries: (boolean | null)[] = new Array(n)
  let up: boolean | null = null
  let flipIndex = -1
  let prevUpper = NaN
  let prevLower = NaN
  let lastUpper = line[n - 1]
  let lastLower = line[n - 1]

  for (let i = 0; i < n; i++) {
    const a = atrs[i]
    if (!Number.isNaN(a)) {
      const upper = line[i] + a * bandFactor
      const lower = line[i] - a * bandFactor
      lastUpper = upper
      lastLower = lower
      if (i > 0 && !Number.isNaN(prevUpper)) {
        const crossUp = cl[i] > upper && cl[i - 1] <= prevUpper
        const crossDn = cl[i] < lower && cl[i - 1] >= prevLower
        let next: boolean | null = up
        if (crossUp) next = true
        else if (crossDn) next = false
        if (next !== up) {
          up = next
          flipIndex = i
        }
      }
      prevUpper = upper
      prevLower = lower
    }
    upSeries[i] = up
  }

  return { cl, line, upSeries, flipIndex, lastUpper, lastLower }
}

/**
 * Volumatic VIDYA, after BigBeluga's TradingView indicator:
 *  1. VIDYA = CMO-adaptive EMA (alpha scales with |CMO| over `momentum` closes), then SMA(`smooth`).
 *  2. Flip bands = VIDYA +/- ATR(`atrLength`) x `bandFactor`.
 *  3. Trend turns UP when close crosses above the upper band, DOWN when it crosses below the lower band.
 *  4. Buy volume (close > open) and sell volume (close < open) accumulate from the start of each trend leg.
 *
 * Two deliberate differences from Pine: the raw VIDYA is seeded with the first close (Pine seeds with 0,
 * which needs hundreds of bars to converge), and ATR length / SMA window shrink on short series instead of
 * returning nothing, so the 3m/5m/15m buckets still get a reading.
 */
export function vidya(candles: Candle[], opts: VidyaOptions = {}): VidyaInfo | null {
  const core = vidyaCore(candles, opts)
  if (!core) return null
  const n = candles.length
  const { cl, line, upSeries, flipIndex, lastUpper, lastLower } = core

  // Buy/sell volume accumulates from the bar of the last flip (or from the start when no flip exists).
  let buyVol = 0
  let sellVol = 0
  for (let i = Math.max(flipIndex, 0); i < n; i++) {
    const c = candles[i]
    if (c.close > c.open) buyVol += c.volume
    else if (c.close < c.open) sellVol += c.volume
  }

  const last = n - 1
  const up = upSeries[last]
  const confirmed = up !== null
  const direction: 'UP' | 'DOWN' = (up ?? cl[last] >= line[last]) ? 'UP' : 'DOWN'
  const total = buyVol + sellVol
  return {
    direction,
    value: line[last],
    upperBand: lastUpper,
    lowerBand: lastLower,
    justFlipped: flipIndex === last,
    barsSinceFlip: flipIndex === -1 ? -1 : last - flipIndex,
    buyVolume: buyVol,
    sellVolume: sellVol,
    deltaPct: total > 0 ? ((buyVol - sellVol) / total) * 100 : 0,
    confirmed,
  }
}

/** How many of the last bars' signal changes are kept per timeframe (newest first). */
export const MAX_SIGNAL_CHANGES = 6

/**
 * BUY / SELL / NEUTRAL for EVERY bar, in one O(n) pass.
 *
 * Rule (identical to the live bucket vote): the Volumatic VIDYA direction must be backed by at least
 * `minConfirmations` of 3 confirmations — RSI(14) >= 52 / <= 48, MACD histogram sign, and >= 2 of the 3
 * EMA pairs (9/21, 21/50, 50/200) pointing the same way. Otherwise the bar is NEUTRAL.
 * The last element is therefore exactly the signal the grid shows right now.
 */
export function vidyaSignalSeries(candles: Candle[], minConfirmations = 2): Signal[] {
  const n = candles.length
  const out: Signal[] = new Array(n).fill('NEUTRAL')
  const core = vidyaCore(candles, {})
  if (!core) return out
  const { cl, line, upSeries } = core

  // MACD histogram per bar (EMAs are causal, so the prefix value equals a fresh calc on that prefix).
  const fast = emaSeries(cl, 12)
  const slow = emaSeries(cl, 26)
  const macdLine = fast.map((f, i) => f - slow[i])
  const sig = emaSeries(macdLine, 9)

  // EMA pairs per bar.
  const p200 = Math.min(200, n)
  const s9 = emaSeries(cl, 9)
  const s21 = emaSeries(cl, 21)
  const s50 = emaSeries(cl, 50)
  const s200 = emaSeries(cl, p200)

  const rsiPeriod = 14
  for (let i = 19; i < n; i++) {
    // RSI: same simple 14-diff average as rsi() so the last bar matches exactly.
    let gains = 0
    let losses = 0
    for (let j = i - rsiPeriod + 1; j <= i; j++) {
      const diff = cl[j] - cl[j - 1]
      if (diff >= 0) gains += diff
      else losses -= diff
    }
    const r = losses === 0 ? 100 : 100 - 100 / (1 + gains / rsiPeriod / (losses / rsiPeriod))

    const m = i + 1 >= 26 ? macdLine[i] - sig[i] : 0
    const bull = (s9[i] > s21[i] ? 1 : 0) + (s21[i] > s50[i] ? 1 : 0) + (s50[i] > s200[i] ? 1 : 0)
    const bear = 3 - bull

    const bullish = (upSeries[i] ?? cl[i] >= line[i]) === true
    let agree = 0
    if (bullish && r >= 52) agree++
    if (!bullish && r <= 48) agree++
    if (bullish && m > 0) agree++
    if (!bullish && m < 0) agree++
    if ((bullish ? bull : bear) >= 2) agree++

    if (agree >= minConfirmations) out[i] = bullish ? 'BUY' : 'SELL'
  }
  return out
}

/** Turns a per-bar signal series into "current state + how long + last N changes (newest first)". */
export function summarizeSignalHistory(candles: Candle[], series: Signal[]): TfSignalHistory {
  const n = series.length
  if (n === 0) return { current: 'NEUTRAL', barsInState: -1, sinceTime: 0, changes: [] }
  const changes: SignalChange[] = []
  // Skip the warm-up zone (bars < 19 are forced NEUTRAL) so it never shows up as a fake "change".
  for (let i = n - 1; i >= 20 && changes.length < MAX_SIGNAL_CHANGES; i--) {
    if (series[i] !== series[i - 1]) {
      changes.push({ from: series[i - 1], to: series[i], time: candles[i].openTime, barsAgo: n - 1 - i })
    }
  }
  const latest = changes[0]
  return {
    current: series[n - 1],
    barsInState: latest ? latest.barsAgo : -1,
    sinceTime: latest ? latest.time : 0,
    changes,
  }
}

/**
 * EMA 9 / 21 / 50 / 200 crosses: state and age of each adjacent pair (9/21, 21/50, 50/200).
 * Crosses are only counted once the slower EMA has had `period` candles to warm up, so the
 * artificial "cross" at the start of every EMA series (all seeded with the first close) is ignored.
 */
export function maCross(values: number[]): MaCrossInfo | null {
  const n = values.length
  if (n < 2) return null
  const p200 = Math.min(200, n)
  const s9 = emaSeries(values, 9)
  const s21 = emaSeries(values, 21)
  const s50 = emaSeries(values, 50)
  const s200 = emaSeries(values, p200)

  const build = (fast: number[], slow: number[], slowPeriod: number): MaCrossPair => {
    const last = n - 1
    const state: 'BULL' | 'BEAR' = fast[last] > slow[last] ? 'BULL' : 'BEAR'
    const warmup = Math.min(slowPeriod, n - 1)
    for (let i = last; i >= Math.max(1, warmup); i--) {
      const nowBull = fast[i] > slow[i]
      const prevBull = fast[i - 1] > slow[i - 1]
      if (nowBull !== prevBull) return { state, barsSinceCross: last - i }
    }
    return { state, barsSinceCross: -1 }
  }

  const pairs: Record<MaCrossPairKey, MaCrossPair> = {
    '9/21': build(s9, s21, 21),
    '21/50': build(s21, s50, 50),
    '50/200': build(s50, s200, p200),
  }

  const keys = Object.keys(pairs) as MaCrossPairKey[]
  const bullPairs = keys.filter((k) => pairs[k].state === 'BULL').length
  const bearPairs = keys.length - bullPairs
  const bias = bullPairs === 3 ? 'BULLISH' : bearPairs === 3 ? 'BEARISH' : 'MIXED'

  let lastCross: MaCrossInfo['lastCross'] = null
  for (const k of keys) {
    const b = pairs[k].barsSinceCross
    if (b >= 0 && (lastCross === null || b < lastCross.barsAgo)) {
      lastCross = { pair: k, type: pairs[k].state, barsAgo: b }
    }
  }

  return {
    ema9: s9[n - 1],
    ema21: s21[n - 1],
    ema50: s50[n - 1],
    ema200: s200[n - 1],
    pairs,
    bias,
    bullPairs,
    bearPairs,
    lastCross,
    sufficientData: n >= 210,
  }
}

/** Aggregate N consecutive candles into one OHLC bar (real resampling, oldest -> newest). */
export function resample(candles: Candle[], factor: number): Candle[] {
  const out: Candle[] = []
  for (let i = 0; i + factor <= candles.length; i += factor) {
    const chunk = candles.slice(i, i + factor)
    out.push({
      openTime: chunk[0].openTime,
      open: chunk[0].open,
      high: Math.max(...chunk.map((c) => c.high)),
      low: Math.min(...chunk.map((c) => c.low)),
      close: chunk[chunk.length - 1].close,
      volume: chunk.reduce((s, c) => s + c.volume, 0),
    })
  }
  return out
}

export { slopePct }
