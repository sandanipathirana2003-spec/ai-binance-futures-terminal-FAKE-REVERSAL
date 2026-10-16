'use client'

import { useMemo, useState } from 'react'
import { ArrowRight, ChevronDown, Search, Zap } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPct, formatPrice, timeAgo } from '@/lib/format'
import type { BtcTrend, CoinSignal, Signal, TfSignalHistory, Timeframe } from '@/lib/types'
import { TIMEFRAMES, TIMEFRAME_LABELS } from '@/lib/types'
import { SignalBadge } from './signal-badge'

/** A change counts as "fresh" when it happened within this many candles of the chosen timeframe. */
const FRESH_BARS = 3

type SignalFilter = 'ALL' | Signal

interface Row {
  symbol: string
  price: number
  change24h: number
  history: Record<Timeframe, TfSignalHistory>
}

const SIGNAL_TEXT: Record<Signal, string> = {
  BUY: 'text-bull',
  SELL: 'text-bear',
  NEUTRAL: 'text-muted-foreground',
}

function ChangeLine({ history }: { history: TfSignalHistory }) {
  const last = history.changes[0]
  if (!last) return <span className="text-muted-foreground font-mono text-[11px]">No change in the loaded candles</span>
  const fresh = last.barsAgo <= FRESH_BARS
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5 font-mono text-[11px]">
      <span className={cn('font-semibold', SIGNAL_TEXT[last.from])}>{last.from}</span>
      <ArrowRight className="text-muted-foreground size-3" />
      <span className={cn('font-bold', SIGNAL_TEXT[last.to])}>{last.to}</span>
      <span className="text-muted-foreground">· {last.barsAgo === 0 ? 'this candle' : timeAgo(last.time)}</span>
      {fresh ? (
        <span className="bg-warn/15 text-warn flex items-center gap-0.5 rounded px-1 py-px text-[9px] font-bold">
          <Zap className="size-2.5" />
          NEW
        </span>
      ) : null}
    </span>
  )
}

function TfStrip({ history, active }: { history: Record<Timeframe, TfSignalHistory>; active: Timeframe }) {
  return (
    <div className="flex items-center gap-1">
      {TIMEFRAMES.map((tf) => {
        const h = history[tf]
        const fresh = h.changes[0] != null && h.changes[0].barsAgo <= FRESH_BARS
        return (
          <span
            key={tf}
            title={`${TIMEFRAME_LABELS[tf]}: ${h.current}${fresh ? ' (just changed)' : ''}`}
            className={cn(
              'relative flex w-9 flex-col items-center rounded border py-0.5 font-mono leading-tight',
              h.current === 'BUY'
                ? 'border-bull/30 bg-bull/15 text-bull'
                : h.current === 'SELL'
                  ? 'border-bear/30 bg-bear/15 text-bear'
                  : 'border-border bg-muted text-muted-foreground',
              tf === active && 'outline-primary/70 outline outline-1 outline-offset-1',
            )}
          >
            <span className="text-[8px] opacity-70">{TIMEFRAME_LABELS[tf]}</span>
            <span className="text-[11px] font-bold">{h.current[0]}</span>
            {fresh ? <span className="bg-warn absolute -right-0.5 -top-0.5 size-1.5 rounded-full" /> : null}
          </span>
        )
      })}
    </div>
  )
}

function HistoryDetail({ row, onOpen }: { row: Row; onOpen: (symbol: string) => void }) {
  return (
    <div className="bg-secondary/20 border-border/60 flex flex-col gap-3 border-t px-3 py-3">
      <div className="grid grid-cols-1 gap-2 min-[480px]:grid-cols-2 lg:grid-cols-5">
        {TIMEFRAMES.map((tf) => {
          const h = row.history[tf]
          return (
            <div key={tf} className="border-border bg-card rounded-md border p-2.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs font-bold">{TIMEFRAME_LABELS[tf]}</span>
                <SignalBadge signal={h.current} />
              </div>
              <p className="text-muted-foreground mt-1 font-mono text-[10px]">
                {h.changes[0] ? `${h.current} since ${h.changes[0].barsAgo === 0 ? 'this candle' : timeAgo(h.changes[0].time)}` : 'No change in window'}
              </p>
              {h.changes.length > 0 ? (
                <ul className="mt-2 space-y-1">
                  {h.changes.map((c) => (
                    <li key={c.time} className="flex items-center justify-between gap-2 font-mono text-[10px]">
                      <span className="flex items-center gap-1">
                        <span className={SIGNAL_TEXT[c.from]}>{c.from}</span>
                        <ArrowRight className="text-muted-foreground size-2.5" />
                        <span className={cn('font-bold', SIGNAL_TEXT[c.to])}>{c.to}</span>
                      </span>
                      <span className="text-muted-foreground shrink-0">{c.barsAgo === 0 ? 'now' : timeAgo(c.time)}</span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )
        })}
      </div>
      <button
        type="button"
        onClick={() => onOpen(row.symbol)}
        className="bg-primary text-primary-foreground w-full rounded-md px-3 py-2 text-xs font-semibold sm:w-fit"
      >
        Open {row.symbol} in Terminal
      </button>
    </div>
  )
}

export function VidyaPanel({
  coins,
  btc,
  onOpen,
}: {
  coins: CoinSignal[]
  btc?: BtcTrend
  onOpen: (symbol: string) => void
}) {
  const [tf, setTf] = useState<Timeframe>('5m')
  const [filter, setFilter] = useState<SignalFilter>('ALL')
  const [newOnly, setNewOnly] = useState(false)
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const rows = useMemo<Row[]>(() => {
    const out: Row[] = []
    if (btc && btc.price > 0 && btc.signalHistory) {
      out.push({ symbol: 'BTCUSDT', price: btc.price, change24h: btc.change24h, history: btc.signalHistory })
    }
    for (const c of coins) {
      if (c.signalHistory) out.push({ symbol: c.symbol, price: c.price, change24h: c.change24h, history: c.signalHistory })
    }
    return out
  }, [coins, btc])

  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? rows.filter((r) => r.symbol.toLowerCase().includes(q)) : rows
  }, [rows, query])

  const counts = useMemo(() => {
    const c = { BUY: 0, SELL: 0, NEUTRAL: 0, fresh: 0 }
    for (const r of searched) {
      const h = r.history[tf]
      c[h.current]++
      if (h.changes[0] && h.changes[0].barsAgo <= FRESH_BARS) c.fresh++
    }
    return c
  }, [searched, tf])

  const visible = useMemo(() => {
    return searched
      .filter((r) => {
        const h = r.history[tf]
        if (filter !== 'ALL' && h.current !== filter) return false
        if (newOnly && !(h.changes[0] && h.changes[0].barsAgo <= FRESH_BARS)) return false
        return true
      })
      .sort((a, b) => {
        const ta = a.history[tf].changes[0]?.time ?? 0
        const tb = b.history[tf].changes[0]?.time ?? 0
        if (tb !== ta) return tb - ta // most recent change first; no-change rows sink to the bottom
        return a.symbol.localeCompare(b.symbol)
      })
  }, [searched, tf, filter, newOnly])

  const FILTERS: Array<{ key: SignalFilter; label: string; count: number; cls: string }> = [
    { key: 'ALL', label: 'All', count: searched.length, cls: 'border-primary/40 bg-primary/10 text-primary' },
    { key: 'BUY', label: 'Buy', count: counts.BUY, cls: 'border-bull/40 bg-bull/15 text-bull' },
    { key: 'SELL', label: 'Sell', count: counts.SELL, cls: 'border-bear/40 bg-bear/15 text-bear' },
    { key: 'NEUTRAL', label: 'Neutral', count: counts.NEUTRAL, cls: 'border-border bg-muted text-foreground' },
  ]

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-3 p-3">
      <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-3">
        <div>
          <h2 className="text-sm font-semibold">Volumatic VIDYA · BUY / SELL / NEUTRAL changes</h2>
          <p className="text-muted-foreground text-xs">
            Pick a timeframe. Coins that changed most recently are on top; <span className="text-warn font-semibold">NEW</span> = changed
            within the last {FRESH_BARS} candles.
          </p>
        </div>

        <div className="grid grid-cols-5 gap-1.5">
          {TIMEFRAMES.map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTf(t)}
              className={cn(
                'rounded-md border py-2 font-mono text-xs font-bold transition-colors',
                tf === t ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border text-muted-foreground',
              )}
            >
              {TIMEFRAME_LABELS[t]}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-4 gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setFilter(f.key)}
              className={cn(
                'flex flex-col items-center rounded-md border py-1.5 font-mono transition-colors',
                filter === f.key ? f.cls : 'border-border text-muted-foreground',
              )}
            >
              <span className="text-[10px] font-semibold uppercase">{f.label}</span>
              <span className="text-sm font-bold">{f.count}</span>
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setNewOnly((v) => !v)}
            className={cn(
              'flex shrink-0 items-center gap-1.5 rounded-md border px-3 py-2 font-mono text-xs font-bold transition-colors',
              newOnly ? 'border-warn/40 bg-warn/15 text-warn' : 'border-border text-muted-foreground',
            )}
          >
            <Zap className="size-3.5" />
            New only ({counts.fresh})
          </button>
          <div className="relative min-w-0 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search coin…"
              className="border-border bg-secondary/50 focus:ring-ring w-full rounded-md border py-2 pl-7 pr-2 text-xs outline-none focus:ring-2"
            />
          </div>
        </div>
      </div>

      <div className="border-border bg-card overflow-hidden rounded-lg border">
        {visible.length === 0 ? (
          <p className="text-muted-foreground p-8 text-center font-mono text-sm">
            {rows.length === 0 ? 'Waiting for market data…' : 'No coins match these filters.'}
          </p>
        ) : (
          <ul>
            {visible.map((r) => {
              const h = r.history[tf]
              const open = expanded === r.symbol
              return (
                <li key={r.symbol} className="border-border/60 border-b last:border-b-0">
                  <button
                    type="button"
                    onClick={() => setExpanded(open ? null : r.symbol)}
                    className="active:bg-accent/40 flex w-full flex-col gap-2 px-3 py-3 text-left sm:flex-row sm:items-center sm:gap-4"
                  >
                    <div className="flex items-center justify-between gap-3 sm:w-44 sm:shrink-0 sm:flex-col sm:items-start sm:justify-center sm:gap-0.5">
                      <span className="font-mono text-sm font-semibold">{r.symbol}</span>
                      <span className="text-muted-foreground font-mono text-[11px]">
                        ${formatPrice(r.price)}{' '}
                        <span className={r.change24h >= 0 ? 'text-bull' : 'text-bear'}>{formatPct(r.change24h)}</span>
                      </span>
                    </div>
                    <div className="flex min-w-0 flex-1 items-center gap-2.5">
                      <SignalBadge signal={h.current} size="md" className="w-[4.5rem] shrink-0" />
                      <ChangeLine history={h} />
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <TfStrip history={r.history} active={tf} />
                      <ChevronDown className={cn('text-muted-foreground size-4 shrink-0 transition-transform', open && 'rotate-180')} />
                    </div>
                  </button>
                  {open ? <HistoryDetail row={r} onOpen={onOpen} /> : null}
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <p className="text-muted-foreground px-1 text-[10px] leading-relaxed">
        BUY / SELL = Volumatic VIDYA trend direction (ATR 200 × 2 flip bands) backed by at least 2 of 3 confirmations: RSI, MACD histogram and
        EMA 9/21/50/200 alignment. Anything less is NEUTRAL. History is rebuilt from real Binance candles every refresh, so changes show up
        immediately — no need to keep the page open. The newest candle is still forming, so a change on &ldquo;this candle&rdquo; can
        still revert. Signals only; not financial advice.
      </p>
    </div>
  )
}
