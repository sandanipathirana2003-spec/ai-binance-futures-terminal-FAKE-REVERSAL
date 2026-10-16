'use client'

import { useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { timeAgo } from '@/lib/format'
import type { ReversalListResponse, ReversalRow } from '@/lib/fake-reversal'
import { ReversalBadge } from './reversal-badge'

type Filter = 'ALL' | 'CONFIRMED' | 'EARLY_WARNING' | 'REJECTED' | 'WAIT'

const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'ALL', label: 'All' },
  { key: 'CONFIRMED', label: 'Confirmed' },
  { key: 'EARLY_WARNING', label: 'Early' },
  { key: 'REJECTED', label: 'Rejected' },
  { key: 'WAIT', label: 'Wait' },
]

const ORDER: Record<string, number> = { CONFIRMED: 0, EARLY_WARNING: 1, REJECTED: 2 }

function matches(r: ReversalRow, f: Filter) {
  if (f === 'ALL') return true
  if (f === 'WAIT') return r.label === 'WAIT'
  if (f === 'REJECTED') return r.state === 'REJECTED' && r.label !== 'WAIT'
  return r.state === f
}

export function ReversalPanel({
  list,
  onOpen,
}: {
  list?: ReversalListResponse
  onOpen: (symbol: string) => void
}) {
  const [filter, setFilter] = useState<Filter>('ALL')
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    return (list?.rows ?? [])
      .filter((r) => matches(r, filter))
      .filter((r) => r.symbol.toLowerCase().includes(query.toLowerCase().trim()))
      .sort((a, b) => (ORDER[a.state] ?? 9) - (ORDER[b.state] ?? 9) || b.time - a.time)
  }, [list, filter, query])

  const c = list?.counts
  const count = (f: Filter) => (!c ? 0 : f === 'ALL' ? c.CONFIRMED + c.EARLY_WARNING + c.REJECTED + c.WAIT : c[f])

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-3 p-2 sm:p-4">
      <div className="border-border bg-card rounded-lg border p-3">
        <h2 className="text-sm font-semibold">Fake-Reversal Filter</h2>
        <p className="text-muted-foreground mt-1 text-xs">
          A 1m MA 7/25 crossover is only an <b>early warning</b>. It becomes a <b>confirmed entry</b> when a closed 3m candle agrees and the MA99 / Supertrend / sideways checks pass. It is
          cancelled as <b>reversal failed</b> if 1m turns back first, and shows <b>wait</b> in a choppy market. Only closed candles are used; signals never repaint.
        </p>
        <p className="text-muted-foreground mt-1 font-mono text-[10px]">
          {list?.asOf ? `closed 1m candle ${new Date(list.asOf).toISOString().slice(11, 16)} UTC · updated ${timeAgo(list.updatedAt)}` : 'waiting for data…'}
        </p>
        {list && !list.live ? <p className="text-bear mt-2 text-xs">Binance data unavailable ({list.error ?? 'unknown error'}). Nothing is shown rather than guessing.</p> : null}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              'rounded-md border px-2.5 py-1.5 text-xs font-medium transition-colors',
              filter === f.key ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border bg-secondary/40 text-muted-foreground hover:text-foreground',
            )}
          >
            {f.label} <span className="font-mono opacity-70">{count(f.key)}</span>
          </button>
        ))}
        <div className="relative ml-auto">
          <Search className="text-muted-foreground pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search coin…"
            className="border-border bg-secondary/50 focus:ring-ring w-32 rounded-md border py-1.5 pl-7 pr-2 text-xs outline-none focus:ring-2 sm:w-40"
          />
        </div>
      </div>

      <ul className="border-border bg-card divide-border divide-y rounded-lg border">
        {rows.map((r) => (
          <li key={r.symbol}>
            <button type="button" onClick={() => onOpen(r.symbol)} className="hover:bg-accent/40 flex w-full flex-col gap-1 px-3 py-2.5 text-left transition-colors">
              <span className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-sm font-semibold">{r.symbol.replace('USDT', '')}</span>
                <ReversalBadge label={r.label} direction={r.direction} tier={r.tier} />
                {r.state === 'EARLY_WARNING' || r.state === 'CONFIRMED' ? (
                  <span className="text-muted-foreground font-mono text-[10px]">
                    conf {r.confidence} · {r.tier}
                  </span>
                ) : null}
                {r.conflict ? <span className="text-warn font-mono text-[10px]">MA99≠ST</span> : null}
                <span className="text-muted-foreground ml-auto font-mono text-[10px]">{timeAgo(r.time)}</span>
              </span>
              <span className="text-muted-foreground line-clamp-2 text-[11px]">{r.headline}</span>
            </button>
          </li>
        ))}
        {rows.length === 0 ? (
          <li className="text-muted-foreground px-3 py-8 text-center text-xs">{list ? 'No coins in this state right now.' : 'Loading…'}</li>
        ) : null}
      </ul>
    </div>
  )
}
