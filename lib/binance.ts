// Binance USDT-M Futures (fapi) client.
// Docs: https://binance-docs.github.io/apidocs/futures/en/

const FAPI = 'https://fapi.binance.com'

export interface Candle {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

interface ExchangeInfoSymbol {
  symbol: string
  status: string
  contractType: string
  quoteAsset: string
}

async function fetchWithRetry(url: string, timeoutMs: number, retries = 2): Promise<Response> {
  let lastErr: unknown
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, { cache: 'no-store', signal: AbortSignal.timeout(timeoutMs) })
      if (res.status === 429 || res.status === 418) {
        // Binance rate limit — back off and retry rather than failing the whole request.
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)))
        continue
      }
      return res
    } catch (err) {
      lastErr = err
      await new Promise((r) => setTimeout(r, 300 * (attempt + 1)))
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('fetch failed after retries')
}

/** All actively trading USDT-margined PERPETUAL contracts. Typically 250-300+ symbols. */
export async function fetchFuturesUniverse(): Promise<string[]> {
  const res = await fetchWithRetry(`${FAPI}/fapi/v1/exchangeInfo`, 10000)
  if (!res.ok) throw new Error(`exchangeInfo failed: ${res.status}`)
  const data = (await res.json()) as { symbols: ExchangeInfoSymbol[] }
  return data.symbols
    .filter((s) => s.status === 'TRADING' && s.contractType === 'PERPETUAL' && s.quoteAsset === 'USDT')
    .map((s) => s.symbol)
}

interface Ticker24hr {
  symbol: string
  lastPrice: string
  priceChangePercent: string
  quoteVolume: string
}

/** Single bulk request covering every symbol's live price + 24h change + volume. */
export async function fetchBulkTicker24hr(): Promise<Map<string, { price: number; changePct: number; quoteVolume: number }>> {
  const res = await fetchWithRetry(`${FAPI}/fapi/v1/ticker/24hr`, 10000)
  if (!res.ok) throw new Error(`ticker/24hr failed: ${res.status}`)
  const data = (await res.json()) as Ticker24hr[]
  const map = new Map<string, { price: number; changePct: number; quoteVolume: number }>()
  for (const t of data) {
    map.set(t.symbol, {
      price: Number(t.lastPrice),
      changePct: Number(t.priceChangePercent),
      quoteVolume: Number(t.quoteVolume),
    })
  }
  return map
}

/** Raw klines for one symbol. interval e.g. '1h'. Returns oldest -> newest. */
export async function fetchKlines(symbol: string, interval: string, limit: number): Promise<Candle[]> {
  const url = `${FAPI}/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  const res = await fetchWithRetry(url, 8000, 1)
  if (!res.ok) throw new Error(`klines failed for ${symbol}: ${res.status}`)
  const raw = (await res.json()) as unknown[][]
  return raw.map((k) => ({
    openTime: k[0] as number,
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
  }))
}

/** Fetch klines for many symbols concurrently (small batches, spaced out) to stay under Binance's burst limits. */
export async function fetchKlinesBatch(
  symbols: string[],
  interval: string,
  limit: number,
  concurrency = 12,
): Promise<Map<string, Candle[]>> {
  const out = new Map<string, Candle[]>()
  for (let i = 0; i < symbols.length; i += concurrency) {
    const batch = symbols.slice(i, i + concurrency)
    const results = await Promise.allSettled(batch.map((s) => fetchKlines(s, interval, limit)))
    results.forEach((r, idx) => {
      if (r.status === 'fulfilled' && r.value.length > 0) out.set(batch[idx], r.value)
    })
    if (i + concurrency < symbols.length) await new Promise((r) => setTimeout(r, 200))
  }
  return out
}
