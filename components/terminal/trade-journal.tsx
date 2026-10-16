'use client'

import { useMemo, useState } from 'react'
import { Check, Pencil, PlusCircle, Trash2, TrendingDown, TrendingUp, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/format'
import { tradePnl, tradePnlPct, useTrades } from '@/hooks/use-trades'
import type { CoinSignal, Trade, TradeSide } from '@/lib/types'

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'bull' | 'bear' }) {
  return (
    <div className="border-border bg-secondary/30 rounded-md border p-3">
      <p className="text-muted-foreground text-[10px] font-semibold uppercase tracking-wide">{label}</p>
      <p
        className={cn(
          'mt-1 font-mono text-lg font-bold',
          tone === 'bull' ? 'text-bull' : tone === 'bear' ? 'text-bear' : 'text-foreground',
        )}
      >
        {value}
      </p>
    </div>
  )
}

export function TradeJournal({ coins }: { coins: CoinSignal[] }) {
  const { trades, addTrade, closeTrade, removeTrade, updateTrade } = useTrades()
  const [form, setForm] = useState({
    symbol: 'BTCUSDT',
    side: 'LONG' as TradeSide,
    entry: '',
    size: '1000',
    stop: '',
    target: '',
    notes: '',
  })

  const stats = useMemo(() => {
    const closed = trades.filter((t) => t.status === 'CLOSED')
    const wins = closed.filter((t) => tradePnl(t) > 0)
    const totalPnl = closed.reduce((s, t) => s + tradePnl(t), 0)
    const winRate = closed.length ? (wins.length / closed.length) * 100 : 0
    const open = trades.filter((t) => t.status === 'OPEN').length
    return { count: trades.length, closed: closed.length, open, winRate, totalPnl, wins: wins.length }
  }, [trades])

  const symbolPrice = (symbol: string) => coins.find((c) => c.symbol === symbol)?.price ?? 0

  function submit(e: React.FormEvent) {
    e.preventDefault()
    const entry = Number(form.entry) || symbolPrice(form.symbol)
    if (!entry) return
    addTrade({
      symbol: form.symbol,
      side: form.side,
      entry,
      size: Number(form.size) || 0,
      stop: form.stop ? Number(form.stop) : null,
      target: form.target ? Number(form.target) : null,
      notes: form.notes.trim(),
    })
    setForm((f) => ({ ...f, entry: '', stop: '', target: '', notes: '' }))
  }

  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-4 p-4">
      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Total Trades" value={String(stats.count)} />
        <Stat label="Win Rate" value={`${stats.winRate.toFixed(0)}%`} tone={stats.winRate >= 50 ? 'bull' : 'bear'} />
        <Stat
          label="Realized P&L"
          value={`${stats.totalPnl >= 0 ? '+' : '-'}$${formatPrice(Math.abs(stats.totalPnl))}`}
          tone={stats.totalPnl >= 0 ? 'bull' : 'bear'}
        />
        <Stat label="Open / Closed" value={`${stats.open} / ${stats.closed}`} />
      </div>

      {/* Add trade */}
      <form onSubmit={submit} className="border-border bg-sidebar rounded-lg border p-4">
        <div className="mb-3 flex items-center gap-2">
          <PlusCircle className="text-primary size-4" />
          <h3 className="text-sm font-semibold">Log a Trade</h3>
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-muted-foreground uppercase">Symbol</span>
            <select
              value={form.symbol}
              onChange={(e) => setForm((f) => ({ ...f, symbol: e.target.value }))}
              className="border-border bg-secondary/50 focus:ring-ring rounded-md border px-2 py-1.5 font-mono text-xs outline-none focus:ring-2"
            >
              {coins.length === 0 && <option value="BTCUSDT">BTCUSDT</option>}
              {coins.map((c) => (
                <option key={c.symbol} value={c.symbol}>
                  {c.symbol}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11px]">
            <span className="text-muted-foreground uppercase">Side</span>
            <div className="grid grid-cols-2 gap-1">
              {(['LONG', 'SHORT'] as TradeSide[]).map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, side: s }))}
                  className={cn(
                    'rounded-md border py-1.5 font-mono text-[11px] font-bold',
                    form.side === s
                      ? s === 'LONG'
                        ? 'border-bull/40 bg-bull/15 text-bull'
                        : 'border-bear/40 bg-bear/15 text-bear'
                      : 'border-border text-muted-foreground',
                  )}
                >
                  {s}
                </button>
              ))}
            </div>
          </label>
          <Field
            label="Entry"
            placeholder={symbolPrice(form.symbol) ? formatPrice(symbolPrice(form.symbol)) : 'price'}
            value={form.entry}
            onChange={(v) => setForm((f) => ({ ...f, entry: v }))}
          />
          <Field label="Size ($)" value={form.size} onChange={(v) => setForm((f) => ({ ...f, size: v }))} />
          <Field label="Stop" value={form.stop} onChange={(v) => setForm((f) => ({ ...f, stop: v }))} />
          <Field label="Target (TP)" value={form.target} onChange={(v) => setForm((f) => ({ ...f, target: v }))} />
        </div>
        <div className="mt-3 flex flex-col gap-3 sm:flex-row">
          <input
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
            placeholder="Notes / setup reason…"
            className="border-border bg-secondary/50 focus:ring-ring flex-1 rounded-md border px-3 py-2 text-xs outline-none focus:ring-2"
          />
          <button
            type="submit"
            className="bg-primary text-primary-foreground rounded-md px-4 py-2 text-sm font-semibold hover:opacity-90"
          >
            Add Trade
          </button>
        </div>
      </form>

      {/* History */}
      <div className="border-border bg-sidebar overflow-x-auto rounded-lg border">
        <div className="min-w-[700px]">
        <div className="border-border text-muted-foreground grid grid-cols-[1.2fr_0.7fr_1fr_1fr_1fr_0.9fr_0.5fr] gap-2 border-b px-4 py-2 font-mono text-[10px] font-semibold uppercase">
          <span>Symbol</span>
          <span>Side</span>
          <span className="text-right">Entry</span>
          <span className="text-right">Exit</span>
          <span className="text-right">Size</span>
          <span className="text-right">P&L</span>
          <span />
        </div>
        {trades.length === 0 ? (
          <p className="text-muted-foreground p-8 text-center text-sm">
            No trades logged yet. Add your first trade above to start tracking performance.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {trades.map((t) => (
              <TradeRow
                key={t.id}
                trade={t}
                livePrice={symbolPrice(t.symbol)}
                onClose={closeTrade}
                onRemove={removeTrade}
                onUpdate={updateTrade}
              />
            ))}
          </ul>
        )}
        </div>
      </div>
    </div>
  )
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
}) {
  return (
    <label className="flex flex-col gap-1 text-[11px]">
      <span className="text-muted-foreground uppercase">{label}</span>
      <input
        type="number"
        inputMode="decimal"
        step="any"
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="border-border bg-secondary/50 focus:ring-ring rounded-md border px-2 py-1.5 text-right font-mono text-xs outline-none focus:ring-2"
      />
    </label>
  )
}

function closeReasonLabel(reason: Trade['closeReason']) {
  if (reason === 'TP') return 'WIN · HIT TP'
  if (reason === 'SL') return 'LOSS · HIT SL'
  return 'CLOSED · MANUAL'
}

function TradeRow({
  trade,
  livePrice,
  onClose,
  onRemove,
  onUpdate,
}: {
  trade: Trade
  livePrice: number
  onClose: (id: string, exit: number) => void
  onRemove: (id: string) => void
  onUpdate: (id: string, patch: Partial<Pick<Trade, 'entry' | 'stop' | 'target'>>) => void
}) {
  const [exitInput, setExitInput] = useState('')
  const [editing, setEditing] = useState(false)
  const [editEntry, setEditEntry] = useState('')
  const [editStop, setEditStop] = useState('')
  const [editTarget, setEditTarget] = useState('')
  const isLong = trade.side === 'LONG'
  const pnl = tradePnl(trade)
  const pnlPct = tradePnlPct(trade)

  // Unrealized P&L for open trades based on live price.
  const openPct = livePrice
    ? (isLong ? (livePrice - trade.entry) / trade.entry : (trade.entry - livePrice) / trade.entry) * 100
    : 0
  const openPnl = (openPct / 100) * trade.size

  const showPnl = trade.status === 'CLOSED' ? pnl : openPnl
  const showPct = trade.status === 'CLOSED' ? pnlPct : openPct

  function startEdit() {
    setEditEntry(String(trade.entry))
    setEditStop(trade.stop != null ? String(trade.stop) : '')
    setEditTarget(trade.target != null ? String(trade.target) : '')
    setEditing(true)
  }

  function saveEdit() {
    const patch: Partial<Pick<Trade, 'entry' | 'stop' | 'target'>> = {}
    const entryNum = Number(editEntry)
    if (editEntry !== '' && !Number.isNaN(entryNum)) patch.entry = entryNum
    patch.stop = editStop === '' ? null : Number(editStop)
    patch.target = editTarget === '' ? null : Number(editTarget)
    onUpdate(trade.id, patch)
    setEditing(false)
  }

  return (
    <>
      <li className="grid grid-cols-[1.2fr_0.7fr_1fr_1fr_1fr_0.9fr_0.5fr] items-center gap-2 px-4 py-2.5 font-mono text-xs">
        <div className="flex flex-col">
          <span className="text-foreground font-semibold">{trade.symbol}</span>
          <span className="text-muted-foreground text-[10px]">
            {trade.status === 'OPEN' ? (
              trade.initialStop != null && trade.stop != null && trade.stop !== trade.initialStop ? (
                <span className="text-bull font-semibold">TRAILING</span>
              ) : (
                'OPEN'
              )
            ) : (
              closeReasonLabel(trade.closeReason)
            )}
            {trade.notes ? ` · ${trade.notes.slice(0, 18)}` : ''}
          </span>
        </div>
        <span
          className={cn(
            'inline-flex w-fit items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold',
            isLong ? 'bg-bull/15 text-bull' : 'bg-bear/15 text-bear',
          )}
        >
          {isLong ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
          {trade.side}
        </span>
        <span className="text-right">${formatPrice(trade.entry)}</span>
        <span className="text-right">
          {trade.exit !== null ? (
            `$${formatPrice(trade.exit)}`
          ) : (
            <span className="text-muted-foreground">${formatPrice(livePrice)}</span>
          )}
        </span>
        <span className="text-right">${formatPrice(trade.size)}</span>
        <span className={cn('text-right font-bold', showPnl >= 0 ? 'text-bull' : 'text-bear')}>
          {showPnl >= 0 ? '+' : ''}
          {showPct.toFixed(2)}%
        </span>
        <div className="flex items-center justify-end gap-1">
          {trade.status === 'OPEN' ? (
            <>
              <button
                type="button"
                title="Edit entry / stop / target"
                onClick={() => (editing ? setEditing(false) : startEdit())}
                className={cn('rounded p-1', editing ? 'text-primary bg-primary/15' : 'text-muted-foreground hover:text-primary')}
              >
                <Pencil className="size-3.5" />
              </button>
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  step="any"
                  value={exitInput}
                  onChange={(e) => setExitInput(e.target.value)}
                  placeholder={formatPrice(livePrice)}
                  className="border-border bg-secondary/50 w-16 rounded border px-1 py-0.5 text-right text-[10px] outline-none"
                />
                <button
                  type="button"
                  title="Close trade at exit price"
                  onClick={() => onClose(trade.id, Number(exitInput) || livePrice)}
                  className="text-bull hover:bg-bull/15 rounded p-1"
                >
                  <Check className="size-3.5" />
                </button>
              </div>
              <button
                type="button"
                title="Delete trade"
                onClick={() => onRemove(trade.id)}
                className="text-muted-foreground hover:text-bear rounded p-1"
              >
                <X className="size-3.5" />
              </button>
            </>
          ) : (
            <button
              type="button"
              title="Delete trade"
              onClick={() => onRemove(trade.id)}
              className="text-muted-foreground hover:text-bear rounded p-1"
            >
              <Trash2 className="size-3.5" />
            </button>
          )}
        </div>
      </li>
      {editing ? (
        <li className="border-border bg-secondary/20 border-t px-4 py-3">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            <label className="flex flex-col gap-1 text-[10px]">
              <span className="text-muted-foreground uppercase">Entry</span>
              <input
                type="number"
                step="any"
                value={editEntry}
                onChange={(e) => setEditEntry(e.target.value)}
                className="border-border bg-secondary/50 focus:ring-ring rounded-md border px-2 py-1.5 text-right font-mono text-xs outline-none focus:ring-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px]">
              <span className="text-muted-foreground uppercase">Stop</span>
              <input
                type="number"
                step="any"
                value={editStop}
                placeholder="none"
                onChange={(e) => setEditStop(e.target.value)}
                className="border-border bg-secondary/50 focus:ring-ring rounded-md border px-2 py-1.5 text-right font-mono text-xs outline-none focus:ring-2"
              />
            </label>
            <label className="flex flex-col gap-1 text-[10px]">
              <span className="text-muted-foreground uppercase">Target (TP)</span>
              <input
                type="number"
                step="any"
                value={editTarget}
                placeholder="none"
                onChange={(e) => setEditTarget(e.target.value)}
                className="border-border bg-secondary/50 focus:ring-ring rounded-md border px-2 py-1.5 text-right font-mono text-xs outline-none focus:ring-2"
              />
            </label>
          </div>
          <p className="text-muted-foreground mt-2 text-[10px] leading-relaxed">
            Editing the stop resets the 1R reference point used for breakeven/ATR trailing to this new value.
          </p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={saveEdit}
              className="bg-primary text-primary-foreground rounded-md px-3 py-1.5 text-[11px] font-semibold hover:opacity-90"
            >
              Save Changes
            </button>
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="border-border text-muted-foreground hover:bg-secondary rounded-md border px-3 py-1.5 text-[11px] font-semibold"
            >
              Cancel
            </button>
          </div>
        </li>
      ) : null}
    </>
  )
}
