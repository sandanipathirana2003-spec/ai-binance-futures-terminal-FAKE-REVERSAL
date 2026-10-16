'use client'

import useSWR from 'swr'
import type { ReversalDetailResponse, ReversalListResponse } from '@/lib/fake-reversal'

async function fetcher<T>(url: string): Promise<T> {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to load reversal data')
  return res.json()
}

/** Compact list of every coin whose fake-reversal state is not NONE. New data only exists once per closed 1m candle. */
export function useReversalList() {
  const { data, error, isLoading } = useSWR<ReversalListResponse>('/api/reversal', fetcher, {
    refreshInterval: 15000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  })
  return { list: data, isLoading, isError: Boolean(error) }
}

/** Full reasons, checks and event log for one coin. */
export function useReversalDetail(symbol: string | undefined) {
  const { data, error, isLoading } = useSWR<ReversalDetailResponse>(
    symbol ? `/api/reversal?symbol=${encodeURIComponent(symbol)}` : null,
    fetcher,
    { refreshInterval: 15000, revalidateOnFocus: false, keepPreviousData: false },
  )
  return { detail: data, isLoading, isError: Boolean(error) }
}
