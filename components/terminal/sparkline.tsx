import { cn } from '@/lib/utils'

export function Sparkline({
  data,
  positive,
  className,
  width = 120,
  height = 36,
}: {
  data: number[]
  positive: boolean
  className?: string
  width?: number
  height?: number
}) {
  if (!data || data.length < 2) {
    return <div className={cn('bg-muted/40 rounded', className)} style={{ width, height }} />
  }

  const min = Math.min(...data)
  const max = Math.max(...data)
  const range = max - min || 1
  const stepX = width / (data.length - 1)

  const points = data.map((v, i) => {
    const x = i * stepX
    const y = height - ((v - min) / range) * height
    return `${x.toFixed(2)},${y.toFixed(2)}`
  })

  const line = `M ${points.join(' L ')}`
  const area = `${line} L ${width},${height} L 0,${height} Z`
  const stroke = positive ? 'var(--bull)' : 'var(--bear)'

  return (
    <svg
      className={className}
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <path d={area} fill={stroke} fillOpacity={0.12} />
      <path d={line} fill="none" stroke={stroke} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  )
}
