import type { WideScalpData } from './wide-scalp'

export type Signal = 'BUY' | 'SELL' | 'NEUTRAL'
export type Trend = 'BULLISH' | 'BEARISH' | 'NEUTRAL'

// Real Binance kline intervals. 1m is fetched natively; 3m/5m/15m are built by
// resampling that SAME real 1m series (genuine OHLC aggregation, not synthetic
// data); 1h is fetched natively. No fake/mislabeled timeframes anywhere here.
export const TIMEFRAMES = ['1m', '3m', '5m', '15m', '1h'] as const
export type Timeframe = (typeof TIMEFRAMES)[number]

export const TIMEFRAME_LABELS: Record<Timeframe, string> = {
  '1m': '1M',
  '3m': '3M',
  '5m': '5M',
  '15m': '15M',
  '1h': '1H',
}

/** One BUY/SELL/NEUTRAL transition on a timeframe (e.g. NEUTRAL -> BUY). */
export interface SignalChange {
  from: Signal
  to: Signal
  /** Open time (ms) of the candle on which the change happened. */
  time: number
  /** Candles ago on that timeframe (0 = the still-forming candle). */
  barsAgo: number
}

/** Current state of one timeframe plus its recent transitions, newest first. */
export interface TfSignalHistory {
  current: Signal
  /** Candles since the last change, or -1 when no change exists in the fetched window. */
  barsInState: number
  /** Open time (ms) of the candle where the current state began, 0 when unknown. */
  sinceTime: number
  changes: SignalChange[]
}

export const EMPTY_SIGNAL_HISTORY: Record<Timeframe, TfSignalHistory> = {
  '1m': { current: 'NEUTRAL', barsInState: -1, sinceTime: 0, changes: [] },
  '3m': { current: 'NEUTRAL', barsInState: -1, sinceTime: 0, changes: [] },
  '5m': { current: 'NEUTRAL', barsInState: -1, sinceTime: 0, changes: [] },
  '15m': { current: 'NEUTRAL', barsInState: -1, sinceTime: 0, changes: [] },
  '1h': { current: 'NEUTRAL', barsInState: -1, sinceTime: 0, changes: [] },
}

/**
 * Volumatic VIDYA (after BigBeluga): CMO-adaptive moving average (length 10, momentum 20, SMA-15 smoothed)
 * with ATR(200) x 2 flip bands, plus buy/sell volume accumulated since the current trend leg began.
 */
export interface VidyaInfo {
  direction: 'UP' | 'DOWN'
  /** Smoothed VIDYA line. */
  value: number
  /** VIDYA + ATR(200) x factor — closing above it flips the trend UP. */
  upperBand: number
  /** VIDYA - ATR(200) x factor — closing below it flips the trend DOWN. */
  lowerBand: number
  justFlipped: boolean
  /** Candles since the last confirmed flip, or -1 if none happened in the fetched window. */
  barsSinceFlip: number
  /** Volume of up-candles (close > open) since the current trend leg began. */
  buyVolume: number
  /** Volume of down-candles (close < open) since the current trend leg began. */
  sellVolume: number
  /** (buy - sell) / (buy + sell) x 100, since the current trend leg began. */
  deltaPct: number
  /** False when no band flip was found in the window — direction then comes from price vs the VIDYA line. */
  confirmed: boolean
}

export const EMPTY_VIDYA: VidyaInfo = {
  direction: 'UP',
  value: 0,
  upperBand: 0,
  lowerBand: 0,
  justFlipped: false,
  barsSinceFlip: -1,
  buyVolume: 0,
  sellVolume: 0,
  deltaPct: 0,
  confirmed: false,
}

export const MA_CROSS_PAIRS = ['9/21', '21/50', '50/200'] as const
export type MaCrossPairKey = (typeof MA_CROSS_PAIRS)[number]

export interface MaCrossPair {
  state: 'BULL' | 'BEAR'
  /** Candles since this pair last crossed, or -1 if no cross in the window (or not enough history). */
  barsSinceCross: number
}

/** EMA 9 / 21 / 50 / 200 cross state — one entry per adjacent pair (9/21, 21/50, 50/200). */
export interface MaCrossInfo {
  ema9: number
  ema21: number
  ema50: number
  ema200: number
  pairs: Record<MaCrossPairKey, MaCrossPair>
  /** BULLISH = 9>21>50>200, BEARISH = 9<21<50<200, otherwise MIXED. */
  bias: 'BULLISH' | 'BEARISH' | 'MIXED'
  /** How many of the 3 pairs are bullish (fast above slow). */
  bullPairs: number
  /** How many of the 3 pairs are bearish (fast below slow). */
  bearPairs: number
  /** Most recent cross across all three pairs, or null if none found. */
  lastCross: { pair: MaCrossPairKey; type: 'BULL' | 'BEAR'; barsAgo: number } | null
  /** False when there are fewer than ~210 candles — EMA200 hasn't converged. */
  sufficientData: boolean
}

export const EMPTY_MA_CROSS: MaCrossInfo = {
  ema9: 0,
  ema21: 0,
  ema50: 0,
  ema200: 0,
  pairs: {
    '9/21': { state: 'BEAR', barsSinceCross: -1 },
    '21/50': { state: 'BEAR', barsSinceCross: -1 },
    '50/200': { state: 'BEAR', barsSinceCross: -1 },
  },
  bias: 'MIXED',
  bullPairs: 0,
  bearPairs: 0,
  lastCross: null,
  sufficientData: false,
}

export interface CoinSignal {
  symbol: string
  name: string
  price: number
  change24h: number
  timeframes: Record<Timeframe, Signal>
  /** Per-timeframe BUY/SELL/NEUTRAL history: how long each state has held and the last few changes. */
  signalHistory: Record<Timeframe, TfSignalHistory>
  /** Per-timeframe recent closes for the mini chart in each grid cell — real candle data, not a shared slice. */
  tfSparklines: Record<Timeframe, number[]>
  /** Real Wilder ATR(14) computed on each timeframe's own real candles — used for ATR-based stop sizing. */
  tfAtr: Record<Timeframe, number>
  score: number
  trend: Trend
  sparkline: number[]
  vidya: VidyaInfo
  /** EMA 9/21/50/200 cross state on 1H candles. */
  maCross: MaCrossInfo
  /** 1H EMA200 filter / EMA stack alignment / MACD confirmation — the Phase 1 confluence gate. */
  gateChecks: IndicatorCheck[]
  /** Multi-timeframe EMA/SMA ribbon (5m/15m/45m/1h/4h) — feeds into the confluence gate, not just a display widget. */
  ribbon: RibbonBoard
  /** Raw inputs for the Wide-Stop Scalp strategy (3-candle-low SL basis, 15m ATR, 15m EMA20). */
  wideScalp: WideScalpData
}

export interface IndicatorCheck {
  label: string
  passed: boolean
}

export interface BtcTrend {
  price: number
  change24h: number
  dominance: number
  fearGreed: number
  fearGreedLabel: string
  trend: Trend
  strength: number
  timeframes: Record<Timeframe, Signal>
  signalHistory: Record<Timeframe, TfSignalHistory>
  indicators: IndicatorCheck[]
  sparkline: number[]
  vidya: VidyaInfo
  maCross: MaCrossInfo
  ribbon: RibbonBoard
}

export interface MarketResponse {
  btc: BtcTrend
  coins: CoinSignal[]
  updatedAt: number
  live: boolean
  /** Present when live is false — tells the UI why (so it never silently shows fake data as real). */
  error?: string
}

export type TradeSide = 'LONG' | 'SHORT'
export type TradeStatus = 'OPEN' | 'CLOSED'
export type CloseReason = 'SL' | 'TP' | 'MANUAL' | null

export type TradeStrategy = 'default' | 'wideScalp'

export interface Trade {
  id: string
  symbol: string
  side: TradeSide
  entry: number
  exit: number | null
  size: number // position size in quote currency (USDT notional)
  stop: number | null // current/live stop — moves during breakeven+ATR trailing
  initialStop: number | null // the stop at trade open, never changes — used to compute 1R distance for trailing
  target: number | null
  status: TradeStatus
  notes: string
  openedAt: number
  closedAt: number | null
  closeReason: CloseReason
  /** 'wideScalp' trades use their own TP1/TP2/breakeven rules instead of generic 1R breakeven+ATR trailing. */
  strategy?: TradeStrategy
  /** 15m ATR frozen at trade open — the fixed basis for wideScalp's TP1 (1x)/TP2 (1.5x)/breakeven (1x) triggers. */
  atrAtEntry?: number | null
  /** True once the wideScalp 50% partial close at TP1 has fired, so it only fires once. */
  partialTaken?: boolean
}

/** A confirmed BULLISH/BEARISH signal captured the moment it fires, for the Alerts tab + browser notifications. */
export interface SignalAlert {
  id: string
  symbol: string
  trend: Trend
  score: number
  price: number
  timestamp: number
}

// --- MA Ribbon Analysis (EMA9/21/50/100/200 + SMA200 across 5m/15m/45m/1h/4h) ---

export const RIBBON_TIMEFRAMES = ['5m', '15m', '45m', '1h', '4h'] as const
export type RibbonTimeframe = (typeof RIBBON_TIMEFRAMES)[number]

export type RibbonArrangement = 'STRONG_BULLISH' | 'BULLISH' | 'MIXED' | 'BEARISH' | 'STRONG_BEARISH'
export type RibbonDynamic = 'EXPANDING' | 'CONTRACTING' | 'STABLE'
export type RibbonLabel = 'VERY_STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL'

export interface RibbonEmas {
  ema9: number
  ema21: number
  ema50: number
  ema100: number
  ema200: number
  sma200: number
}

export interface RibbonCell {
  arrangement: RibbonArrangement
  dynamic: RibbonDynamic
  /** -2 (strong bearish) to +2 (strong bullish) — this timeframe's contribution to the total score. */
  score: number
  /** False when this timeframe has fewer than ~210 real candles — EMA200/SMA200 aren't fully converged yet. */
  sufficientData: boolean
  emas: RibbonEmas
  bars: number
}

export interface RibbonBoard {
  cells: Record<RibbonTimeframe, RibbonCell>
  /** Sum of all 5 timeframe scores, -10 to +10. */
  totalScore: number
  confidence: number
  label: RibbonLabel
}
