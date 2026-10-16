import type { Candle } from './binance'
import { closes as closesOf, ema, emaSeries, sma } from './indicators'
import {
  RIBBON_TIMEFRAMES,
  type RibbonArrangement,
  type RibbonBoard,
  type RibbonCell,
  type RibbonDynamic,
  type RibbonEmas,
  type RibbonLabel,
  type RibbonTimeframe,
} from './types'

/** Below this many real candles, EMA200/SMA200 haven't converged — flagged via `sufficientData`, not hidden. */
const MIN_BARS_FOR_CONVERGENCE = 210

function classifyArrangement(e: RibbonEmas): RibbonArrangement {
  const pairs = [e.ema9 > e.ema21, e.ema21 > e.ema50, e.ema50 > e.ema100, e.ema100 > e.ema200]
  const bullishCount = pairs.filter(Boolean).length
  if (bullishCount === 4) return 'STRONG_BULLISH'
  if (bullishCount === 0) return 'STRONG_BEARISH'
  if (bullishCount === 3) return 'BULLISH'
  if (bullishCount === 1) return 'BEARISH'
  return 'MIXED'
}

function arrangementScore(a: RibbonArrangement): number {
  switch (a) {
    case 'STRONG_BULLISH':
      return 2
    case 'BULLISH':
      return 1
    case 'BEARISH':
      return -1
    case 'STRONG_BEARISH':
      return -2
    default:
      return 0
  }
}

function classifyDynamic(series: number[][], lookback: number): RibbonDynamic {
  const len = series[0]?.length ?? 0
  if (len < lookback + 2) return 'STABLE'

  const spreadAt = (idx: number) => {
    const [s9, s21, s50, s100, s200] = series.map((s) => s[idx])
    const price = Math.abs(s9) || 1
    return (Math.abs(s9 - s21) + Math.abs(s21 - s50) + Math.abs(s50 - s100) + Math.abs(s100 - s200)) / 4 / price
  }

  const now = spreadAt(len - 1)
  const prev = spreadAt(len - 1 - lookback)
  if (prev === 0) return 'STABLE'
  const change = (now - prev) / prev
  if (change > 0.02) return 'EXPANDING'
  if (change < -0.02) return 'CONTRACTING'
  return 'STABLE'
}

function buildCell(candles: Candle[]): RibbonCell {
  if (candles.length < 15) {
    const zeroEmas: RibbonEmas = { ema9: 0, ema21: 0, ema50: 0, ema100: 0, ema200: 0, sma200: 0 }
    return { arrangement: 'MIXED', dynamic: 'STABLE', score: 0, sufficientData: false, emas: zeroEmas, bars: candles.length }
  }

  const cl = closesOf(candles)
  const emas: RibbonEmas = {
    ema9: ema(cl, 9),
    ema21: ema(cl, 21),
    ema50: ema(cl, 50),
    ema100: ema(cl, Math.min(100, cl.length)),
    ema200: ema(cl, Math.min(200, cl.length)),
    sma200: sma(cl, Math.min(200, cl.length)),
  }

  const arrangement = classifyArrangement(emas)
  const series = [
    emaSeries(cl, 9),
    emaSeries(cl, 21),
    emaSeries(cl, 50),
    emaSeries(cl, Math.min(100, cl.length)),
    emaSeries(cl, Math.min(200, cl.length)),
  ]
  const dynamic = classifyDynamic(series, Math.min(10, cl.length - 2))

  return {
    arrangement,
    dynamic,
    score: arrangementScore(arrangement),
    sufficientData: candles.length >= MIN_BARS_FOR_CONVERGENCE,
    emas,
    bars: candles.length,
  }
}

function labelFromScore(score: number): RibbonLabel {
  if (score >= 8) return 'VERY_STRONG_BUY'
  if (score >= 4) return 'BUY'
  if (score <= -8) return 'STRONG_SELL'
  if (score <= -4) return 'SELL'
  return 'NEUTRAL'
}

export function buildRibbonBoard(input: {
  oneMinCandles: Candle[]
  fifteenMinCandles: Candle[]
  hourlyCandles: Candle[]
  resample: (candles: Candle[], factor: number) => Candle[]
}): RibbonBoard {
  const { oneMinCandles, fifteenMinCandles, hourlyCandles, resample } = input
  const byTf: Record<RibbonTimeframe, Candle[]> = {
    '5m': resample(oneMinCandles, 5),
    '15m': fifteenMinCandles,
    '45m': resample(fifteenMinCandles, 3),
    '1h': hourlyCandles,
    '4h': resample(hourlyCandles, 4),
  }

  const cells = {} as Record<RibbonTimeframe, RibbonCell>
  let totalScore = 0
  for (const tf of RIBBON_TIMEFRAMES) {
    const cell = buildCell(byTf[tf])
    cells[tf] = cell
    totalScore += cell.score
  }

  const confidence = Math.round((Math.abs(totalScore) / (RIBBON_TIMEFRAMES.length * 2)) * 100)
  return { cells, totalScore, confidence, label: labelFromScore(totalScore) }
}
