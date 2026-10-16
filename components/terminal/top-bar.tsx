import { Activity, Radio, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

export function TopBar({ live, updatedAt, error }: { live: boolean; updatedAt?: number; error?: string }) {
  const time = updatedAt ? new Date(updatedAt).toLocaleTimeString('en-US', { hour12: false }) : '--:--:--'

  return (
    <header className="border-border bg-sidebar flex items-center justify-between gap-2 border-b px-3 py-2 sm:gap-4 sm:px-4 sm:py-2.5">
      <div className="flex min-w-0 items-center gap-2.5">
        <div className="bg-primary/15 text-primary flex size-8 shrink-0 items-center justify-center rounded-md">
          <Activity className="size-4" />
        </div>
        <div className="min-w-0 leading-tight">
          <h1 className="truncate text-sm font-semibold tracking-tight">AI Binance Futures Terminal</h1>
          <p className="text-muted-foreground hidden font-mono text-[11px] md:block">
            Volumatic VIDYA · MA Cross 9/21/50/200 · Multi-timeframe alignment · Bot execution
          </p>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-3">
        <div className="border-warn/30 bg-warn/10 text-warn hidden items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-[11px] font-semibold sm:flex">
          <ShieldCheck className="size-3.5" />
          SAFE MODE · SIGNALS ONLY
        </div>
        <div
          className={cn(
            'flex items-center gap-1.5 rounded border px-2.5 py-1 font-mono text-[11px] font-semibold',
            live ? 'border-bull/30 bg-bull/10 text-bull' : 'border-bear/30 bg-bear/10 text-bear',
          )}
          title={error ?? undefined}
        >
          <Radio className={cn('size-3.5', live && 'animate-pulse')} />
          {live ? (
            <>
              LIVE<span className="hidden sm:inline"> · BINANCE</span>
            </>
          ) : (
            <>
              <span className="sm:hidden">OFFLINE</span>
              <span className="hidden sm:inline">DATA UNAVAILABLE</span>
            </>
          )}
          <span className="text-muted-foreground ml-1 hidden md:inline">{time}</span>
        </div>
      </div>
    </header>
  )
}
