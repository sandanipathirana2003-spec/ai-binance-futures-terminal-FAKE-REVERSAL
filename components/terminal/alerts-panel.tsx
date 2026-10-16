import { useMemo, useState } from 'react'
import { Bell, BellOff, Search, Trash2, TrendingDown, TrendingUp, Volume2, VolumeX } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/format'
import type { SignalAlert } from '@/lib/types'

type DirectionFilter = 'ALL' | 'BULLISH' | 'BEARISH'
type ScoreFilter = 0 | 70 | 85 | 95

function timeAgo(ts: number): string {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function AlertsPanel({
  alerts,
  permission,
  onRequestPermission,
  soundEnabled,
  onToggleSound,
  onClear,
}: {
  alerts: SignalAlert[]
  permission: NotificationPermission
  onRequestPermission: () => void
  soundEnabled: boolean
  onToggleSound: () => void
  onClear: () => void
}) {
  const [direction, setDirection] = useState<DirectionFilter>('ALL')
  const [minScore, setMinScore] = useState<ScoreFilter>(0)
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    return alerts.filter((a) => {
      if (direction !== 'ALL' && a.trend !== direction) return false
      if (a.score < minScore) return false
      if (search.trim() && !a.symbol.toLowerCase().includes(search.trim().toLowerCase())) return false
      return true
    })
  }, [alerts, direction, minScore, search])

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-4 p-3 sm:p-4">
      <div className="border-border bg-card flex flex-col gap-3 rounded-lg border p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-sm font-semibold">Signals</h2>
            <p className="text-muted-foreground text-xs">
              Fires the moment a coin passes the full confluence gate (EMA200 + EMA stack + SMA + MACD + MA Ribbon).
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={onToggleSound}
              className="border-border bg-secondary hover:bg-secondary/70 flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-semibold"
            >
              {soundEnabled ? <Volume2 className="size-3.5" /> : <VolumeX className="size-3.5" />}
              {soundEnabled ? 'Sound On' : 'Sound Off'}
            </button>
            {permission === 'granted' ? (
              <span className="border-bull/30 bg-bull/10 text-bull flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-semibold">
                <Bell className="size-3.5" />
                Notifications On
              </span>
            ) : (
              <button
                type="button"
                onClick={onRequestPermission}
                className="border-warn/30 bg-warn/10 text-warn hover:bg-warn/20 flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-semibold"
              >
                <BellOff className="size-3.5" />
                Enable Popups
              </button>
            )}
            {alerts.length > 0 ? (
              <button
                type="button"
                onClick={onClear}
                className="border-border bg-secondary hover:bg-bear/10 hover:text-bear hover:border-bear/30 flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-xs font-semibold"
              >
                <Trash2 className="size-3.5" />
                Clear
              </button>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex gap-1">
            {(['ALL', 'BULLISH', 'BEARISH'] as DirectionFilter[]).map((d) => (
              <button
                key={d}
                type="button"
                onClick={() => setDirection(d)}
                className={cn(
                  'rounded-md border px-2.5 py-1 font-mono text-[11px] font-bold',
                  direction === d
                    ? d === 'BULLISH'
                      ? 'border-bull/40 bg-bull/15 text-bull'
                      : d === 'BEARISH'
                        ? 'border-bear/40 bg-bear/15 text-bear'
                        : 'border-primary/40 bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground',
                )}
              >
                {d === 'ALL' ? 'All' : d.charAt(0) + d.slice(1).toLowerCase()}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {([0, 70, 85, 95] as ScoreFilter[]).map((s) => (
              <button
                key={s}
                type="button"
                onClick={() => setMinScore(s)}
                className={cn(
                  'rounded-md border px-2.5 py-1 font-mono text-[11px] font-bold',
                  minScore === s ? 'border-primary/40 bg-primary/10 text-primary' : 'border-border text-muted-foreground',
                )}
              >
                {s === 0 ? 'Any Score' : `${s}%+`}
              </button>
            ))}
          </div>
          <div className="relative ml-auto">
            <Search className="text-muted-foreground absolute left-2 top-1/2 size-3.5 -translate-y-1/2" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search coin…"
              className="border-border bg-secondary/50 focus:ring-ring w-40 rounded-md border py-1.5 pl-7 pr-2 text-xs outline-none focus:ring-2"
            />
          </div>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div className="border-border bg-card text-muted-foreground rounded-lg border p-10 text-center font-mono text-sm">
          {alerts.length === 0
            ? 'No confirmed signals yet. New BULLISH/BEARISH confirmations will appear here — and pop up as a notification if enabled — as soon as they pass the confluence gate.'
            : 'No signals match the current filters.'}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((a) => {
            const bullish = a.trend === 'BULLISH'
            return (
              <div
                key={a.id}
                className={cn(
                  'border-border bg-card flex flex-col gap-3 rounded-xl border p-4',
                  bullish ? 'border-l-4 border-l-bull' : 'border-l-4 border-l-bear',
                )}
              >
                <div className="flex items-center justify-between">
                  <div
                    className={cn(
                      'flex size-11 items-center justify-center rounded-lg',
                      bullish ? 'bg-bull/10 text-bull' : 'bg-bear/10 text-bear',
                    )}
                  >
                    {bullish ? <TrendingUp className="size-5" /> : <TrendingDown className="size-5" />}
                  </div>
                  <span
                    className={cn(
                      'rounded-md px-2 py-1 font-mono text-xs font-bold',
                      bullish ? 'bg-bull/15 text-bull' : 'bg-bear/15 text-bear',
                    )}
                  >
                    {a.score}%
                  </span>
                </div>
                <div>
                  <p className="font-mono text-lg font-bold">{a.symbol}</p>
                  <p className={cn('font-mono text-xs font-semibold', bullish ? 'text-bull' : 'text-bear')}>{a.trend}</p>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm">${formatPrice(a.price)}</span>
                  <span className="text-muted-foreground font-mono text-[11px]">{timeAgo(a.timestamp)}</span>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
