// Run: npx tsx scripts/test-fake-reversal.ts
// Synthetic-data checks for lib/fake-reversal.ts (no network needed).
import { buildAligned3m, closedOnly, evaluateFakeReversal, fillGaps, type ReversalEvent } from '../lib/fake-reversal'
import type { Candle } from '../lib/binance'

const MIN = 60_000
let failed = 0
function ok(cond: boolean, msg: string) {
  if (cond) console.log('  ok   ' + msg)
  else {
    failed++
    console.log('  FAIL ' + msg)
  }
}

// ---- seeded RNG + series generators (open times aligned to the minute) ----
function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}
function gauss(r: () => number) {
  return Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r())
}
const T0 = Date.UTC(2026, 0, 5, 0, 0, 0)

/** Builds candles from a close path. Each candle gets a +/- wick so ATR is realistic. */
function fromCloses(closes: number[], wick: number, r: () => number): Candle[] {
  return closes.map((c, i) => {
    const o = i === 0 ? c : closes[i - 1]
    const hi = Math.max(o, c) + Math.abs(gauss(r)) * wick
    const lo = Math.min(o, c) - Math.abs(gauss(r)) * wick
    return { openTime: T0 + i * MIN, open: o, high: hi, low: lo, close: c, volume: 100 }
  })
}
function randomWalk(n: number, seed: number, sigma = 0.5, drift = 0) {
  const r = rng(seed)
  const c: number[] = [100]
  for (let i = 1; i < n; i++) c.push(c[i - 1] + drift + sigma * gauss(r))
  return fromCloses(c, sigma, r)
}
function rangeBound(n: number, seed: number, sigma = 0.5, pull = 0.25) {
  const r = rng(seed)
  const c: number[] = [100]
  for (let i = 1; i < n; i++) c.push(c[i - 1] + pull * (100 - c[i - 1]) + sigma * gauss(r))
  return fromCloses(c, sigma, r)
}
/** Regime-switching path: trends up, trends down, ranges. Good for exercising every branch. */
function regimes(n: number, seed: number) {
  const r = rng(seed)
  const c: number[] = [100]
  let mode = 0
  let left = 0
  for (let i = 1; i < n; i++) {
    if (left-- <= 0) {
      mode = Math.floor(r() * 3)
      left = 40 + Math.floor(r() * 120)
    }
    const drift = mode === 0 ? 0.12 : mode === 1 ? -0.12 : 0
    const pull = mode === 2 ? 0.2 : 0
    c.push(c[i - 1] + drift + pull * (c[Math.max(0, i - 30)] - c[i - 1]) + 0.5 * gauss(r))
  }
  return fromCloses(c, 0.5, r)
}
const nowAfter = (cs: Candle[]) => cs[cs.length - 1].openTime + MIN + 5_000 // last candle just closed
const BIG = { maxEvents: 100000 }

// ---- 1. closed candles only ----
console.log('1. only closed candles are used')
{
  const cs = randomWalk(400, 1)
  const midCandle = cs[cs.length - 1].openTime + 30_000
  const withForming = evaluateFakeReversal(cs, midCandle, BIG)
  const without = evaluateFakeReversal(cs.slice(0, -1), midCandle, BIG)
  ok(withForming.ignoredOpenCandles === 1, 'forming 1m candle is dropped (ignored = 1)')
  ok(JSON.stringify(withForming) === JSON.stringify({ ...without, ignoredOpenCandles: 1 }), 'result is identical to evaluating without the forming candle')
  const just = closedOnly(cs, MIN, cs[cs.length - 1].openTime + MIN + 1_000, 2_000)
  ok(just.ignored === 1, 'candle inside the 2s grace window after its nominal close is still treated as not final')
}

// ---- 2. no look-ahead / no repaint ----
console.log('2. no look-ahead, no repainting (prefix replay == full replay)')
{
  let checked = 0
  let bad = 0
  for (const [name, gen] of [
    ['random walk', (s: number) => randomWalk(900, s)],
    ['regimes', (s: number) => regimes(900, s)],
    ['range', (s: number) => rangeBound(900, s)],
  ] as const) {
    for (let seed = 1; seed <= 6; seed++) {
      const cs = gen(seed)
      const full = evaluateFakeReversal(cs, nowAfter(cs), BIG)
      for (const cut of [300, 420, 555, 640, 777, 850]) {
        const pre = cs.slice(0, cut)
        const p = evaluateFakeReversal(pre, nowAfter(pre), BIG)
        const fromFull = full.events.filter((e) => e.time <= p.asOf)
        checked++
        if (JSON.stringify(fromFull) !== JSON.stringify(p.events)) {
          bad++
          console.log(`     mismatch ${name} seed ${seed} cut ${cut}: ${fromFull.length} vs ${p.events.length}`)
        }
      }
    }
  }
  ok(bad === 0, `events found with only the first N candles are identical to the same events in the full run (${checked} comparisons)`)
}

// ---- 3. state-machine rules over many random series ----
console.log('3. state machine rules')
{
  let total = 0
  let confirmed = 0
  let failedN = 0
  let early = 0
  const viol: string[] = []
  for (let seed = 1; seed <= 60; seed++) {
    const cs = regimes(1500, seed)
    const res = evaluateFakeReversal(cs, nowAfter(cs), BIG)
    const evs = res.events
    const byCross = new Map<number, ReversalEvent[]>()
    for (const e of evs) byCross.set(e.crossTime, [...(byCross.get(e.crossTime) ?? []), e])
    for (const e of evs) {
      total++
      if (e.reasons.length === 0) viol.push('event without reason')
      if (e.state === 'CONFIRMED') {
        confirmed++
        if (e.barsSinceCross < 1) viol.push('CONFIRMED on the same bar as the cross')
        if (!byCross.get(e.crossTime)!.some((x) => x.state === 'EARLY_WARNING')) viol.push('CONFIRMED without an EARLY_WARNING first')
        if (e.confidence < 40) viol.push('CONFIRMED below min confidence')
        if (e.reasons.some((r) => r.includes('confidence lowered')) && e.tier === 'HIGH') viol.push('HIGH tier despite MA99/Supertrend conflict')
        if (e.time % (3 * MIN) !== 0) viol.push('CONFIRMED not on a 3m candle close')
        if (e.checks.find((c) => c.id === 'tf3_confirm')?.passed !== true) viol.push('CONFIRMED without 3m pass')
      }
      if (e.state === 'EARLY_WARNING') {
        early++
        if (e.tier === 'HIGH') viol.push('EARLY_WARNING shown as HIGH')
      }
      if (e.rejectKind === 'REVERSAL_FAILED') {
        failedN++
        if (!byCross.get(e.crossTime)!.some((x) => x.state === 'EARLY_WARNING')) viol.push('REVERSAL_FAILED without an EARLY_WARNING')
      }
    }
  }
  ok(viol.length === 0, `no rule violations across ${total} events (${early} early, ${confirmed} confirmed, ${failedN} reversal-failed)${viol.length ? ': ' + [...new Set(viol)].join('; ') : ''}`)
  ok(early > 0 && confirmed > 0 && failedN > 0, 'all three outcomes occur on mixed-regime data')
}

// ---- 4. hand-built scenarios ----
console.log('4. scenarios')
{
  // a) Long downtrend, then a sustained V-reversal: price reclaims everything. Expect EARLY then CONFIRMED LONG.
  const r = rng(7)
  const c: number[] = [200]
  for (let i = 1; i < 700; i++) c.push(c[i - 1] - 0.15 + 0.2 * gauss(r)) // down
  for (let i = 0; i < 300; i++) c.push(c[c.length - 1] + 0.35 + 0.2 * gauss(r)) // strong up
  const cs = fromCloses(c, 0.2, r)
  const res = evaluateFakeReversal(cs, nowAfter(cs), BIG)
  const longs = res.events.filter((e) => e.direction === 'LONG' && e.time > cs[700].openTime)
  console.log('     events after V:', longs.slice().reverse().slice(0, 8).map((e) => `${e.label}${e.rejectKind ? '/' + e.rejectKind : ''} (${e.confidence} ${e.tier})`).join(' -> '))
  ok(longs.some((e) => e.state === 'EARLY_WARNING'), 'genuine V reversal: EARLY WARNING fires first')
  ok(longs.some((e) => e.state === 'CONFIRMED'), 'genuine V reversal: later upgraded to CONFIRMED when 3m confirms')
}
{
  // b) Fake reversal: steady downtrend, a short bounce crosses MA7 above MA25, then the drop resumes immediately.
  const r = rng(11)
  const c: number[] = [300]
  for (let i = 1; i < 600; i++) c.push(c[i - 1] - 0.12 + 0.12 * gauss(r))
  const pivot = c.length
  for (let i = 0; i < 6; i++) c.push(c[c.length - 1] + 0.9) // sharp bounce -> bullish 1m cross
  for (let i = 0; i < 40; i++) c.push(c[c.length - 1] - 0.7) // violent drop resumes
  const cs = fromCloses(c, 0.05, r)
  const res = evaluateFakeReversal(cs, nowAfter(cs), BIG)
  const after = res.events.filter((e) => e.time > cs[pivot].openTime)
  console.log('     events after bounce:', after.slice().reverse().map((e) => `${e.direction} ${e.label}${e.rejectKind ? '/' + e.rejectKind : ''} (${e.confidence} ${e.tier})`).join(' -> '))
  ok(after.some((e) => e.direction === 'LONG' && e.state === 'EARLY_WARNING'), 'bounce in a downtrend: LONG shows only as EARLY WARNING (low confidence, MA99 vs Supertrend conflict)')
  ok(after.some((e) => e.direction === 'LONG' && e.rejectKind === 'REVERSAL_FAILED'), 'bounce in a downtrend: REVERSAL FAILED is raised when 1m turns back before 3m confirms')
  ok(!after.some((e) => e.direction === 'LONG' && e.state === 'CONFIRMED'), 'bounce in a downtrend: no CONFIRMED LONG')
}
{
  // c) Range-bound market: crossovers keep happening, but WAIT must dominate and nothing may reach CONFIRMED high.
  let conf = 0
  let wait = 0
  let crossEvents = 0
  for (let seed = 1; seed <= 40; seed++) {
    const cs = rangeBound(1200, seed, 0.5, 0.3)
    const res = evaluateFakeReversal(cs, nowAfter(cs), BIG)
    for (const e of res.events) {
      crossEvents++
      if (e.state === 'CONFIRMED') conf++
      if (e.label === 'WAIT') wait++
    }
  }
  console.log(`     range-bound: ${crossEvents} events, ${wait} WAIT, ${conf} CONFIRMED`)
  ok(wait / Math.max(1, crossEvents) > 0.5, 'range-bound market: most crossovers are answered with WAIT')
  ok(conf / Math.max(1, crossEvents) < 0.1, 'range-bound market: fewer than 10% of crossovers end as CONFIRMED')
}
{
  // d) Counter-trend fade (price far below falling MA99, Supertrend DOWN) must not become an entry.
  const r = rng(5)
  const c: number[] = [300]
  for (let i = 1; i < 900; i++) c.push(c[i - 1] - 0.2 + 0.35 * gauss(r))
  const cs = fromCloses(c, 0.3, r)
  const res = evaluateFakeReversal(cs, nowAfter(cs), BIG)
  const longConfirmed = res.events.filter((e) => e.direction === 'LONG' && e.state === 'CONFIRMED')
  const shortConfirmed = res.events.filter((e) => e.direction === 'SHORT' && e.state === 'CONFIRMED')
  console.log(`     steady downtrend: LONG confirmed ${longConfirmed.length}, SHORT confirmed ${shortConfirmed.length}`)
  ok(longConfirmed.length === 0, 'steady downtrend: counter-trend LONG crossovers never become CONFIRMED')
}

// ---- 5. data hygiene ----
console.log('5. data hygiene')
{
  const cs = randomWalk(300, 3)
  const holey = cs.filter((_, i) => i !== 100 && i !== 101 && i !== 200)
  const filled = fillGaps(holey, MIN)
  ok(filled.length === cs.length, 'missing minutes are filled so bar index == minute')
  ok(filled[100].volume === 0 && filled[100].close === filled[99].close, 'filled candle is flat at the previous close with zero volume')
  const { bars, lastIdx1m } = buildAligned3m(cs)
  ok(bars.every((b) => b.openTime % (3 * MIN) === 0), '3m bars are aligned to the clock (00,03,06,...)')
  ok(lastIdx1m.every((i, k) => cs[i].openTime + MIN === bars[k].openTime + 3 * MIN), '3m bar k is only available when its last 1m candle has closed')
  const short = evaluateFakeReversal(cs.slice(0, 60), nowAfter(cs.slice(0, 60)))
  ok(short.insufficientData && short.state === 'NONE', 'too little history => NONE with an explanation, never a guess')
}

console.log(failed === 0 ? '\nALL CHECKS PASSED' : `\n${failed} CHECK(S) FAILED`)
process.exit(failed === 0 ? 0 : 1)
