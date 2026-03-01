'use client';

/**
 * Approximate price ranges per symbol (USDT) to detect wrong-symbol data.
 * Used to validate that candle data matches the requested symbol after a symbol switch.
 * Ranges are intentionally wide to avoid false positives; we only reject obviously wrong data.
 */
const SYMBOL_PRICE_RANGES: Record<string, { min: number; max: number }> = {
  BTCUSDT: { min: 5_000, max: 500_000 },
  ETHUSDT: { min: 100, max: 50_000 },
  SOLUSDT: { min: 1, max: 2_000 },
  BNBUSDT: { min: 50, max: 5_000 },
  XRPUSDT: { min: 0.1, max: 20 },
};

export interface CandleForValidation {
  close: number;
}

/**
 * Returns true if the given candle data appears to be for the requested symbol
 * (e.g. close prices fall within the expected range for that symbol).
 * Used after a symbol switch to avoid rendering another symbol's data.
 *
 * - If symbol is unknown, returns true (no validation).
 * - If candles is empty, returns true (nothing to validate).
 */
export function isCandleDataForSymbol(
  candles: CandleForValidation[],
  symbol: string
): boolean {
  if (candles.length === 0) return true;
  const norm = symbol.toUpperCase().replace(/\s/g, '');
  const range = SYMBOL_PRICE_RANGES[norm];
  if (!range) return true;

  const sampleSize = Math.min(5, candles.length);
  const sample = candles.slice(-sampleSize);
  for (const c of sample) {
    const price = c.close;
    if (typeof price !== 'number' || Number.isNaN(price)) continue;
    if (price < range.min || price > range.max) {
      if (process.env.NODE_ENV === 'development') {
        console.warn(
          `[candleValidation] Data rejected for ${norm}: close ${price} outside range [${range.min}, ${range.max}]`
        );
      }
      return false;
    }
  }
  return true;
}

/**
 * Returns true if the two candle arrays look like the same data (e.g. same last closes).
 * Used to detect "still showing previous symbol" when we expected new symbol data.
 */
export function isSameCandleData(
  a: CandleForValidation[],
  b: CandleForValidation[]
): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  const n = Math.min(3, a.length);
  for (let i = 0; i < n; i++) {
    const idx = a.length - 1 - i;
    const closeA = a[idx].close;
    const closeB = b[idx].close;
    if (typeof closeA !== 'number' || typeof closeB !== 'number') return false;
    if (Math.abs(closeA - closeB) > 1e-6) return false;
  }
  return true;
}
