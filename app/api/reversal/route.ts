import { NextResponse } from 'next/server'
import { fetchBulkTicker24hr, fetchFuturesUniverse, fetchKlines, fetchKlinesBatch, type Candle } from '@/lib/binance'
import {
  evaluateFakeReversal,
  toReversalRow,
  type ReversalDetailResponse,
  type ReversalListResponse,
  type ReversalResult,
} from '@/lib/fake-reversal'

// Edge runtime for the same reason as /api/market: Binance blocks US IPs.
export const runtime = 'edge'
export const dynamic = 'force-dynamic'

const MIN = 60_000
// MA99 (99) + slope lookback (10) + warm-up for ATR/Supertrend + the 3m MA25 (75 x 1m) => 499 gives ~390 replayed bars.
// limit 499 is Binance request weight 2 (limit >= 500 is weight 5).
const KLINES_1M_LIMIT = 499
const MAX_COINS = 150
const UNIVERSE_CACHE_MS = 60 * 60 * 1000
// A new 1m candle is final a moment after the minute rolls over. Wait this long before computing the new minute
// (the filter additionally ignores any candle inside its own 2s grace window).
const SETTLE_MS = 2500

interface Cache {
  /** The minute (floor(now/60000)) this snapshot was computed for. */
  minute: number
  updatedAt: number
  results: Map<string, ReversalResult>
}

let cache: Cache | null = null
let inFlight: Promise<Cache> | null = null
let universe: { t: number; symbols: string[] } | null = null

async function getUniverse(): Promise<string[]> {
  if (universe && Date.now() - universe.t < UNIVERSE_CACHE_MS) return universe.symbols
  const symbols = await fetchFuturesUniverse()
  universe = { t: Date.now(), symbols }
  return symbols
}

async function compute(): Promise<Cache> {
  const now = Date.now()
  const [symbols, ticker] = await Promise.all([getUniverse(), fetchBulkTicker24hr()])
  const ranked = symbols
    .filter((s) => ticker.has(s))
    .sort((a, b) => (ticker.get(b)?.quoteVolume ?? 0) - (ticker.get(a)?.quoteVolume ?? 0))
    .slice(0, MAX_COINS)
  const klines = await fetchKlinesBatch(ranked, '1m', KLINES_1M_LIMIT, 12)
  const results = new Map<string, ReversalResult>()
  for (const symbol of ranked) {
    const candles: Candle[] | undefined = klines.get(symbol)
    if (!candles) continue
    // `now` is the wall clock used ONLY to decide which candles are closed. Nothing else depends on it.
    results.set(symbol, evaluateFakeReversal(candles, now))
  }
  return { minute: Math.floor(now / MIN), updatedAt: now, results }
}

async function getCache(): Promise<Cache> {
  const now = Date.now()
  const dueMinute = Math.floor((now - SETTLE_MS) / MIN)
  if (cache && cache.minute >= dueMinute) return cache
  if (!inFlight) {
    inFlight = compute()
      .then((c) => {
        cache = c
        return c
      })
      .finally(() => {
        inFlight = null
      })
  }
  // Serve the previous (older, already-closed-candle) snapshot while the new one is being built.
  if (cache) {
    inFlight.catch(() => undefined) // a failed background refresh must not become an unhandled rejection
    return cache
  }
  return inFlight
}

export async function GET(req: Request) {
  const symbol = new URL(req.url).searchParams.get('symbol')?.toUpperCase() ?? null
  try {
    if (symbol) {
      if (!/^[A-Z0-9]{2,20}$/.test(symbol)) {
        const bad: ReversalDetailResponse = { live: false, error: 'bad symbol', updatedAt: Date.now(), symbol, result: null }
        return NextResponse.json(bad, { status: 400 })
      }
      const c = await getCache()
      let result = c.results.get(symbol) ?? null
      if (!result) {
        // Not in the top-150 snapshot: compute just this one from fresh candles.
        const candles = await fetchKlines(symbol, '1m', KLINES_1M_LIMIT)
        result = evaluateFakeReversal(candles, Date.now())
      }
      const detail: ReversalDetailResponse = { live: true, updatedAt: c.updatedAt, symbol, result }
      return NextResponse.json(detail)
    }

    const c = await getCache()
    const rows = []
    const counts = { EARLY_WARNING: 0, CONFIRMED: 0, REJECTED: 0, WAIT: 0, NONE: 0 }
    let asOf = 0
    for (const [sym, r] of c.results) {
      if (r.asOf > asOf) asOf = r.asOf
      if (r.state === 'NONE') {
        counts.NONE++
        continue
      }
      if (r.label === 'WAIT') counts.WAIT++
      else counts[r.state]++
      rows.push(toReversalRow(sym, r))
    }
    const body: ReversalListResponse = { live: true, updatedAt: c.updatedAt, asOf, counts, rows }
    return NextResponse.json(body)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown error fetching Binance data'
    // No fake data: say so explicitly.
    if (symbol) {
      const body: ReversalDetailResponse = { live: false, error: message, updatedAt: Date.now(), symbol, result: null }
      return NextResponse.json(body, { status: 200 })
    }
    const body: ReversalListResponse = {
      live: false,
      error: message,
      updatedAt: Date.now(),
      asOf: 0,
      counts: { EARLY_WARNING: 0, CONFIRMED: 0, REJECTED: 0, WAIT: 0, NONE: 0 },
      rows: [],
    }
    return NextResponse.json(body, { status: 200 })
  }
}
