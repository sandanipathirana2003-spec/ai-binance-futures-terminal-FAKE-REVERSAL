'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPct } from '@/lib/format'
import type { CoinSignal } from '@/lib/types'
import type { ReversalRow } from '@/lib/fake-reversal'
import { TIMEFRAMES } from '@/lib/types'
import { ReversalBadge } from './reversal-badge'
import { SignalBadge } from './signal-badge'

type Filter = 'ALL' | 'STRONG_BUY' | 'ALL_TF' | 'SCORE_90'

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'STRONG_BUY', label: 'Strong Buy' },
  { key: 'ALL_TF', label: 'All TF Agree' },
  { key: 'SCORE_90', label: 'Score > 90' },
]

function scoreColor(score: number) {
  if (score >= 90) return 'text-bull'
  if (score >= 75) return 'text-warn'
  return 'text-muted-foreground'
}

export function CoinScanner({
  coins,
  selected,
  onSelect,
  reversal,
}: {
  coins: CoinSignal[]
  selected: string
  onSelect: (symbol: string) => void
  /** Fake-reversal state per symbol (symbols with no active state are simply absent). */
  reversal?: Map<string, ReversalRow>
}) {
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<Filter>('ALL')

  const filtered = useMemo(() => {
    return coins
      .filter((c) => c.symbol.toLowerCase().includes(query.toLowerCase().trim()))
      .filter((c) => {
        if (filter === 'STRONG_BUY') return c.trend === 'BULLISH' && c.score >= 85
        if (filter === 'ALL_TF') return TIMEFRAMES.every((t) => c.timeframes[t] === c.timeframes[TIMEFRAMES[TIMEFRAMES.length - 1]])
        if (filter === 'SCORE_90') return c.score >= 90
        return true
      })
      .sort((a, b) => b.score - a.score)
  }, [coins, query, filter])

  return (
    <div className="border-border bg-card flex min-h-0 flex-col rounded-lg border">
      <div className="border-border flex flex-wrap items-center gap-2 border-b p-3">
        <h2 className="mr-auto text-sm font-semibold">
          Coin Scanner <span className="text-muted-foreground font-mono text-xs">({filtered.length})</span>
        </h2>
        <div className="relative">
          <Search className="text-muted-foreground pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search coin…"
            className="border-border bg-secondary/50 focus:ring-ring w-32 rounded-md border py-1.5 pl-7 pr-2 text-xs outline-none focus:ring-2 sm:w-36"
          />
        </div>
      </div>

      <div className="border-border flex flex-wrap gap-1.5 border-b p-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
              filter === f.key
                ? 'border-primary/40 bg-primary/15 text-primary'
                : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <table className="w-full border-collapse text-xs">
          <thead className="bg-card text-muted-foreground sticky top-0 z-10">
            <tr className="border-border border-b">
              <th className="px-2 py-2 text-left font-medium sm:px-3">Coin</th>
              {TIMEFRAMES.map((t) => (
                <th key={t} className="px-1 py-2 text-center font-mono font-medium">
                  {t}
                </th>
              ))}
              <th className="px-1 py-2 text-center font-medium">Rev</th>
              <th className="px-2 py-2 text-right font-medium sm:px-3">Score</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((c) => (
              <tr
                key={c.symbol}
                onClick={() => onSelect(c.symbol)}
                className={cn(
                  'border-border/60 hover:bg-accent/40 cursor-pointer border-b transition-colors',
                  selected === c.symbol && 'bg-primary/10 hover:bg-primary/10',
                )}
              >
                <td className="px-2 py-2.5 sm:px-3">
                  <div className="font-mono font-semibold">{c.symbol.replace('USDT', '')}<span className="text-muted-foreground hidden sm:inline">USDT</span></div>
                  <div className={cn('font-mono text-[10px]', c.change24h >= 0 ? 'text-bull' : 'text-bear')}>
                    {formatPct(c.change24h)}
                  </div>
                </td>
                {TIMEFRAMES.map((t) => (
                  <td key={t} className="px-1 py-2 text-center">
                    <SignalBadge signal={c.timeframes[t]} compact />
                  </td>
                ))}
                <td className="px-1 py-2 text-center">
                  {(() => {
                    const rv = reversal?.get(c.symbol)
                    return rv ? <ReversalBadge label={rv.label} direction={rv.direction} tier={rv.tier} compact /> : <span className="text-muted-foreground font-mono text-[10px]">—</span>
                  })()}
                </td>
                <td className={cn('px-2 py-2 text-right font-mono font-bold sm:px-3', scoreColor(c.score))}>{c.score}%</td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={TIMEFRAMES.length + 3} className="text-muted-foreground px-3 py-8 text-center">
                  No coins match the current filter.
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  )
}
