'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Activity, BellRing, BookOpen, Bot, Bitcoin, LineChart, ListFilter, ShieldAlert, Waves } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useMarket } from '@/hooks/use-market'
import { useReversalList } from '@/hooks/use-reversal'
import { useSignalAlerts } from '@/hooks/use-signal-alerts'
import { useTrades } from '@/hooks/use-trades'
import { AlertsPanel } from './alerts-panel'
import { BotPanel } from './bot-panel'
import { BtcSidebar } from './btc-sidebar'
import { CoinScanner } from './coin-scanner'
import { ReversalCard } from './reversal-card'
import { ReversalPanel } from './reversal-panel'
import { RibbonTable } from './ribbon-table'
import { TimeframeGrid } from './timeframe-grid'
import { TopBar } from './top-bar'
import { TradeJournal } from './trade-journal'
import { VidyaPanel } from './vidya-panel'

type Tab = 'terminal' | 'reversal' | 'vidya' | 'journal' | 'ribbon' | 'signals'
/** Phones show one of the three terminal columns at a time; desktop (lg+) shows all three side by side. */
type Pane = 'coins' | 'btc' | 'bot'

const TABS: Array<{ key: Tab; label: string; short: string; Icon: typeof LineChart }> = [
  { key: 'terminal', label: 'Live Terminal', short: 'Terminal', Icon: LineChart },
  { key: 'reversal', label: 'Fake-Reversal', short: 'Reversal', Icon: ShieldAlert },
  { key: 'vidya', label: 'VIDYA Changes', short: 'VIDYA', Icon: Activity },
  { key: 'ribbon', label: 'MA Ribbon', short: 'Ribbon', Icon: Waves },
  { key: 'journal', label: 'Trade Journal', short: 'Journal', Icon: BookOpen },
  { key: 'signals', label: 'Signals', short: 'Signals', Icon: BellRing },
]

const PANES: Array<{ key: Pane; label: string; Icon: typeof LineChart }> = [
  { key: 'coins', label: 'Coins', Icon: ListFilter },
  { key: 'btc', label: 'BTC', Icon: Bitcoin },
  { key: 'bot', label: 'Bot', Icon: Bot },
]

export function Terminal() {
  const { market, isLoading } = useMarket()
  const { list: reversalList } = useReversalList()
  const { autoCheckTrades } = useTrades()
  const { alerts, permission, requestPermission, soundEnabled, toggleSound, clearAlerts } = useSignalAlerts(market?.coins)
  const [selected, setSelected] = useState('BTCUSDT')
  const [tab, setTab] = useState<Tab>('terminal')
  const [pane, setPane] = useState<Pane>('coins')
  const [lastSeenAlertCount, setLastSeenAlertCount] = useState(0)
  const coinsRef = useRef<HTMLElement>(null)

  // Every time fresh prices come in (every 15s), check open trades against
  // their locked stop/target — trailing the stop first (breakeven + ATR) — and
  // auto-close anything that's been hit.
  useEffect(() => {
    if (!market) return
    const context: Record<string, { price: number; atr: number }> = {}
    for (const c of market.coins) context[c.symbol] = { price: c.price, atr: c.tfAtr['1h'] ?? 0 }
    autoCheckTrades(context)
  }, [market, autoCheckTrades])

  // If the selected symbol is missing from the feed, fall back to the first coin.
  useEffect(() => {
    if (!market) return
    if (!market.coins.some((c) => c.symbol === selected) && market.coins[0]) {
      setSelected(market.coins[0].symbol)
    }
  }, [market, selected])

  useEffect(() => {
    if (tab === 'signals') setLastSeenAlertCount(alerts.length)
  }, [tab, alerts.length])

  // Picking a coin on a phone: jump back to the top so the timeframe grid for that coin is what you see.
  const selectCoin = useCallback((symbol: string) => {
    setSelected(symbol)
    coinsRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }, [])

  const openFromVidya = useCallback((symbol: string) => {
    setSelected(symbol)
    setTab('terminal')
    setPane('coins')
    requestAnimationFrame(() => coinsRef.current?.scrollTo({ top: 0 }))
  }, [])

  const openFromReversal = useCallback((symbol: string) => {
    setSelected(symbol)
    setTab('terminal')
    setPane('coins')
    requestAnimationFrame(() => coinsRef.current?.scrollTo({ top: 0 }))
  }, [])

  const reversalBySymbol = useMemo(() => new Map((reversalList?.rows ?? []).map((r) => [r.symbol, r])), [reversalList])
  const coin = market?.coins.find((c) => c.symbol === selected)
  const unread = Math.max(0, alerts.length - lastSeenAlertCount)

  return (
    <div className="bg-background flex h-dvh flex-col pt-[env(safe-area-inset-top)]">
      <TopBar live={market?.live ?? false} updatedAt={market?.updatedAt} error={market?.error} />
      {market && !market.live ? (
        <div className="border-bear/30 bg-bear/10 text-bear border-b px-3 py-2 text-center font-mono text-xs sm:px-4">
          Binance data is unavailable right now ({market.error ?? 'unknown error'}). No signals are shown — retrying automatically, nothing fake is being displayed.
        </div>
      ) : null}

      {/* Desktop tab bar (phones use the bottom bar below). */}
      <nav className="border-border bg-sidebar hidden items-center gap-1 border-b px-3 lg:flex">
        {TABS.map(({ key, label, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'flex items-center gap-2 border-b-2 px-3 py-2.5 text-sm font-medium transition-colors',
              tab === key ? 'border-primary text-foreground' : 'text-muted-foreground hover:text-foreground border-transparent',
            )}
          >
            <Icon className="size-4" />
            {label}
            {key === 'signals' && unread > 0 ? <Badge n={unread} /> : null}
          </button>
        ))}
      </nav>

      {isLoading && !market ? (
        <div className="text-muted-foreground flex flex-1 items-center justify-center font-mono text-sm">Loading market feed…</div>
      ) : tab === 'terminal' ? (
        <main className="flex min-h-0 flex-1 flex-col lg:grid lg:grid-cols-[21rem_minmax(0,1fr)_20rem]">
          {/* Phone-only switcher between the three terminal columns. */}
          <div className="border-border bg-sidebar grid shrink-0 grid-cols-3 gap-1.5 border-b p-2 lg:hidden">
            {PANES.map(({ key, label, Icon }) => (
              <button
                key={key}
                type="button"
                onClick={() => setPane(key)}
                className={cn(
                  'flex items-center justify-center gap-1.5 rounded-md border py-2 text-xs font-semibold transition-colors',
                  pane === key ? 'border-primary/40 bg-primary/15 text-primary' : 'border-border text-muted-foreground',
                )}
              >
                <Icon className="size-3.5" />
                {label}
              </button>
            ))}
          </div>

          <div className={cn('min-h-0 flex-1 lg:block lg:flex-none', pane === 'btc' ? 'block' : 'hidden')}>
            <BtcSidebar btc={market?.btc} />
          </div>

          <section
            ref={coinsRef}
            className={cn('min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-2 sm:p-3 lg:flex lg:flex-none', pane === 'coins' ? 'flex' : 'hidden')}
          >
            <TimeframeGrid coin={coin} />
            <ReversalCard symbol={coin?.symbol} price={coin?.price} />
            <div className="flex min-h-[28rem] flex-1 flex-col lg:min-h-[20rem]">
              <CoinScanner coins={market?.coins ?? []} selected={selected} onSelect={selectCoin} reversal={reversalBySymbol} />
            </div>
          </section>

          <div className={cn('min-h-0 flex-1 lg:block lg:flex-none', pane === 'bot' ? 'block' : 'hidden')}>
            <BotPanel coin={coin} btc={market?.btc} />
          </div>
        </main>
      ) : tab === 'reversal' ? (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <ReversalPanel list={reversalList} onOpen={openFromReversal} />
        </main>
      ) : tab === 'vidya' ? (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <VidyaPanel coins={market?.coins ?? []} btc={market?.btc} onOpen={openFromVidya} />
        </main>
      ) : tab === 'journal' ? (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <TradeJournal coins={market?.coins ?? []} />
        </main>
      ) : tab === 'ribbon' ? (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <RibbonTable coins={market?.coins ?? []} />
        </main>
      ) : (
        <main className="min-h-0 flex-1 overflow-y-auto">
          <AlertsPanel
            alerts={alerts}
            permission={permission}
            onRequestPermission={requestPermission}
            soundEnabled={soundEnabled}
            onToggleSound={toggleSound}
            onClear={clearAlerts}
          />
        </main>
      )}

      {/* Phone bottom tab bar — thumb-reachable, respects the iPhone home-indicator inset. */}
      <nav className="border-border bg-sidebar grid shrink-0 grid-cols-6 border-t pb-[env(safe-area-inset-bottom)] lg:hidden">
        {TABS.map(({ key, short, Icon }) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={cn(
              'relative flex flex-col items-center gap-0.5 py-2 text-[10px] font-medium transition-colors',
              tab === key ? 'text-primary' : 'text-muted-foreground',
            )}
          >
            <span className="relative">
              <Icon className="size-5" />
              {key === 'signals' && unread > 0 ? <Badge n={unread} className="absolute -right-2.5 -top-1.5" /> : null}
            </span>
            {short}
          </button>
        ))}
      </nav>
    </div>
  )
}

function Badge({ n, className }: { n: number; className?: string }) {
  return (
    <span className={cn('bg-bear text-bear-foreground flex size-4 items-center justify-center rounded-full text-[10px] font-bold', className)}>
      {n > 9 ? '9+' : n}
    </span>
  )
}
