import { ArrowDownRight, ArrowUpRight, Ban, Hourglass, ShieldAlert, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ConfidenceTier, ReversalDirection, ReversalLabel } from '@/lib/fake-reversal'

const SHORT: Record<ReversalLabel, string> = {
  'EARLY REVERSAL': 'EARLY',
  'CONFIRMED ENTRY': 'CONFIRMED',
  WAIT: 'WAIT',
  'REVERSAL FAILED': 'FAILED',
  REJECTED: 'REJECTED',
  '—': '—',
}

export function reversalStyle(label: ReversalLabel, direction: ReversalDirection | null): string {
  switch (label) {
    case 'CONFIRMED ENTRY':
      return direction === 'SHORT' ? 'bg-bear/20 text-bear border-bear/40' : 'bg-bull/20 text-bull border-bull/40'
    case 'EARLY REVERSAL':
      return 'bg-warn/15 text-warn border-warn/40'
    case 'REVERSAL FAILED':
      return 'bg-bear/10 text-bear border-bear/30'
    default:
      return 'bg-muted text-muted-foreground border-border'
  }
}

function Icon({ label, direction }: { label: ReversalLabel; direction: ReversalDirection | null }) {
  const cls = 'size-3 shrink-0'
  if (label === 'CONFIRMED ENTRY') return direction === 'SHORT' ? <ArrowDownRight className={cls} /> : <ArrowUpRight className={cls} />
  if (label === 'EARLY REVERSAL') return <ShieldAlert className={cls} />
  if (label === 'WAIT') return <Hourglass className={cls} />
  if (label === 'REVERSAL FAILED') return <Ban className={cls} />
  if (label === 'REJECTED') return <ShieldCheck className={cls} />
  return null
}

export function ReversalBadge({
  label,
  direction,
  tier,
  compact = false,
  className,
}: {
  label: ReversalLabel
  direction: ReversalDirection | null
  tier?: ConfidenceTier
  compact?: boolean
  className?: string
}) {
  if (label === '—') return <span className="text-muted-foreground font-mono text-[10px]">—</span>
  const dir = direction === 'LONG' ? 'L' : direction === 'SHORT' ? 'S' : ''
  return (
    <span
      title={`${label}${direction ? ` · ${direction}` : ''}${tier ? ` · ${tier} confidence` : ''}`}
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded border px-1.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wide',
        reversalStyle(label, direction),
        className,
      )}
    >
      <Icon label={label} direction={direction} />
      {compact ? (
        <>
          {dir ? <span>{dir}</span> : null}
          <span className="hidden sm:inline">{SHORT[label]}</span>
        </>
      ) : (
        <>
          {direction && label !== 'WAIT' ? <span>{direction}</span> : null}
          <span>{label}</span>
        </>
      )}
    </span>
  )
}
