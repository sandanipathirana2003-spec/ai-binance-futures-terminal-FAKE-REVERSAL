import { Check, Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatCompact, formatPct, formatPrice } from '@/lib/format'
import type { BtcTrend } from '@/lib/types'
import { TIMEFRAMES } from '@/lib/types'
import { SignalBadge } from './signal-badge'
import { Sparkline } from './sparkline'

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-secondary/40 rounded-md px-2.5 py-2">
      <p className="text-muted-foreground text-[10px] font-medium uppercase tracking-wide">{label}</p>
      <p className="font-mono text-sm font-semibold">{value}</p>
      {sub ? <p className="text-muted-foreground text-[10px]">{sub}</p> : null}
    </div>
  )
}

export function BtcSidebar({ btc }: { btc?: BtcTrend }) {
  const bullish = btc?.trend === 'BULLISH'
  const bearish = btc?.trend === 'BEARISH'
  const trendColor = bullish ? 'text-bull' : bearish ? 'text-bear' : 'text-muted-foreground'

  return (
    <aside className="border-border bg-sidebar flex h-full min-h-0 flex-col overflow-y-auto lg:border-r">
      <div className="border-border border-b p-3">
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-[11px] font-semibold uppercase tracking-wide">BTC Trend</span>
          <span className={cn('inline-flex items-center gap-1 font-mono text-xs font-bold', trendColor)}>
            {bullish ? <TrendingUp className="size-3.5" /> : bearish ? <TrendingDown className="size-3.5" /> : <Minus className="size-3.5" />}
            {btc?.trend ?? '—'}
          </span>
        </div>
        <div className="mt-2 flex items-end justify-between gap-2">
          <div>
            <p className="font-mono text-2xl font-bold tracking-tight">${btc ? formatPrice(btc.price) : '—'}</p>
            <p className={cn('font-mono text-xs font-semibold', (btc?.change24h ?? 0) >= 0 ? 'text-bull' : 'text-bear')}>
              {btc ? formatPct(btc.change24h) : '—'}
            </p>
          </div>
          {btc ? <Sparkline data={btc.sparkline ?? []} positive={(btc.change24h ?? 0) >= 0} width={96} height={40} /> : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 p-3">
        <Stat label="Dominance" value={btc ? `${btc.dominance.toFixed(1)}%` : '—'} sub="BTC.D" />
        <Stat label="Fear & Greed" value={btc ? String(btc.fearGreed) : '—'} sub={btc?.fearGreedLabel} />
        <Stat label="Strength" value={btc ? `${btc.strength}%` : '—'} sub={btc && btc.strength >= 80 ? 'Strong' : 'Moderate'} />
        <Stat
          label="VIDYA"
          value={btc ? `${btc.vidya.direction} $${formatPrice(btc.vidya.value)}` : '—'}
          sub={
            btc?.vidya.justFlipped
              ? 'Just flipped'
              : btc
                ? btc.vidya.barsSinceFlip >= 0
                  ? `${btc.vidya.barsSinceFlip}h since flip`
                  : 'No flip in window'
                : undefined
          }
        />
        <Stat
          label="MA Cross"
          value={btc ? btc.maCross.bias : '—'}
          sub={btc ? `${btc.maCross.bullPairs}/3 bullish · 9/21/50/200` : undefined}
        />
        <Stat
          label="VIDYA Vol Δ"
          value={btc ? `${btc.vidya.deltaPct >= 0 ? '+' : ''}${btc.vidya.deltaPct.toFixed(0)}%` : '—'}
          sub={btc ? `B ${formatCompact(btc.vidya.buyVolume)} / S ${formatCompact(btc.vidya.sellVolume)}` : undefined}
        />
      </div>

      <div className="border-border border-t p-3">
        <p className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wide">Timeframes</p>
        <div className="grid grid-cols-5 gap-1.5">
          {TIMEFRAMES.map((tf) => (
            <div key={tf} className="flex flex-col items-center gap-1">
              <span className="text-muted-foreground font-mono text-[10px]">{tf}</span>
              <SignalBadge signal={btc?.timeframes[tf] ?? 'NEUTRAL'} className="w-full" compact />
            </div>
          ))}
        </div>
      </div>

      <div className="border-border border-t p-3">
        <p className="text-muted-foreground mb-2 text-[11px] font-semibold uppercase tracking-wide">Confluence</p>
        <ul className="space-y-1.5">
          {(btc?.indicators ?? []).map((ind) => (
            <li key={ind.label} className="flex items-center justify-between text-xs">
              <span className="text-foreground/90">{ind.label}</span>
              <span
                className={cn(
                  'inline-flex items-center gap-1 font-mono text-[11px] font-semibold',
                  ind.passed ? 'text-bull' : 'text-muted-foreground',
                )}
              >
                {ind.passed ? <Check className="size-3" /> : <Minus className="size-3" />}
                {ind.passed ? 'OK' : '—'}
              </span>
            </li>
          ))}
        </ul>
      </div>

      <div className="mt-auto p-3">
        <div
          className={cn(
            'rounded-md border p-3 text-center',
            bullish ? 'border-bull/30 bg-bull/10' : bearish ? 'border-bear/30 bg-bear/10' : 'border-border bg-secondary/40',
          )}
        >
          <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">BTC Master Trend</p>
          <p className={cn('font-mono text-lg font-bold', trendColor)}>{btc?.trend ?? '—'}</p>
          <p className="text-muted-foreground font-mono text-xs">{btc ? `${btc.strength}% strength` : '—'}</p>
        </div>
      </div>
    </aside>
  )
}
