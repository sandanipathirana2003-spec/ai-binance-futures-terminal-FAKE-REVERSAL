'use client'

import useSWR from 'swr'
import type { MarketResponse } from '@/lib/types'

const fetcher = async (url: string): Promise<MarketResponse> => {
  const res = await fetch(url)
  if (!res.ok) throw new Error('Failed to load market data')
  return res.json()
}

export function useMarket() {
  const { data, error, isLoading } = useSWR<MarketResponse>('/api/market', fetcher, {
    refreshInterval: 15000,
    revalidateOnFocus: false,
    keepPreviousData: true,
  })

  return {
    market: data,
    isLoading,
    isError: Boolean(error),
  }
}
