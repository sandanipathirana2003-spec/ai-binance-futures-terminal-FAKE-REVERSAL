import { useMemo, useState } from 'react'
import { AlertTriangle, ArrowDown, ArrowUp, Minus } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RIBBON_TIMEFRAMES, type CoinSignal, type RibbonArrangement, type RibbonCell, type RibbonLabel } from '@/lib/types'

const TF_LABEL: Record<string, string> = { '5m': '5m', '15m': '15m', '45m': '45m', '1h': '1H', '4h': '4H' }

const LABEL_TEXT: Record<RibbonLabel, string> = {
  VERY_STRONG_BUY: 'Very Strong Buy',
  BUY: 'Buy',
  NEUTRAL: 'Neutral',
  SELL: 'Sell',
  STRONG_SELL: 'Strong Sell',
}

function arrangementColor(a: RibbonArrangement) {
  if (a === 'STRONG_BULLISH' || a === 'BULLISH') return 'bg-bull/15 text-bull border-bull/25'
  if (a === 'STRONG_BEARISH' || a === 'BEARISH') return 'bg-bear/15 text-bear border-bear/25'
  return 'bg-warn/10 text-warn border-warn/25'
}

function decisionColor(label: RibbonLabel) {
  if (label === 'VERY_STRONG_BUY' || label === 'BUY') return 'text-bull'
  if (label === 'STRONG_SELL' || label === 'SELL') return 'text-bear'
  return 'text-warn'
}

function RibbonCellView({ cell }: { cell?: RibbonCell }) {
  if (!cell) return <span className="text-muted-foreground text-[10px]">—</span>
  const short = cell.arrangement.replace('STRONG_', 'S.').replace('BULLISH', 'BULL').replace('BEARISH', 'BEAR').replace('MIXED', 'MIX')
  return (
    <div
      className={cn('flex flex-col items-center gap-0.5 rounded border px-1.5 py-1 font-mono text-[10px] font-bold', arrangementColor(cell.arrangement))}
      title={`${cell.arrangement.replace('_', ' ')} · ${cell.dynamic} · ${cell.bars} bars${cell.sufficientData ? '' : ' (limited history — EMA200/SMA200 not fully converged)'}`}
    >
      <span className="flex items-center gap-1">
        {short}
        {!cell.sufficientData && <AlertTriangle className="size-2.5 opacity-70" />}
      </span>
      <span className="flex items-center gap-0.5 text-[9px] font-normal opacity-80">
        {cell.dynamic === 'EXPANDING' ? <ArrowUp className="size-2.5" /> : cell.dynamic === 'CONTRACTING' ? <ArrowDown className="size-2.5" /> : <Minus className="size-2.5" />}
        {cell.dynamic}
      </span>
    </div>
  )
}

export function RibbonTable({ coins }: { coins: CoinSignal[] }) {
  const [search, setSearch] = useState('')

  const summary = useMemo(() => {
    if (coins.length === 0) return { bullishPct: 0, bearishPct: 0, avgStrength: 0, avgConfidence: 0, position: 'WAIT' as const }
    const bullish = coins.filter((c) => c.ribbon.label === 'BUY' || c.ribbon.label === 'VERY_STRONG_BUY').length
    const bearish = coins.filter((c) => c.ribbon.label === 'SELL' || c.ribbon.label === 'STRONG_SELL').length
    const bullishPct = Math.round((bullish / coins.length) * 100)
    const bearishPct = Math.round((bearish / coins.length) * 100)
    const avgStrength = coins.reduce((s, c) => s + c.ribbon.totalScore, 0) / coins.length
    const avgConfidence = Math.round(coins.reduce((s, c) => s + c.ribbon.confidence, 0) / coins.length)
    let position: 'LONG' | 'SHORT' | 'WAIT' | 'AVOID' = 'WAIT'
    if (bullishPct >= 55 && bullishPct - bearishPct >= 15) position = 'LONG'
    else if (bearishPct >= 55 && bearishPct - bullishPct >= 15) position = 'SHORT'
    else if (Math.abs(bullishPct - bearishPct) < 8) position = 'AVOID'
    return { bullishPct, bearishPct, avgStrength, avgConfidence, position }
  }, [coins])

  const filtered = useMemo(() => {
    const list = search.trim() ? coins.filter((c) => c.symbol.toLowerCase().includes(search.trim().toLowerCase())) : coins
    return [...list].sort((a, b) => Math.abs(b.ribbon.totalScore) - Math.abs(a.ribbon.totalScore))
  }, [coins, search])

  return (
    <div className="flex flex-col gap-3 p-3">
      <div className="border-border bg-card grid grid-cols-2 gap-3 rounded-lg border p-4 sm:grid-cols-5">
        <div>
          <p className="text-muted-foreground text-[10px] font-semibold uppercase">Bullish %</p>
          <p className="text-bull font-mono text-xl font-bold">{summary.bullishPct}%</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px] font-semibold uppercase">Bearish %</p>
          <p className="text-bear font-mono text-xl font-bold">{summary.bearishPct}%</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px] font-semibold uppercase">Trend Strength</p>
          <p className="font-mono text-xl font-bold">{summary.avgStrength.toFixed(1)}</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px] font-semibold uppercase">Momentum Strength</p>
          <p className="font-mono text-xl font-bold">{summary.avgConfidence}%</p>
        </div>
        <div>
          <p className="text-muted-foreground text-[10px] font-semibold uppercase">Recommended Position</p>
          <p
            className={cn(
              'font-mono text-xl font-bold',
              summary.position === 'LONG' ? 'text-bull' : summary.position === 'SHORT' ? 'text-bear' : 'text-warn',
            )}
          >
            {summary.position}
          </p>
        </div>
      </div>

      <input
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search coin…"
        className="border-border bg-secondary/50 focus:ring-ring w-full max-w-xs rounded-md border px-3 py-1.5 text-xs outline-none focus:ring-2 sm:self-end"
      />

      <div className="border-border bg-sidebar overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[820px] text-xs">
          <thead>
            <tr className="border-border text-muted-foreground border-b font-mono text-[10px] font-semibold uppercase">
              <th className="bg-sidebar sticky left-0 z-10 px-3 py-2 text-left">Coin</th>
              {RIBBON_TIMEFRAMES.map((tf) => (
                <th key={tf} className="px-2 py-2 text-center">
                  {TF_LABEL[tf]}
                </th>
              ))}
              <th className="px-3 py-2 text-center">Trend Strength</th>
              <th className="px-3 py-2 text-center">AI Decision</th>
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8} className="text-muted-foreground p-6 text-center">
                  No coins match.
                </td>
              </tr>
            ) : (
              filtered.map((c) => (
                <tr key={c.symbol} className="hover:bg-secondary/20">
                  <td className="bg-sidebar sticky left-0 z-10 px-3 py-2 font-mono font-semibold">{c.symbol.replace('USDT', '')}</td>
                  {RIBBON_TIMEFRAMES.map((tf) => (
                    <td key={tf} className="px-2 py-2 text-center">
                      <RibbonCellView cell={c.ribbon.cells[tf]} />
                    </td>
                  ))}
                  <td className="px-3 py-2 text-center font-mono font-bold">{c.ribbon.totalScore > 0 ? '+' : ''}{c.ribbon.totalScore}</td>
                  <td className={cn('px-3 py-2 text-center font-mono text-[11px] font-bold', decisionColor(c.ribbon.label))}>
                    {LABEL_TEXT[c.ribbon.label]}
                    <span className="text-muted-foreground ml-1 font-normal">{c.ribbon.confidence}%</span>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <p className="text-muted-foreground text-[10px] leading-relaxed">
        Ribbon = EMA9/21/50/100/200 stack per timeframe. Strong Bullish/Bearish require the full cascade; Mixed is
        anything else. ⚠ marks a cell with fewer than 210 real candles behind it (EMA200/SMA200 not fully
        converged — shown honestly rather than hidden). This feeds directly into the confluence gate on the Live
        Terminal — it's not a standalone widget.
      </p>
    </div>
  )
}
