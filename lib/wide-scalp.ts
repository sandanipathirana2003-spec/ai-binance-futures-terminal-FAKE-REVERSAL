import type { Candle } from './binance'
import { atr, closes as closesOf, ema } from './indicators'

export interface WideScalpData {
  /** Lows of the 3 most recently CLOSED 15m candles (the currently-forming candle, if present as the
   *  last array element, is excluded) — the basis for Rule 1's stop-loss calc. */
  last3Lows: number[]
  /** Highs of the same 3 candles — used for the SHORT-side mirror of Rule 1 (not explicitly in the
   *  spec, which described longs; symmetric interpretation for shorts). */
  last3Highs: number[]
  /** Real Wilder ATR(14) on native 15m candles — the basis for Rules 3 and 4 (breakeven trigger, TP1/TP2). */
  atr15m: number
  /** EMA20 on native 15m candles — the basis for Rule 5's pullback-only entry filter. */
  ema20_15m: number
}

export function buildWideScalpData(fifteenMinCandles: Candle[]): WideScalpData {
  // Exclude the last element as a conservative assumption that it may be the
  // still-forming candle; "previous 3" means the 3 before that.
  const closed = fifteenMinCandles.length > 3 ? fifteenMinCandles.slice(0, -1) : fifteenMinCandles
  const last3 = closed.slice(-3)
  const cl = closesOf(fifteenMinCandles)

  return {
    last3Lows: last3.map((c) => c.low),
    last3Highs: last3.map((c) => c.high),
    atr15m: atr(fifteenMinCandles, 14),
    ema20_15m: ema(cl, 20),
  }
}
