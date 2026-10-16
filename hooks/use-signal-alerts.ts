'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CoinSignal, SignalAlert } from '@/lib/types'

const KEY = 'v0-signal-alerts'
const EVT = 'v0-signal-alerts-changed'
const MAX_ALERTS = 200

function load(): SignalAlert[] {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as SignalAlert[]
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function save(alerts: SignalAlert[]) {
  window.localStorage.setItem(KEY, JSON.stringify(alerts.slice(0, MAX_ALERTS)))
  window.dispatchEvent(new Event(EVT))
}

/**
 * Watches every coin's confluence-gated trend on each market refresh. The moment
 * a coin flips from NEUTRAL into a confirmed BULLISH/BEARISH (i.e. the gate just
 * passed), it's logged as an alert and — if the user granted permission — pushed
 * as a real OS-level browser notification, which shows up even if this tab isn't
 * focused (the closest thing a web app can do to "open in another tab").
 */
export function useSignalAlerts(coins: CoinSignal[] | undefined) {
  const [alerts, setAlerts] = useState<SignalAlert[]>([])
  const [permission, setPermission] = useState<NotificationPermission>('default')
  const [soundEnabled, setSoundEnabled] = useState(true)
  const lastTrend = useRef<Map<string, string>>(new Map())
  const primed = useRef(false)

  useEffect(() => {
    setAlerts(load())
    if (typeof Notification !== 'undefined') setPermission(Notification.permission)
    const raw = window.localStorage.getItem('v0-alert-sound')
    if (raw != null) setSoundEnabled(raw === '1')
    const sync = () => setAlerts(load())
    window.addEventListener(EVT, sync)
    window.addEventListener('storage', sync)
    return () => {
      window.removeEventListener(EVT, sync)
      window.removeEventListener('storage', sync)
    }
  }, [])

  const playChime = useCallback(() => {
    try {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      const ctx = new Ctx()
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = 880
      gain.gain.setValueAtTime(0.001, ctx.currentTime)
      gain.gain.exponentialRampToValueAtTime(0.15, ctx.currentTime + 0.02)
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start()
      osc.stop(ctx.currentTime + 0.4)
    } catch {
      // Audio isn't critical — silently skip if the browser blocks it.
    }
  }, [])

  const requestPermission = useCallback(async () => {
    if (typeof Notification === 'undefined') return
    const result = await Notification.requestPermission()
    setPermission(result)
  }, [])

  const toggleSound = useCallback(() => {
    setSoundEnabled((prev) => {
      const next = !prev
      window.localStorage.setItem('v0-alert-sound', next ? '1' : '0')
      return next
    })
  }, [])

  const clearAlerts = useCallback(() => save([]), [])

  // Diff each market refresh against the last-seen trend per symbol and log/notify on new confirmations.
  useEffect(() => {
    if (!coins || coins.length === 0) return

    // First pass just seeds the baseline so we don't fire a notification storm
    // for every already-confirmed signal the moment the page loads.
    if (!primed.current) {
      for (const c of coins) lastTrend.current.set(c.symbol, c.trend)
      primed.current = true
      return
    }

    const fresh: SignalAlert[] = []
    for (const c of coins) {
      const prev = lastTrend.current.get(c.symbol)
      if ((c.trend === 'BULLISH' || c.trend === 'BEARISH') && prev !== c.trend) {
        fresh.push({
          id: crypto.randomUUID(),
          symbol: c.symbol,
          trend: c.trend,
          score: c.score,
          price: c.price,
          timestamp: Date.now(),
        })
      }
      lastTrend.current.set(c.symbol, c.trend)
    }

    if (fresh.length === 0) return

    save([...fresh, ...load()])

    for (const alert of fresh) {
      if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
        const body = `${alert.trend} · Score ${alert.score} · $${alert.price}`
        new Notification(`${alert.symbol.replace('USDT', '')} confluence confirmed`, {
          body,
          tag: alert.id,
        })
      }
    }
    if (soundEnabled) playChime()
  }, [coins, soundEnabled, playChime])

  return { alerts, permission, requestPermission, soundEnabled, toggleSound, clearAlerts }
}
