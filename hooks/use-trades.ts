'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Trade } from '@/lib/types'

const KEY = 'v0-trade-journal'
const EVT = 'v0-trades-changed'

function load(): Trade[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as Trade[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function save(trades: Trade[]) {
  window.localStorage.setItem(KEY, JSON.stringify(trades))
  window.dispatchEvent(new Event(EVT))
}

/**
 * Local-first trade journal. Trades are persisted to localStorage and synced
 * across components/tabs via a custom event + the native `storage` event.
 */
export function useTrades() {
  const [trades, setTrades] = useState<Trade[]>([])

  useEffect(() => {
    setTrades(load())
    const sync = () => setTrades(load())
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const addTrade = useCallback(
    (trade: Omit<Trade, 'id' | 'openedAt' | 'status' | 'exit' | 'closedAt' | 'closeReason' | 'initialStop'>) => {
      const next: Trade = {
        ...trade,
        id: crypto.randomUUID(),
        status: 'OPEN',
        exit: null,
        closedAt: null,
        openedAt: Date.now(),
        closeReason: null,
        initialStop: trade.stop, // locked at open — the reference point for 1R trailing, never mutated after this
        partialTaken: false,
      }
      save([next, ...load()])
    },
    [],
  )

  const closeTrade = useCallback((id: string, exit: number) => {
    save(
      load().map((t) =>
        t.id === id ? { ...t, exit, status: 'CLOSED' as const, closedAt: Date.now(), closeReason: 'MANUAL' as const } : t,
      ),
    )
  }, [])

  const removeTrade = useCallback((id: string) => {
    save(load().filter((t) => t.id !== id))
  }, [])

  /**
   * Edit Entry / Stop / Target on an OPEN trade. If the stop is part of the
   * edit, initialStop resets to match — the manual correction becomes the new
   * "1R" reference point for breakeven/ATR trailing, not the original value.
   */
  const updateTrade = useCallback((id: string, patch: Partial<Pick<Trade, 'entry' | 'stop' | 'target'>>) => {
    save(
      load().map((t) => {
        if (t.id !== id || t.status !== 'OPEN') return t
        const updated = { ...t, ...patch }
        if ('stop' in patch) updated.initialStop = patch.stop ?? null
        return updated
      }),
    )
  }, [])

  const clearAll = useCallback(() => save([]), [])

  const TRAIL_ATR_MULT = 1.25 // within the recommended ATR x1.0-1.5 trailing band

  /**
   * Handles ONE OPEN wideScalp trade per the Wide-Stop Scalp spec:
   *  - Rule 3: once price moves >= 1x ATR-at-entry in our favor, stop moves to
   *    Entry +/- 0.1% (a small locked-in profit, not exact breakeven).
   *  - Rule 4: at that SAME 1x-ATR point, 50% of the position is closed at TP1
   *    as its own CLOSED trade record (so it shows correctly in the journal and
   *    counts correctly toward Realized P&L); the remaining 50% keeps riding
   *    toward TP2 (1.5x ATR-at-entry) with the new breakeven-plus stop.
   * ATR is frozen at entry (t.atrAtEntry) so TP1/TP2/trigger levels don't drift
   * as live ATR updates every 5-minute recompute — a fixed plan, not a moving target.
   * Returns the updated trade plus an optional extra CLOSED record for the partial.
   */
  function checkWideScalpTrade(t: Trade, price: number): { updated: Trade; partial?: Trade; changed: boolean } {
    const isLong = t.side === 'LONG'
    const atrE = t.atrAtEntry
    if (!atrE || atrE <= 0) {
      // No frozen ATR to work from — fall back to plain stop/target hit-checking, no partial/breakeven logic.
      const hitStop = t.stop != null && (isLong ? price <= t.stop : price >= t.stop)
      const hitTarget = t.target != null && (isLong ? price >= t.target : price <= t.target)
      if (hitStop) return { updated: { ...t, exit: t.stop as number, status: 'CLOSED', closedAt: Date.now(), closeReason: 'SL' }, changed: true }
      if (hitTarget) return { updated: { ...t, exit: t.target as number, status: 'CLOSED', closedAt: Date.now(), closeReason: 'TP' }, changed: true }
      return { updated: t, changed: false }
    }

    const tp1 = isLong ? t.entry + atrE * 1 : t.entry - atrE * 1
    const tp2 = isLong ? t.entry + atrE * 1.5 : t.entry - atrE * 1.5
    const breakevenPlus = isLong ? t.entry * 1.001 : t.entry * 0.999

    if (!t.partialTaken) {
      const hitTp1 = isLong ? price >= tp1 : price <= tp1
      const hitStop = t.stop != null && (isLong ? price <= t.stop : price >= t.stop)

      if (hitStop) {
        return { updated: { ...t, exit: t.stop as number, status: 'CLOSED', closedAt: Date.now(), closeReason: 'SL' }, changed: true }
      }
      if (hitTp1) {
        const partialSize = t.size * 0.5
        const partial: Trade = {
          ...t,
          id: crypto.randomUUID(),
          size: partialSize,
          exit: tp1,
          status: 'CLOSED',
          closedAt: Date.now(),
          closeReason: 'TP',
          notes: `${t.notes} · Partial 50% at TP1 (Wide-Stop Scalp)`.trim(),
        }
        const updated: Trade = {
          ...t,
          size: t.size - partialSize,
          stop: breakevenPlus,
          target: tp2,
          partialTaken: true,
        }
        return { updated, partial, changed: true }
      }
      return { updated: t, changed: false }
    }

    // Partial already taken — remaining 50% rides toward TP2 with the breakeven-plus stop.
    const hitStop = t.stop != null && (isLong ? price <= t.stop : price >= t.stop)
    const hitTp2 = isLong ? price >= tp2 : price <= tp2
    if (hitStop) {
      return { updated: { ...t, exit: t.stop as number, status: 'CLOSED', closedAt: Date.now(), closeReason: 'SL' }, changed: true }
    }
    if (hitTp2) {
      return { updated: { ...t, exit: tp2, status: 'CLOSED', closedAt: Date.now(), closeReason: 'TP' }, changed: true }
    }
    return { updated: t, changed: false }
  }

  /**
   * Auto-manages every OPEN trade on each market refresh. Two distinct paths:
   *  - strategy === 'wideScalp': Rules 3+4 (partial close at 1x ATR + breakeven-plus + TP2 at 1.5x ATR).
   *  - default: generic breakeven + ATR x1.25 trailing once price moves >= 1R,
   *    then auto-close on stop/target hit.
   * `context` carries both price and that symbol's live ATR (1H) — used by the
   * default path only; wideScalp uses its own frozen atrAtEntry instead.
   */
  const autoCheckTrades = useCallback((context: Record<string, { price: number; atr: number }>) => {
    const current = load()
    let changed = false
    const extras: Trade[] = []

    const next = current.map((t) => {
      if (t.status !== 'OPEN') return t
      const ctx = context[t.symbol]
      if (!ctx || !ctx.price) return t
      const { price, atr } = ctx

      if (t.strategy === 'wideScalp') {
        const result = checkWideScalpTrade(t, price)
        if (result.changed) changed = true
        if (result.partial) extras.push(result.partial)
        return result.updated
      }

      const isLong = t.side === 'LONG'
      let stop = t.stop
      // Backfill initialStop for trades created before this field existed.
      const initialStop = t.initialStop ?? t.stop

      if (stop != null && initialStop != null) {
        const oneR = Math.abs(t.entry - initialStop)
        const favorableMove = isLong ? price - t.entry : t.entry - price
        if (oneR > 0 && favorableMove >= oneR) {
          const breakeven = t.entry
          const trailLevel = atr > 0 ? (isLong ? price - atr * TRAIL_ATR_MULT : price + atr * TRAIL_ATR_MULT) : breakeven
          const candidate = isLong ? Math.max(breakeven, trailLevel) : Math.min(breakeven, trailLevel)
          const improved = isLong ? candidate > stop : candidate < stop
          if (improved) {
            stop = candidate
            changed = true
          }
        }
      }

      const hitStop = stop != null && (isLong ? price <= stop : price >= stop)
      const hitTarget = t.target != null && (isLong ? price >= t.target : price <= t.target)

      if (hitStop) {
        changed = true
        return { ...t, stop, initialStop, exit: stop, status: 'CLOSED' as const, closedAt: Date.now(), closeReason: 'SL' as const }
      }
      if (hitTarget) {
        changed = true
        return { ...t, stop, initialStop, exit: t.target, status: 'CLOSED' as const, closedAt: Date.now(), closeReason: 'TP' as const }
      }
      if (stop !== t.stop || initialStop !== t.initialStop) {
        return { ...t, stop, initialStop }
      }
      return t
    })
    if (changed) save([...extras, ...next])
  }, [])

  return { trades, addTrade, closeTrade, removeTrade, updateTrade, clearAll, autoCheckTrades }
}

/** Realized P&L in quote currency for a closed trade (notional-based). */
export function tradePnl(t: Trade): number {
  if (t.exit === null) return 0
  const pct = t.side === 'LONG' ? (t.exit - t.entry) / t.entry : (t.entry - t.exit) / t.entry
  return pct * t.size
}

export function tradePnlPct(t: Trade): number {
  if (t.exit === null) return 0
  return (t.side === 'LONG' ? (t.exit - t.entry) / t.entry : (t.entry - t.exit) / t.entry) * 100
}
