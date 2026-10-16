import { NextResponse } from 'next/server'
import { fetchBulkTicker24hr, fetchFuturesUniverse, fetchKlinesBatch, type Candle } from '@/lib/binance'
import { buildBtcTrend, buildCoinSignal } from '@/lib/signals'
import { EMPTY_MA_CROSS, EMPTY_SIGNAL_HISTORY, EMPTY_VIDYA, type CoinSignal, type MarketResponse } from '@/lib/types'

// Edge runtime: on Vercel's free plan you can't pin serverless functions to a
// non-US region, and Binance's API blocks US IPs (HTTP 451). Edge functions
// instead run from whichever Vercel edge location is closest to the request,
// which for most non-US visitors avoids the block without needing a paid plan.
export const runtime = 'edge'
export const dynamic = 'force-dynamic'

const KLINES_LIMIT = 1000 // ~41 days of 1H candles — deep enough for reliable VIDYA/ATR(200)/EMA200
const KLINES_1M_LIMIT = 480 // ~8 hours of native 1-minute candles — resampled into real 3m/5m/15m signal buckets
const KLINES_15M_LIMIT = 1000 // ~10.4 days of native 15-minute candles — the base for Wide-Stop Scalp's 3-candle-low SL, ATR, and 20 EMA
const SIGNAL_CACHE_MS = 5 * 60 * 1000 // recompute VIDYA/MA-cross signals every 5 min (rate-limit friendly)
const UNIVERSE_CACHE_MS = 60 * 60 * 1000 // symbol list barely changes; refresh hourly
const MAX_COINS = 150 // top-150 by 24h volume — still well over the "100+" target, far fewer requests than the full ~300-symbol universe

interface SignalCache {
  timestamp: number
  btcCandles: Candle[]
  btcCandles1m: Candle[]
  btcCandles15m: Candle[]
  coinSignals: Map<string, CoinSignal>
}

interface UniverseCache {
  timestamp: number
  symbols: string[]
}

// Module-level cache + in-flight lock. Persists across requests while the
// edge isolate stays warm; the lock stops a burst of simultaneous requests
// from each independently triggering a full 150-symbol klines fetch.
let signalCache: SignalCache | null = null
let universeCache: UniverseCache | null = null
let inFlightRecompute: Promise<SignalCache> | null = null

async function getUniverse(): Promise<string[]> {
  if (universeCache && Date.now() - universeCache.timestamp < UNIVERSE_CACHE_MS) {
    return universeCache.symbols
  }
  const symbols = await fetchFuturesUniverse()
  universeCache = { timestamp: Date.now(), symbols }
  return symbols
}

async function doRecompute(allSymbols: string[]): Promise<SignalCache> {
  // Rank by 24h quote volume first so we only fetch klines for the coins that
  // actually matter — cuts request volume roughly in half vs. the full universe.
  const ticker = await fetchBulkTicker24hr()
  const ranked = allSymbols
    .filter((s) => ticker.has(s))
    .sort((a, b) => (ticker.get(b)?.quoteVolume ?? 0) - (ticker.get(a)?.quoteVolume ?? 0))
    .slice(0, MAX_COINS)

  const targets = ranked.includes('BTCUSDT') ? ranked : ['BTCUSDT', ...ranked]
  // Three real intervals per symbol: native 1h (unchanged), native 1m (base for
  // 1m/3m/5m/15m signals + the ribbon's 5m cell), and native 15m (base for the
  // MA Ribbon's 15m/45m cells AND Wide-Stop Scalp's 3-candle-low SL/ATR/20 EMA).
  const [klinesMap, klinesMap1m, klinesMap15m] = await Promise.all([
    fetchKlinesBatch(targets, '1h', KLINES_LIMIT, 12),
    fetchKlinesBatch(targets, '1m', KLINES_1M_LIMIT, 12),
    fetchKlinesBatch(targets, '15m', KLINES_15M_LIMIT, 12),
  ])

  const coinSignals = new Map<string, CoinSignal>()
  for (const symbol of targets) {
    const candles = klinesMap.get(symbol)
    const oneMinCandles = klinesMap1m.get(symbol)
    const fifteenMinCandles = klinesMap15m.get(symbol)
    if (!candles || candles.length < 30 || !oneMinCandles || oneMinCandles.length < 60) continue
    const lastClose = candles[candles.length - 1].close
    const prevDayClose = candles[Math.max(0, candles.length - 25)].close
    const change24h = prevDayClose > 0 ? ((lastClose - prevDayClose) / prevDayClose) * 100 : 0
    const signal = buildCoinSignal({
      symbol,
      name: symbol.replace('USDT', ''),
      price: lastClose,
      change24h,
      hourlyCandles: candles,
      oneMinCandles,
      fifteenMinCandles: fifteenMinCandles ?? [],
    })
    coinSignals.set(symbol, signal)
  }

  const btcCandles = klinesMap.get('BTCUSDT') ?? []
  const btcCandles1m = klinesMap1m.get('BTCUSDT') ?? []
  const btcCandles15m = klinesMap15m.get('BTCUSDT') ?? []
  return { timestamp: Date.now(), btcCandles, btcCandles1m, btcCandles15m, coinSignals }
}

async function recomputeSignals(allSymbols: string[]): Promise<SignalCache> {
  if (inFlightRecompute) return inFlightRecompute
  inFlightRecompute = doRecompute(allSymbols).finally(() => {
    inFlightRecompute = null
  })
  return inFlightRecompute
}

export async function GET() {
  try {
    const symbols = await getUniverse()

    if (!signalCache || Date.now() - signalCache.timestamp > SIGNAL_CACHE_MS) {
      signalCache = await recomputeSignals(symbols)
    }

    // Cheap bulk call — always fresh, keeps price/PnL live every 15s without re-hitting klines.
    const ticker = await fetchBulkTicker24hr()

    const coins: CoinSignal[] = []
    for (const [symbol, cached] of signalCache.coinSignals) {
      const live = ticker.get(symbol)
      coins.push(live ? { ...cached, price: live.price, change24h: live.changePct } : cached)
    }

    const btcCached = signalCache.coinSignals.get('BTCUSDT')
    const btcLive = ticker.get('BTCUSDT')
    const totalVolume = Array.from(ticker.values()).reduce((s, t) => s + t.quoteVolume, 0)
    const btcVolume = btcLive?.quoteVolume ?? 0
    const dominance = totalVolume > 0 ? (btcVolume / totalVolume) * 100 : 55

    const btc = buildBtcTrend({
      price: btcLive?.price ?? btcCached?.price ?? 0,
      change24h: btcLive?.changePct ?? btcCached?.change24h ?? 0,
      dominance,
      hourlyCandles: signalCache.btcCandles,
      oneMinCandles: signalCache.btcCandles1m,
      fifteenMinCandles: signalCache.btcCandles15m,
    })

    const response: MarketResponse = {
      btc,
      coins: coins.filter((c) => c.symbol !== 'BTCUSDT'),
      updatedAt: Date.now(),
      live: true,
    }
    return NextResponse.json(response)
  } catch (err) {
    // No fake/synthetic data. If Binance is unreachable, say so explicitly.
    const message = err instanceof Error ? err.message : 'Unknown error fetching Binance data'
    const empty: MarketResponse = {
      btc: {
        price: 0,
        change24h: 0,
        dominance: 0,
        fearGreed: 50,
        fearGreedLabel: 'Neutral',
        trend: 'NEUTRAL',
        strength: 0,
        timeframes: { '1m': 'NEUTRAL', '3m': 'NEUTRAL', '5m': 'NEUTRAL', '15m': 'NEUTRAL', '1h': 'NEUTRAL' },
        signalHistory: EMPTY_SIGNAL_HISTORY,
        indicators: [],
        sparkline: [],
        vidya: EMPTY_VIDYA,
        maCross: EMPTY_MA_CROSS,
        ribbon: {
          cells: {
            '5m': { arrangement: 'MIXED', dynamic: 'STABLE', score: 0, sufficientData: false, emas: { ema9: 0, ema21: 0, ema50: 0, ema100: 0, ema200: 0, sma200: 0 }, bars: 0 },
            '15m': { arrangement: 'MIXED', dynamic: 'STABLE', score: 0, sufficientData: false, emas: { ema9: 0, ema21: 0, ema50: 0, ema100: 0, ema200: 0, sma200: 0 }, bars: 0 },
            '45m': { arrangement: 'MIXED', dynamic: 'STABLE', score: 0, sufficientData: false, emas: { ema9: 0, ema21: 0, ema50: 0, ema100: 0, ema200: 0, sma200: 0 }, bars: 0 },
            '1h': { arrangement: 'MIXED', dynamic: 'STABLE', score: 0, sufficientData: false, emas: { ema9: 0, ema21: 0, ema50: 0, ema100: 0, ema200: 0, sma200: 0 }, bars: 0 },
            '4h': { arrangement: 'MIXED', dynamic: 'STABLE', score: 0, sufficientData: false, emas: { ema9: 0, ema21: 0, ema50: 0, ema100: 0, ema200: 0, sma200: 0 }, bars: 0 },
          },
          totalScore: 0,
          confidence: 0,
          label: 'NEUTRAL',
        },
      },
      coins: [],
      updatedAt: Date.now(),
      live: false,
      error: message,
    }
    return NextResponse.json(empty, { status: 200 })
  }
}
