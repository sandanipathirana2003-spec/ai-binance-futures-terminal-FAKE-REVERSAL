# Fake Reversal Protection (1m entry, 3m confirmation)

New: `lib/fake-reversal.ts` (engine), `app/api/reversal/route.ts`, `hooks/use-reversal.ts`,
`components/terminal/reversal-{badge,card,panel}.tsx`, `scripts/test-fake-reversal.ts`.
Edited: `terminal.tsx` (new "Reversal" tab + detail card under the timeframe grid), `coin-scanner.tsx` (Rev column).

## Signal states
- **EARLY WARNING** (label "EARLY REVERSAL"): a closed 1m candle completed an MA7/25 cross. Never an entry.
- **CONFIRMED** ("CONFIRMED ENTRY"): a LATER closed 3m candle agrees (MA7/25 + close vs MA25), market not sideways, confidence >= 40.
- **REJECTED**: shown as WAIT (sideways), REVERSAL FAILED (1m turned back first), or REJECTED (3m never confirmed in 15 1m bars / confidence too low).

## Rules
1. A single cross never enters. 2. Only closed candles (forming candle dropped, +2s grace). 3. Checks: price vs MA99, MA99 slope (ATR units), Supertrend(10,3).
4. Sideways = avg |MA7-MA25| < 0.5 ATR over 20 bars AND |MA99 slope over 10 bars| < 0.6 ATR -> WAIT.
5/6. Clock-aligned 3m bars built from closed 1m bars; confirmation must close strictly after the cross bar.
7. Opposite 1m cross (or Supertrend flip) before 3m confirms -> REVERSAL FAILED.
8. Confidence: 25 each for price vs MA99, slope, Supertrend, 3m. MA99-vs-Supertrend conflict: -10 and never HIGH. HIGH >= 90, MEDIUM >= 60.
9. Full history is replayed bar by bar with causal indicators: old signals cannot change when new candles arrive (tested).
10. Every event stores exact reasons + per-check detail; the card shows the full signal/rejection log.

Thresholds live in `DEFAULT_FAKE_REVERSAL_CONFIG` and are NOT tuned on live Binance data.
Checks: `npx tsx scripts/test-fake-reversal.ts`

---

# VIDYA BUY / SELL / NEUTRAL change tracking + mobile layout

## VIDYA signal changes
- `lib/indicators.ts`: `vidya()` split into a shared core (output verified identical to before). New `vidyaSignalSeries()` gives BUY/SELL/NEUTRAL for every candle in one pass, and `summarizeSignalHistory()` turns it into "current state + last 6 changes".
- The live per-timeframe signal now comes from the same series, so the grid and the history can never disagree (verified identical to the old `bucketSignal` on 270 random series).
- `CoinSignal` / `BtcTrend` gain `signalHistory` per timeframe (1m/3m/5m/15m/1h). History is rebuilt from real candles on each refresh, so changes appear immediately without leaving the page open.
- New **VIDYA** tab (`components/terminal/vidya-panel.tsx`): pick a timeframe, filter Buy / Sell / Neutral, "New only" (changed within the last 3 candles), search; most recent change on top; tap a row for every timeframe's last 6 changes and an "Open in Terminal" button.
- Timeframe cards in the terminal now show the last change (e.g. `NEUTRAL -> BUY`, `16m ago`).
- Note: the newest candle is still forming, so a change on "this candle" can still revert.

## Mobile
- Bottom tab bar on phones (Terminal / VIDYA / Ribbon / Journal / Signals); desktop keeps the top tabs.
- Terminal tab on phones switches between Coins / BTC / Bot instead of stacking everything.
- Compact B/S/N badges in tight rows, 2-column timeframe cards, shorter top bar, safe-area padding for iPhone notch + home bar.
- Trade Journal history scrolls sideways instead of squashing; MA Ribbon keeps the coin column pinned.
- `public/sw.js` (v2): page loads are now network-first, so an installed phone app picks up new deploys instead of showing the old cached shell.

---

# Supertrend replaced by Volumatic VIDYA + MA Cross (9/21/50/200)

- `lib/indicators.ts`: `supertrend()` removed. New `vidya()` (CMO-adaptive VIDYA 10/20, SMA-15 smoothing, ATR(200) x 2 flip bands, buy/sell volume + delta % per trend leg) and `maCross()` (EMA 9/21/50/200, state + candles-since-cross for 9/21, 21/50, 50/200).
- `lib/signals.ts`: bucket vote = VIDYA direction + at least 2 of 3 confirmations (RSI, MACD, MA cross alignment; `MIN_CONFIRMATIONS`). Score budget stays 100: VIDYA maturity 10 + MA cross alignment 5 (was Supertrend maturity 15).
- Types/UI: `supertrend` field replaced by `vidya` and `maCross` on CoinSignal/BtcTrend; sidebar shows VIDYA, MA Cross and VIDYA volume delta; coin header shows VIDYA and MA Cross chips.
- The 1H confluence gate (EMA200, EMA stack, SMA50/200, MACD, Ribbon) is unchanged.

---

# What was actually wrong, and what changed

## Root causes found
1. **Not using Binance at all.** `/api/market` was pulling from CoinGecko (spot market, top 100 by market cap), not Binance Futures.
2. **No real Supertrend.** The "Supertrend" was actually EMA+RSI+slope voting on fake mini price windows — never an ATR-based Supertrend. That's why it looked frozen: it wasn't a real indicator to begin with.
3. **Fake timeframes.** CoinGecko only gives 7-day hourly data, but the code sliced it into tiny windows and labeled them "1M/3M/5M" as if they were 1-minute candles. Completely mislabeled.
4. **Silent fake data fallback.** If CoinGecko failed or rate-limited, the app quietly generated randomized synthetic prices and displayed them as if real (`live:false` flag existed but wasn't obvious in the UI).
5. **Broken repo structure** (in the *other* repo you first sent me) — files were flat when imports expected `app/`, `lib/`, `components/` folders. That repo would fail to build from a fresh clone.
6. **No trade-freeze / auto SL-TP.** This specific repo (`new-project-my`) didn't have the auto-close-on-SL/TP feature yet — I ported it over from your other repo, where it did already work correctly.

## What's fixed now
- **Real Binance USDT-M Futures data**: `lib/binance.ts` pulls the full list of live PERPETUAL/USDT contracts (250-300+, exceeds your "100+" ask) plus real 1H candles.
- **Real ATR-based Supertrend**: `lib/indicators.ts` implements the actual algorithm (period 10, multiplier 3) with proper band-flip logic — verified with a runtime test that it correctly flips direction when price action actually reverses.
- **Honest timeframes**: relabeled to `4H / 12H / 1D / 2D`, built by resampling real 1H candles (not fake slices).
- **No more fake data**: if Binance is unreachable, the UI now says so explicitly ("DATA UNAVAILABLE") instead of quietly showing synthetic numbers.
- **Trade freeze + live PnL**: entry/stop/target lock the moment you log a trade; only price and P&L update live every 15s (unchanged behavior, now fed by real Binance prices).
- **Rate-limit safe**: signal/Supertrend recompute is cached for 3 minutes (klines are heavy); price ticks refresh every 15s via one cheap bulk endpoint.
- **PWA / mobile install**: added `manifest.json`, a minimal service worker, and app icons so you can "Add to Home Screen" on iOS/Android and it opens like a native app.

## Honest limitation
"Accurate signals only" isn't something any system can promise — I tightened the confluence logic (Supertrend + RSI + MACD must agree, and 3-of-4 timeframes must align) so it should throw fewer, higher-quality signals, but losses will still happen. Treat the score as a filter, not a guarantee.
