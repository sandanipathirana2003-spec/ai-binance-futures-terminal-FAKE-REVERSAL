// Multi-timeframe FAKE-REVERSAL filter (1m entry timeframe, 3m confirmation timeframe).
//
// Hard guarantees (all enforced here and covered by scripts/test-fake-reversal.ts):
//  * Only CLOSED candles are ever read. The still-forming 1m candle Binance returns as the last kline is dropped.
//  * No future data, no repainting. Every decision at bar i is computed from bars <= i only. The whole history is
//    replayed through the same state machine, so an old event can never change when new candles arrive.
//  * A single MA 7/25 crossover never produces an entry. The best a lone crossover can do is EARLY WARNING;
//    CONFIRMED needs a later, fully closed 3m candle that agrees, plus the confidence gate.
//  * Every signal and every rejection carries the exact numbers/reasons that produced it.
//
// Three signal states: EARLY_WARNING, CONFIRMED, REJECTED (NONE = nothing happening).
// Display labels: EARLY REVERSAL, CONFIRMED ENTRY, WAIT (choppy), REVERSAL FAILED, REJECTED.

import type { Candle } from './binance'
import { atrSeries } from './indicators'

export type ReversalState = 'NONE' | 'EARLY_WARNING' | 'CONFIRMED' | 'REJECTED'
export type ReversalDirection = 'LONG' | 'SHORT'
export type RejectKind = 'CHOP' | 'REVERSAL_FAILED' | 'TIMEOUT' | 'LOW_CONFIDENCE'
export type ConfidenceTier = 'HIGH' | 'MEDIUM' | 'LOW'
export type ReversalLabel = 'EARLY REVERSAL' | 'CONFIRMED ENTRY' | 'WAIT' | 'REVERSAL FAILED' | 'REJECTED' | '—'

export interface FakeReversalConfig {
  fastMa: number
  slowMa: number
  trendMa: number
  /** MA99 slope is measured over this many closed 1m bars. */
  slopeLookback: number
  atrPeriod: number
  supertrendPeriod: number
  supertrendMult: number
  /** MA99 change over `slopeLookback` bars, in ATR units. |slope| below this = "flat". */
  flatSlopeAtr: number
  /** Number of closed 1m bars used to average the MA7/MA25 separation. */
  chopLookback: number
  /** Average |MA7 - MA25| / ATR below this = "MAs are tangled". */
  chopMaxSepAtr: number
  /** After a 1m cross, the 3m candle must confirm within this many 1m bars or the setup is dropped. */
  confirmWindow1m: number
  /** CONFIRMED needs at least this confidence (0-100). */
  minConfidence: number
  /** Subtracted when MA99 (price side + slope) and Supertrend point opposite ways. */
  conflictPenalty: number
  /** A finished event (CONFIRMED / REJECTED) stays the "current" state for this many 1m bars. */
  activeTtl1m: number
  maxEvents: number
  /** A candle counts as closed only this long after its nominal close, so a not-yet-final kline is never used. */
  closeGraceMs: number
}

export const DEFAULT_FAKE_REVERSAL_CONFIG: FakeReversalConfig = {
  fastMa: 7,
  slowMa: 25,
  trendMa: 99,
  slopeLookback: 10,
  atrPeriod: 14,
  supertrendPeriod: 10,
  supertrendMult: 3,
  flatSlopeAtr: 0.6,
  chopLookback: 20,
  chopMaxSepAtr: 0.5,
  confirmWindow1m: 15,
  minConfidence: 40,
  conflictPenalty: 10,
  activeTtl1m: 15,
  maxEvents: 12,
  closeGraceMs: 2000,
}

export interface ReversalCheck {
  id: 'ma_cross' | 'price_vs_ma99' | 'ma99_slope' | 'supertrend' | 'tf3_confirm' | 'not_choppy'
  label: string
  /** null = not decidable yet (e.g. waiting for the 3m candle). */
  passed: boolean | null
  detail: string
}

export interface ReversalMetrics {
  price: number
  ma7: number
  ma25: number
  ma99: number
  /** MA99 change over the lookback, in ATR units (+ = rising). */
  ma99SlopeAtr: number
  atr: number
  supertrend: 'UP' | 'DOWN'
  /** Mean |MA7 - MA25| / ATR over the chop lookback. */
  avgSepAtr: number
  chop: boolean
  ma99Stance: 'UP' | 'DOWN' | 'MIXED'
  /** MA99 stance and Supertrend point opposite ways. */
  ma99StConflict: boolean
}

export interface ReversalEvent {
  id: string
  state: Exclude<ReversalState, 'NONE'>
  label: ReversalLabel
  rejectKind?: RejectKind
  direction: ReversalDirection
  /** Close time (ms) of the closed 1m bar on which this decision was made. */
  time: number
  /** Close time (ms) of the closed 1m bar that completed the MA7/25 crossover. */
  crossTime: number
  /** 1m bars between the crossover bar and the decision bar. */
  barsSinceCross: number
  confidence: number
  tier: ConfidenceTier
  reasons: string[]
  checks: ReversalCheck[]
}

export interface ReversalResult {
  state: ReversalState
  label: ReversalLabel
  direction: ReversalDirection | null
  rejectKind?: RejectKind
  confidence: number
  tier: ConfidenceTier
  /** Close time (ms) of the decision bar; for NONE it is the last closed bar. */
  time: number
  crossTime: number
  /** Exact reasons for the current state (always non-empty except for NONE). */
  reasons: string[]
  checks: ReversalCheck[]
  /** Metrics of the latest closed 1m bar. null when there is not enough history. */
  metrics: ReversalMetrics | null
  /** Every signal and rejection found in the replay window, newest first. */
  events: ReversalEvent[]
  /** Close time (ms) of the newest closed 1m bar that was used. 0 when none. */
  asOf: number
  /** Number of still-forming / not-yet-final candles that were ignored (should be 0 or 1). */
  ignoredOpenCandles: number
  insufficientData: boolean
}

const MIN = 60_000
const MIN3 = 180_000

// ---------- candle hygiene ----------

/** Keeps only candles whose interval has fully elapsed (+ grace). Never returns the forming candle. */
export function closedOnly(candles: Candle[], intervalMs: number, nowMs: number, graceMs: number): { closed: Candle[]; ignored: number } {
  let end = candles.length
  while (end > 0 && candles[end - 1].openTime + intervalMs + graceMs > nowMs) end--
  return { closed: candles.slice(0, end), ignored: candles.length - end }
}

/** Fills minutes with no trades using a flat candle at the previous close (zero volume), so bar indexes = minutes. */
export function fillGaps(candles: Candle[], intervalMs: number): Candle[] {
  if (candles.length === 0) return []
  const out: Candle[] = [candles[0]]
  for (let i = 1; i < candles.length; i++) {
    const prev = out[out.length - 1]
    const cur = candles[i]
    if (cur.openTime <= prev.openTime) continue // duplicate / out of order: ignore
    for (let t = prev.openTime + intervalMs; t < cur.openTime; t += intervalMs) {
      out.push({ openTime: t, open: prev.close, high: prev.close, low: prev.close, close: prev.close, volume: 0 })
    }
    out.push(cur)
  }
  return out
}

/** Clock-aligned 3m bars from closed 1m bars. Only complete buckets; `lastIdx1m[k]` = 1m index that completed bar k. */
export function buildAligned3m(c1: Candle[]): { bars: Candle[]; lastIdx1m: number[] } {
  const bars: Candle[] = []
  const lastIdx1m: number[] = []
  let i = 0
  while (i < c1.length) {
    const start = Math.floor(c1[i].openTime / MIN3) * MIN3
    // first bucket may start mid-bucket: skip it, it is incomplete
    if (c1[i].openTime !== start) {
      i++
      continue
    }
    if (i + 2 >= c1.length) break
    const a = c1[i]
    const b = c1[i + 1]
    const c = c1[i + 2]
    if (b.openTime !== start + MIN || c.openTime !== start + 2 * MIN) {
      i++
      continue
    }
    bars.push({
      openTime: start,
      open: a.open,
      high: Math.max(a.high, b.high, c.high),
      low: Math.min(a.low, b.low, c.low),
      close: c.close,
      volume: a.volume + b.volume + c.volume,
    })
    lastIdx1m.push(i + 2)
    i += 3
  }
  return { bars, lastIdx1m }
}

// ---------- indicators (all causal) ----------

export function smaSeries(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN)
  let sum = 0
  for (let i = 0; i < values.length; i++) {
    sum += values[i]
    if (i >= period) sum -= values[i - period]
    if (i >= period - 1) out[i] = sum / period
  }
  return out
}

/** Classic Supertrend. +1 = UP (price above the line), -1 = DOWN, 0 = not enough bars yet. */
export function supertrendDir(candles: Candle[], period: number, mult: number): number[] {
  const n = candles.length
  const dir: number[] = new Array(n).fill(0)
  const atrs = atrSeries(candles, period)
  let fu = NaN
  let fl = NaN
  let d = 0
  for (let i = 0; i < n; i++) {
    const a = atrs[i]
    if (Number.isNaN(a)) continue
    const hl2 = (candles[i].high + candles[i].low) / 2
    const bu = hl2 + mult * a
    const bl = hl2 - mult * a
    if (d === 0) {
      fu = bu
      fl = bl
      d = candles[i].close >= hl2 ? 1 : -1
    } else {
      const pc = candles[i - 1].close
      const nfu = bu < fu || pc > fu ? bu : fu
      const nfl = bl > fl || pc < fl ? bl : fl
      fu = nfu
      fl = nfl
      if (d === -1 && candles[i].close > fu) d = 1
      else if (d === 1 && candles[i].close < fl) d = -1
    }
    dir[i] = d
  }
  return dir
}

// ---------- helpers ----------

function fmt(v: number): string {
  if (!Number.isFinite(v)) return 'n/a'
  const a = Math.abs(v)
  if (a === 0) return '0'
  if (a >= 1000) return v.toFixed(2)
  if (a >= 1) return v.toFixed(4)
  return v.toPrecision(4)
}

function hhmm(ms: number): string {
  const d = new Date(ms)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

function tierOf(score: number, conflict: boolean, early: boolean): ConfidenceTier {
  let t: ConfidenceTier = score >= 90 ? 'HIGH' : score >= 60 ? 'MEDIUM' : 'LOW'
  // A conflict between MA99 and Supertrend, or a setup the 3m has not confirmed yet, can never be HIGH.
  if ((conflict || early) && t === 'HIGH') t = 'MEDIUM'
  return t
}

const LABEL_BY_KIND: Record<RejectKind, ReversalLabel> = {
  CHOP: 'WAIT',
  REVERSAL_FAILED: 'REVERSAL FAILED',
  TIMEOUT: 'REJECTED',
  LOW_CONFIDENCE: 'REJECTED',
}

export function emptyReversal(insufficientData = true, ignored = 0): ReversalResult {
  return {
    state: 'NONE',
    label: '—',
    direction: null,
    confidence: 0,
    tier: 'LOW',
    time: 0,
    crossTime: 0,
    reasons: insufficientData ? ['Not enough closed 1m candles yet for MA99 + slope + Supertrend.'] : [],
    checks: [],
    metrics: null,
    events: [],
    asOf: 0,
    ignoredOpenCandles: ignored,
    insufficientData,
  }
}

// ---------- the filter ----------

/**
 * Evaluates the fake-reversal filter for one symbol.
 * @param oneMin  raw 1m klines, oldest -> newest (the forming candle may be included; it is dropped here)
 * @param nowMs   wall-clock "now" in ms. Passed in (not read from Date) so replays/tests are deterministic.
 */
export function evaluateFakeReversal(
  oneMin: Candle[],
  nowMs: number,
  config: Partial<FakeReversalConfig> = {},
): ReversalResult {
  const cfg = { ...DEFAULT_FAKE_REVERSAL_CONFIG, ...config }
  const { closed, ignored } = closedOnly(oneMin, MIN, nowMs, cfg.closeGraceMs)
  const c1 = fillGaps(closed, MIN)
  const n = c1.length
  const start = cfg.trendMa - 1 + cfg.slopeLookback
  if (n <= start + 2) return emptyReversal(true, ignored)

  const cl = c1.map((c) => c.close)
  const ma7 = smaSeries(cl, cfg.fastMa)
  const ma25 = smaSeries(cl, cfg.slowMa)
  const ma99 = smaSeries(cl, cfg.trendMa)
  const atr = atrSeries(c1, cfg.atrPeriod)
  const st = supertrendDir(c1, cfg.supertrendPeriod, cfg.supertrendMult)

  const { bars: b3, lastIdx1m } = buildAligned3m(c1)
  const c3 = b3.map((b) => b.close)
  const m7_3 = smaSeries(c3, cfg.fastMa)
  const m25_3 = smaSeries(c3, cfg.slowMa)
  const k3At = new Map<number, number>()
  lastIdx1m.forEach((idx, k) => k3At.set(idx, k))

  const closeTime = (i: number) => c1[i].openTime + MIN

  const metricsAt = (i: number): ReversalMetrics => {
    const a = atr[i]
    const safeAtr = a > 0 ? a : NaN
    const slopeAtr = Number.isNaN(safeAtr) ? 0 : (ma99[i] - ma99[i - cfg.slopeLookback]) / safeAtr
    let sepSum = 0
    for (let j = i - cfg.chopLookback + 1; j <= i; j++) sepSum += Math.abs(ma7[j] - ma25[j])
    const avgSepAtr = Number.isNaN(safeAtr) ? 0 : sepSum / cfg.chopLookback / safeAtr
    const flat = Math.abs(slopeAtr) < cfg.flatSlopeAtr
    const chop = Number.isNaN(safeAtr) || (avgSepAtr < cfg.chopMaxSepAtr && flat)
    const above = cl[i] > ma99[i]
    const below = cl[i] < ma99[i]
    const stance: 'UP' | 'DOWN' | 'MIXED' =
      above && slopeAtr >= cfg.flatSlopeAtr ? 'UP' : below && slopeAtr <= -cfg.flatSlopeAtr ? 'DOWN' : 'MIXED'
    const stDir: 'UP' | 'DOWN' = st[i] >= 0 ? 'UP' : 'DOWN'
    return {
      price: cl[i],
      ma7: ma7[i],
      ma25: ma25[i],
      ma99: ma99[i],
      ma99SlopeAtr: slopeAtr,
      atr: a,
      supertrend: stDir,
      avgSepAtr,
      chop,
      ma99Stance: stance,
      ma99StConflict: stance !== 'MIXED' && stance !== stDir,
    }
  }

  const chopReason = (m: ReversalMetrics): string =>
    Number.isNaN(m.atr) || !(m.atr > 0)
      ? 'Sideways: ATR is zero, there is no price movement to trade.'
      : `Sideways: MA7/MA25 average separation ${fmt(m.avgSepAtr)} ATR (< ${cfg.chopMaxSepAtr}) over ${cfg.chopLookback} closed 1m bars ` +
        `and MA99 slope ${m.ma99SlopeAtr >= 0 ? '+' : ''}${fmt(m.ma99SlopeAtr)} ATR over ${cfg.slopeLookback} bars is flat (|slope| < ${cfg.flatSlopeAtr}).`

  /** Trend-filter checks for a direction at 1m bar i. tf3 = true/false/null (not evaluated yet). */
  const buildChecks = (dir: ReversalDirection, m: ReversalMetrics, crossIdx: number, i: number, tf3: { ok: boolean; detail: string } | null): { checks: ReversalCheck[]; score: number } => {
    const long = dir === 'LONG'
    const pos = long ? m.price > m.ma99 : m.price < m.ma99
    const slope = long ? m.ma99SlopeAtr >= cfg.flatSlopeAtr : m.ma99SlopeAtr <= -cfg.flatSlopeAtr
    const stOk = long ? m.supertrend === 'UP' : m.supertrend === 'DOWN'
    const slopeWord = Math.abs(m.ma99SlopeAtr) < cfg.flatSlopeAtr ? 'flat' : m.ma99SlopeAtr > 0 ? 'rising' : 'falling'
    const sgn = m.ma99SlopeAtr >= 0 ? '+' : ''
    const checks: ReversalCheck[] = [
      {
        id: 'ma_cross',
        label: '1m MA7/25 cross (closed candle)',
        passed: true,
        detail:
          `1m candle closing ${hhmm(closeTime(crossIdx))} closed with MA7 ${long ? 'above' : 'below'} MA25 ` +
          `(prev bar ${long ? 'MA7 <= MA25' : 'MA7 >= MA25'}).`,
      },
      {
        id: 'price_vs_ma99',
        label: 'Price vs MA99',
        passed: pos,
        detail: `Close ${fmt(m.price)} is ${m.price > m.ma99 ? 'above' : m.price < m.ma99 ? 'below' : 'on'} MA99 ${fmt(m.ma99)}; ${long ? 'LONG needs above' : 'SHORT needs below'}.`,
      },
      {
        id: 'ma99_slope',
        label: 'MA99 slope',
        passed: slope,
        detail: `MA99 ${slopeWord} (${sgn}${fmt(m.ma99SlopeAtr)} ATR over ${cfg.slopeLookback} bars); ${long ? 'LONG needs >= +' : 'SHORT needs <= -'}${cfg.flatSlopeAtr}.`,
      },
      {
        id: 'supertrend',
        label: `Supertrend(${cfg.supertrendPeriod},${cfg.supertrendMult})`,
        passed: stOk,
        detail: `1m Supertrend is ${m.supertrend}; ${long ? 'LONG needs UP' : 'SHORT needs DOWN'}.`,
      },
      {
        id: 'tf3_confirm',
        label: '3m candle confirmation',
        passed: tf3 ? tf3.ok : null,
        detail: tf3 ? tf3.detail : `Waiting for a closed 3m candle after ${hhmm(closeTime(crossIdx))} with MA7 ${long ? '>' : '<'} MA25 and close ${long ? 'above' : 'below'} MA25.`,
      },
      {
        id: 'not_choppy',
        label: 'Not sideways',
        passed: !m.chop,
        detail: m.chop ? chopReason(m) : `MA7/25 avg separation ${fmt(m.avgSepAtr)} ATR, MA99 slope ${sgn}${fmt(m.ma99SlopeAtr)} ATR: not a sideways market.`,
      },
    ]
    let score = 0
    if (pos) score += 25
    if (slope) score += 25
    if (stOk) score += 25
    if (tf3?.ok) score += 25
    if (m.ma99StConflict) score -= cfg.conflictPenalty
    void i
    return { checks, score: Math.max(0, score) }
  }

  const conflictReason = (m: ReversalMetrics): string =>
    `MA99 (price ${m.price > m.ma99 ? 'above' : 'below'} + slope ${m.ma99SlopeAtr >= 0 ? 'rising' : 'falling'}) points ${m.ma99Stance} but Supertrend points ${m.supertrend}: ` +
    `confidence lowered by ${cfg.conflictPenalty} and capped below HIGH.`

  const events: ReversalEvent[] = []
  const push = (e: Omit<ReversalEvent, 'id'>) => events.push({ ...e, id: `${e.time}-${e.state}-${e.direction}-${e.rejectKind ?? ''}` })

  let pending: { dir: ReversalDirection; crossIdx: number } | null = null

  for (let i = start; i < n; i++) {
    const crossUp = ma7[i] > ma25[i] && ma7[i - 1] <= ma25[i - 1]
    const crossDn = ma7[i] < ma25[i] && ma7[i - 1] >= ma25[i - 1]
    const m = metricsAt(i)

    // ---- 1) resolve a pending setup using only bars <= i ----
    if (pending) {
      const p = pending
      const opposite = p.dir === 'LONG' ? crossDn : crossUp
      const stFlipped = p.dir === 'LONG' ? st[i - 1] === 1 && st[i] === -1 : st[i - 1] === -1 && st[i] === 1
      const since = i - p.crossIdx

      if (opposite || stFlipped) {
        const { checks } = buildChecks(p.dir, m, p.crossIdx, i, null)
        push({
          state: 'REJECTED',
          label: 'REVERSAL FAILED',
          rejectKind: 'REVERSAL_FAILED',
          direction: p.dir,
          time: closeTime(i),
          crossTime: closeTime(p.crossIdx),
          barsSinceCross: since,
          confidence: 0,
          tier: 'LOW',
          reasons: [
            opposite
              ? `REVERSAL FAILED: 1m MA7 crossed back ${p.dir === 'LONG' ? 'below' : 'above'} MA25 on the candle closing ${hhmm(closeTime(i))}, ${since} bar(s) after the ${p.dir} cross and before the 3m candle confirmed.`
              : `REVERSAL FAILED: 1m Supertrend flipped ${p.dir === 'LONG' ? 'DOWN' : 'UP'} on the candle closing ${hhmm(closeTime(i))}, ${since} bar(s) after the ${p.dir} cross and before the 3m candle confirmed.`,
            'Setup cancelled. No entry.',
          ],
          checks,
        })
        pending = null
      } else {
        const k = k3At.get(i)
        let handled = false
        if (k !== undefined && since > 0 && k >= cfg.slowMa - 1) {
          const long = p.dir === 'LONG'
          const aligned = long ? m7_3[k] > m25_3[k] && c3[k] > m25_3[k] : m7_3[k] < m25_3[k] && c3[k] < m25_3[k]
          if (aligned) {
            handled = true
            const detail =
              `3m candle closing ${hhmm(b3[k].openTime + MIN3)}: MA7 ${fmt(m7_3[k])} ${long ? '>' : '<'} MA25 ${fmt(m25_3[k])} and close ${fmt(c3[k])} ${long ? 'above' : 'below'} MA25.`
            const { checks, score } = buildChecks(p.dir, m, p.crossIdx, i, { ok: true, detail })
            const tier = tierOf(score, m.ma99StConflict, false)
            const common = { direction: p.dir, time: closeTime(i), crossTime: closeTime(p.crossIdx), barsSinceCross: since, confidence: score, tier, checks }
            const passLines = checks.filter((c) => c.passed).map((c) => `PASS ${c.label}: ${c.detail}`)
            const failLines = checks.filter((c) => c.passed === false && c.id !== 'not_choppy').map((c) => `FAIL ${c.label}: ${c.detail}`)
            const conflictLine = m.ma99StConflict ? [conflictReason(m)] : []
            if (m.chop) {
              push({ ...common, state: 'REJECTED', label: 'WAIT', rejectKind: 'CHOP', confidence: 0, tier: 'LOW', reasons: [`WAIT: 3m confirmed but ${chopReason(m)}`, 'No entry in a choppy market.'] })
            } else if (score < cfg.minConfidence) {
              push({
                ...common,
                state: 'REJECTED',
                label: 'REJECTED',
                rejectKind: 'LOW_CONFIDENCE',
                reasons: [`REJECTED: confidence ${score} < required ${cfg.minConfidence} even after 3m confirmation.`, ...failLines, ...conflictLine, ...passLines],
              })
            } else {
              push({
                ...common,
                state: 'CONFIRMED',
                label: 'CONFIRMED ENTRY',
                reasons: [
                  `CONFIRMED ${p.dir}: 1m MA7/25 cross at ${hhmm(closeTime(p.crossIdx))} confirmed by a closed 3m candle at ${hhmm(closeTime(i))} (${since} bar(s) later). Confidence ${score}/100 (${tier}).`,
                  ...conflictLine,
                  ...failLines,
                  ...passLines,
                ],
              })
            }
            pending = null
          }
        }
        if (!handled && since >= cfg.confirmWindow1m) {
          const { checks, score } = buildChecks(p.dir, m, p.crossIdx, i, { ok: false, detail: `No closed 3m candle agreed with the ${p.dir} cross within ${cfg.confirmWindow1m} 1m bars.` })
          push({
            state: 'REJECTED',
            label: 'REJECTED',
            rejectKind: 'TIMEOUT',
            direction: p.dir,
            time: closeTime(i),
            crossTime: closeTime(p.crossIdx),
            barsSinceCross: since,
            confidence: score,
            tier: 'LOW',
            reasons: [`REJECTED: the 3m timeframe never confirmed the ${p.dir} cross within ${cfg.confirmWindow1m} closed 1m bars (cross at ${hhmm(closeTime(p.crossIdx))}).`],
            checks,
          })
          pending = null
        }
      }
    }

    // ---- 2) a new crossover on this closed bar ----
    if (crossUp || crossDn) {
      const dir: ReversalDirection = crossUp ? 'LONG' : 'SHORT'
      const { checks, score } = buildChecks(dir, m, i, i, null)
      const best = score + 25 // best case if the 3m later confirms
      const base = { direction: dir, time: closeTime(i), crossTime: closeTime(i), barsSinceCross: 0, checks }
      const passLines = checks.filter((c) => c.passed).map((c) => `PASS ${c.label}: ${c.detail}`)
      const failLines = checks.filter((c) => c.passed === false && c.id !== 'not_choppy').map((c) => `FAIL ${c.label}: ${c.detail}`)
      const conflictLine = m.ma99StConflict ? [conflictReason(m)] : []
      if (m.chop) {
        push({ ...base, state: 'REJECTED', label: 'WAIT', rejectKind: 'CHOP', confidence: 0, tier: 'LOW', reasons: [`WAIT: 1m MA7/25 ${dir} cross ignored. ${chopReason(m)}`] })
      } else if (best < cfg.minConfidence) {
        push({
          ...base,
          state: 'REJECTED',
          label: 'REJECTED',
          rejectKind: 'LOW_CONFIDENCE',
          confidence: score,
          tier: 'LOW',
          reasons: [`REJECTED: 1m ${dir} cross cannot reach confidence ${cfg.minConfidence}; best case with 3m confirmation is ${best}.`, ...failLines, ...conflictLine],
        })
      } else {
        push({
          ...base,
          state: 'EARLY_WARNING',
          label: 'EARLY REVERSAL',
          confidence: score,
          tier: tierOf(score, m.ma99StConflict, true),
          reasons: [
            `EARLY WARNING ${dir}: 1m MA7 crossed ${dir === 'LONG' ? 'above' : 'below'} MA25 on the candle that closed ${hhmm(closeTime(i))}. NOT an entry: waiting up to ${cfg.confirmWindow1m} 1m bars for a closed 3m candle to confirm.`,
            ...conflictLine,
            ...failLines,
            ...passLines,
          ],
        })
        pending = { dir, crossIdx: i }
      }
    }
  }

  // ---- current state ----
  const last = n - 1
  const lastM = metricsAt(last)
  events.reverse() // newest first
  const shown = events.slice(0, cfg.maxEvents)
  const latest = events[0]
  const barOf = (t: number) => Math.round((closeTime(last) - t) / MIN)

  const base = {
    metrics: lastM,
    events: shown,
    asOf: closeTime(last),
    ignoredOpenCandles: ignored,
    insufficientData: false,
  }

  const openEarly = pending
  if (openEarly && latest && latest.state === 'EARLY_WARNING') {
    return { ...base, state: 'EARLY_WARNING', label: 'EARLY REVERSAL', direction: latest.direction, confidence: latest.confidence, tier: latest.tier, time: latest.time, crossTime: latest.crossTime, reasons: latest.reasons, checks: latest.checks }
  }
  if (latest && barOf(latest.time) <= cfg.activeTtl1m) {
    return {
      ...base,
      state: latest.state,
      label: latest.label,
      direction: latest.direction,
      rejectKind: latest.rejectKind,
      confidence: latest.confidence,
      tier: latest.tier,
      time: latest.time,
      crossTime: latest.crossTime,
      reasons: latest.reasons,
      checks: latest.checks,
    }
  }
  if (lastM.chop) {
    return {
      ...base,
      state: 'REJECTED',
      label: 'WAIT',
      rejectKind: 'CHOP',
      direction: null,
      confidence: 0,
      tier: 'LOW',
      time: closeTime(last),
      crossTime: 0,
      reasons: [`WAIT: ${chopReason(lastM)}`],
      checks: [],
    }
  }
  return { ...base, state: 'NONE', label: '—', direction: null, confidence: 0, tier: 'LOW', time: closeTime(last), crossTime: 0, reasons: [], checks: [] }
}

// ---------- API payload shapes ----------

/** Compact per-coin row for the list endpoint (full detail comes from ?symbol=). */
export interface ReversalRow {
  symbol: string
  state: ReversalState
  label: ReversalLabel
  direction: ReversalDirection | null
  rejectKind?: RejectKind
  confidence: number
  tier: ConfidenceTier
  /** Close time (ms) of the decision bar. */
  time: number
  crossTime: number
  /** First reason line: the one-sentence "why". The full list is in the detail response. */
  headline: string
  /** MA99 / Supertrend conflict flag, shown as a caution on the row. */
  conflict: boolean
}

export interface ReversalListResponse {
  live: boolean
  error?: string
  /** Server time the list was built. */
  updatedAt: number
  /** Close time (ms) of the newest closed 1m candle used. Anything after it is not in this response. */
  asOf: number
  counts: { EARLY_WARNING: number; CONFIRMED: number; REJECTED: number; WAIT: number; NONE: number }
  rows: ReversalRow[]
}

export interface ReversalDetailResponse {
  live: boolean
  error?: string
  updatedAt: number
  symbol: string
  result: ReversalResult | null
}

export function toReversalRow(symbol: string, r: ReversalResult): ReversalRow {
  return {
    symbol,
    state: r.state,
    label: r.label,
    direction: r.direction,
    rejectKind: r.rejectKind,
    confidence: r.confidence,
    tier: r.tier,
    time: r.time,
    crossTime: r.crossTime,
    headline: r.reasons[0] ?? '',
    conflict: r.metrics?.ma99StConflict ?? false,
  }
}
