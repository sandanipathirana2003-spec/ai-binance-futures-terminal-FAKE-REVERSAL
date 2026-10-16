import { cn } from '@/lib/utils'
import type { Signal } from '@/lib/types'

const styles: Record<Signal, string> = {
  BUY: 'bg-bull/15 text-bull border-bull/30',
  SELL: 'bg-bear/15 text-bear border-bear/30',
  NEUTRAL: 'bg-muted text-muted-foreground border-border',
}

export function SignalBadge({
  signal,
  className,
  size = 'sm',
  compact = false,
}: {
  signal: Signal
  className?: string
  size?: 'sm' | 'md'
  /** Phones: show a single letter (B / S / N) below the sm breakpoint so five badges fit in a row. */
  compact?: boolean
}) {
  return (
    <span
      title={signal}
      className={cn(
        'inline-flex items-center justify-center rounded border font-mono font-semibold uppercase tracking-wide',
        size === 'sm' ? 'px-1.5 py-0.5 text-[10px]' : 'px-2.5 py-1 text-xs',
        styles[signal],
        className,
      )}
    >
      {compact ? (
        <>
          <span className="sm:hidden">{signal[0]}</span>
          <span className="hidden sm:inline">{signal}</span>
        </>
      ) : (
        signal
      )}
    </span>
  )
}
