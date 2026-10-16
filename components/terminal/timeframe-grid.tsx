import { ArrowDownRight, ArrowUpRight, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCompact, formatPct, formatPrice, timeAgo } from '@/lib/format'
import type { CoinSignal } from '@/lib/types'
import { TIMEFRAMES, TIMEFRAME_LABELS } from '@/lib/types'
import { SignalBadge } from './signal-badge'
import { Sparkline } from './sparkline'

export function TimeframeGrid({ coin }: { coin?: CoinSignal }) {
  const bullish = coin?.trend === 'BULLISH'
  const bearish = coin?.trend === 'BEARISH'
  const buys = coin ? TIMEFRAMES.filter((t) => coin.timeframes[t] === 'BUY').length : 0
  const sells = coin ? TIMEFRAMES.filter((t) => coin.timeframes[t] === 'SELL').length : 0

  return (
    <div className="border-border bg-card flex flex-col rounded-lg border">
      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b p-3 sm:gap-3">
        <div className="flex items-center gap-3">
          <div className="bg-secondary flex size-9 items-center justify-center rounded-md font-mono text-xs font-bold">
            {coin?.symbol.replace('USDT', '').slice(0, 4) ?? '—'}
          </div>
          <div>
            <h2 className="font-mono text-sm font-semibold">{coin?.symbol ?? 'Select a coin'}</h2>
            <p className="text-muted-foreground text-xs">{coin?.name ?? 'Multi-timeframe view'}</p>
          </div>
        </div>
        <div className="text-right">
          <p className="font-mono text-lg font-bold">${coin ? formatPrice(coin.price) : '—'}</p>
          <p className={cn('font-mono text-xs font-semibold', (coin?.change24h ?? 0) >= 0 ? 'text-bull' : 'text-bear')}>
            {coin ? formatPct(coin.change24h) : '—'}
          </p>
        </div>
        <div
          className={cn(
            'flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-bold',
            bullish ? 'border-bull/30 bg-bull/10 text-bull' : bearish ? 'border-bear/30 bg-bear/10 text-bear' : 'border-border text-muted-foreground',
          )}
        >
          {bullish ? <TrendingUp className="size-4" /> : bearish ? <TrendingDown className="size-4" /> : <Minus className="size-4" />}
          {coin?.trend ?? 'NEUTRAL'} · {buys}B / {sells}S
        </div>
        {coin ? (
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-bold',
              coin.vidya.direction === 'UP' ? 'border-bull/30 bg-bull/10 text-bull' : 'border-bear/30 bg-bear/10 text-bear',
            )}
            title={
              (coin.vidya.barsSinceFlip >= 0
                ? `Flipped ${coin.vidya.barsSinceFlip} hourly candles ago`
                : 'No flip in the fetched window (direction = price vs VIDYA line)') +
              ` · Buy ${formatCompact(coin.vidya.buyVolume)} / Sell ${formatCompact(coin.vidya.sellVolume)} since trend start`
            }
          >
            {coin.vidya.direction === 'UP' ? <ArrowUpRight className="size-4" /> : <ArrowDownRight className="size-4" />}
            VIDYA {coin.vidya.direction} · ${formatPrice(coin.vidya.value)}
            <span className="text-muted-foreground font-normal">
              Δ{coin.vidya.deltaPct >= 0 ? '+' : ''}
              {coin.vidya.deltaPct.toFixed(0)}%
            </span>
            {coin.vidya.justFlipped ? <span className="text-warn ml-1">FLIPPED</span> : null}
          </div>
        ) : null}
        {coin ? (
          <div
            className={cn(
              'flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-bold',
              coin.maCross.bias === 'BULLISH'
                ? 'border-bull/30 bg-bull/10 text-bull'
                : coin.maCross.bias === 'BEARISH'
                  ? 'border-bear/30 bg-bear/10 text-bear'
                  : 'border-border text-muted-foreground',
            )}
            title={
              `EMA 9/21: ${coin.maCross.pairs['9/21'].state}` +
              ` · 21/50: ${coin.maCross.pairs['21/50'].state}` +
              ` · 50/200: ${coin.maCross.pairs['50/200'].state}` +
              (coin.maCross.lastCross
                ? ` · last cross ${coin.maCross.lastCross.pair} (${coin.maCross.lastCross.type}) ${coin.maCross.lastCross.barsAgo}h ago`
                : '')
            }
          >
            {coin.maCross.bias === 'BULLISH' ? (
              <TrendingUp className="size-4" />
            ) : coin.maCross.bias === 'BEARISH' ? (
              <TrendingDown className="size-4" />
            ) : (
              <Minus className="size-4" />
            )}
            MA Cross {coin.maCross.bias} · {coin.maCross.bullPairs}/3
          </div>
        ) : null}
      </div>

      <div className="grid grid-cols-2 gap-2 p-3 sm:grid-cols-3 lg:grid-cols-5">
        {TIMEFRAMES.map((tf) => {
          const sig = coin?.timeframes[tf] ?? 'NEUTRAL'
          const data = coin?.tfSparklines[tf] ?? []
          const positive = sig === 'BUY'
          const last = coin?.signalHistory?.[tf]?.changes[0]
          return (
            <div
              key={tf}
              className={cn(
                'flex flex-col gap-2 rounded-md border p-3',
                sig === 'BUY'
                  ? 'border-bull/25 bg-bull/5'
                  : sig === 'SELL'
                    ? 'border-bear/25 bg-bear/5'
                    : 'border-border bg-secondary/30',
              )}
            >
              <div className="flex items-center justify-between">
                <span className="font-mono text-sm font-bold">{TIMEFRAME_LABELS[tf]}</span>
                <SignalBadge signal={sig} />
              </div>
              <Sparkline data={data} positive={positive} width={200} height={48} className="h-12 w-full" />
              <div className="text-muted-foreground flex flex-col gap-0.5 font-mono text-[10px]">
                {last ? (
                  <>
                    <span className="truncate">
                      {last.from} → <span className="text-foreground font-semibold">{last.to}</span>
                    </span>
                    <span>{last.barsAgo === 0 ? 'this candle' : timeAgo(last.time)}</span>
                  </>
                ) : (
                  <span>no change in window</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
