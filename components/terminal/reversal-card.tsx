'use client'

import { useState } from 'react'
import { AlertTriangle, Check, ChevronDown, Minus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { formatPrice } from '@/lib/format'
import { useReversalDetail } from '@/hooks/use-reversal'
import type { ReversalCheck, ReversalEvent, ReversalResult } from '@/lib/fake-reversal'
import { ReversalBadge } from './reversal-badge'

function utc(ms: number) {
  if (!ms) return '—'
  const d = new Date(ms)
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')} UTC`
}

function CheckRow({ c }: { c: ReversalCheck }) {
  return (
    <li className="flex items-start gap-2 text-xs">
      <span
        className={cn(
          'mt-0.5 inline-flex size-4 shrink-0 items-center justify-center rounded',
          c.passed === true ? 'bg-bull/15 text-bull' : c.passed === false ? 'bg-bear/15 text-bear' : 'bg-muted text-muted-foreground',
        )}
      >
        {c.passed === true ? <Check className="size-3" /> : c.passed === false ? <X className="size-3" /> : <Minus className="size-3" />}
      </span>
      <span className="min-w-0">
        <span className="text-foreground/90 font-semibold">{c.label}</span>
        <span className="text-muted-foreground block break-words">{c.detail}</span>
      </span>
    </li>
  )
}

function EventRow({ e }: { e: ReversalEvent }) {
  const [open, setOpen] = useState(false)
  return (
    <li className="border-border/60 border-b last:border-b-0">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center gap-2 py-2 text-left">
        <ReversalBadge label={e.label} direction={e.direction} tier={e.tier} />
        <span className="text-muted-foreground font-mono text-[10px]">{utc(e.time)}</span>
        {e.state !== 'REJECTED' ? <span className="text-muted-foreground font-mono text-[10px]">conf {e.confidence}</span> : null}
        <ChevronDown className={cn('text-muted-foreground ml-auto size-3.5 transition-transform', open && 'rotate-180')} />
      </button>
      {open ? (
        <ul className="text-muted-foreground mb-2 space-y-1 pl-1 text-[11px]">
          {e.reasons.map((r, i) => (
            <li key={i} className="break-words">
              • {r}
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  )
}

function Body({ r, price }: { r: ReversalResult; price?: number }) {
  const m = r.metrics
  const early = r.state === 'EARLY_WARNING'
  const confirmed = r.state === 'CONFIRMED'
  const tierColor = r.tier === 'HIGH' ? 'bg-bull' : r.tier === 'MEDIUM' ? 'bg-warn' : 'bg-bear'
  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <ReversalBadge label={r.label} direction={r.direction} tier={r.tier} className="px-2.5 py-1 text-xs" />
        {r.state !== 'NONE' && r.label !== 'WAIT' && r.label !== 'REVERSAL FAILED' ? (
          <span className="flex items-center gap-2">
            <span className="bg-secondary h-1.5 w-20 overflow-hidden rounded-full">
              <span className={cn('block h-full rounded-full', tierColor)} style={{ width: `${r.confidence}%` }} />
            </span>
            <span className="font-mono text-xs font-bold">
              {r.confidence}
              <span className="text-muted-foreground font-normal"> / 100 · {r.tier}</span>
            </span>
          </span>
        ) : null}
        <span className="text-muted-foreground ml-auto font-mono text-[10px]">
          closed candle {utc(r.asOf)}
          {price ? ` · live $${formatPrice(price)}` : ''}
        </span>
      </div>

      {early ? (
        <div className="border-warn/30 bg-warn/10 text-warn flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>Early warning only — this is NOT an entry. It upgrades to CONFIRMED ENTRY only if a closed 3m candle agrees; it is cancelled as REVERSAL FAILED if 1m turns back first.</span>
        </div>
      ) : null}
      {m?.ma99StConflict && r.state !== 'NONE' ? (
        <div className="border-warn/30 bg-warn/10 text-warn flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>MA99 and Supertrend disagree — confidence is lowered and this is not a high-confidence setup.</span>
        </div>
      ) : null}
      {confirmed && r.tier === 'LOW' ? (
        <div className="border-bear/30 bg-bear/10 text-bear flex items-start gap-2 rounded-md border px-3 py-2 text-xs">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />
          <span>Confirmed, but LOW confidence: little trend support. Treat as a weak setup.</span>
        </div>
      ) : null}

      {r.reasons.length > 0 ? (
        <div>
          <h3 className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
            {r.state === 'REJECTED' ? 'Why it was rejected' : 'Why'}
          </h3>
          <ul className="space-y-1 text-xs">
            {r.reasons.map((x, i) => (
              <li key={i} className={cn('break-words', i === 0 ? 'text-foreground font-semibold' : 'text-muted-foreground')}>
                {i === 0 ? x : `• ${x}`}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted-foreground text-xs">No crossover setup is active on closed candles. Nothing to act on.</p>
      )}

      {r.checks.length > 0 ? (
        <div>
          <h3 className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">Checks</h3>
          <ul className="space-y-1.5">
            {r.checks.map((c) => (
              <CheckRow key={c.id} c={c} />
            ))}
          </ul>
        </div>
      ) : null}

      {m ? (
        <div className="text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-0.5 font-mono text-[10px] sm:grid-cols-4">
          <span>MA7 {formatPrice(m.ma7)}</span>
          <span>MA25 {formatPrice(m.ma25)}</span>
          <span>MA99 {formatPrice(m.ma99)}</span>
          <span>ST {m.supertrend}</span>
          <span>MA99 slope {m.ma99SlopeAtr >= 0 ? '+' : ''}{m.ma99SlopeAtr.toFixed(2)} ATR</span>
          <span>MA7/25 sep {m.avgSepAtr.toFixed(2)} ATR</span>
          <span>ATR(14) {formatPrice(m.atr)}</span>
          <span>{m.chop ? 'SIDEWAYS' : 'trending'}</span>
        </div>
      ) : null}

      {r.events.length > 0 ? (
        <div>
          <h3 className="text-muted-foreground mb-1 text-[10px] font-semibold uppercase tracking-wider">
            Signal log (every signal &amp; rejection, newest first)
          </h3>
          <ul>
            {r.events.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

export function ReversalCard({ symbol, price }: { symbol?: string; price?: number }) {
  const { detail, isLoading } = useReversalDetail(symbol)
  return (
    <div className="border-border bg-card flex flex-col rounded-lg border">
      <div className="border-border flex flex-wrap items-center justify-between gap-2 border-b p-3">
        <div>
          <h2 className="text-sm font-semibold">Fake-Reversal Filter</h2>
          <p className="text-muted-foreground text-[11px]">1m entry · 3m confirmation · closed candles only · MA 7/25/99 + Supertrend</p>
        </div>
      </div>
      {!symbol ? (
        <p className="text-muted-foreground p-4 text-xs">Select a coin.</p>
      ) : detail && !detail.live ? (
        <p className="text-bear p-4 text-xs">Reversal data unavailable ({detail.error ?? 'unknown error'}). No signal is shown.</p>
      ) : !detail?.result || detail.symbol !== symbol ? (
        <p className="text-muted-foreground p-4 text-xs">{isLoading ? 'Loading closed 1m candles…' : 'No data.'}</p>
      ) : (
        <Body r={detail.result} price={price} />
      )}
    </div>
  )
}
