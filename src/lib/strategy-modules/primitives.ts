import { Candle } from '../strategy-engine.js';

export interface FractalSwing {
  index: number;
  price: number;
  timestamp: string | number;
  isBroken: boolean;
  brokenByIndex?: number;
}

export function sortCandlesChronological(candles: Candle[]): Candle[] {
  if (!Array.isArray(candles) || candles.length === 0) return [];
  return [...candles].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
}

/**
 * Computes Average True Range (ATR) across the candle series (Wilder-style window or full mean when < period).
 */
export function computeAtr(sortedCandles: Candle[], period = 14): number {
  if (!sortedCandles || sortedCandles.length === 0) return 0;
  if (sortedCandles.length === 1) {
    return Math.max(0, Number(sortedCandles[0].high) - Number(sortedCandles[0].low));
  }

  const trueRanges: number[] = [];
  for (let i = 1; i < sortedCandles.length; i++) {
    const h = Number(sortedCandles[i].high);
    const l = Number(sortedCandles[i].low);
    const prevClose = Number(sortedCandles[i - 1].close);
    const tr = Math.max(h - l, Math.abs(h - prevClose), Math.abs(l - prevClose));
    if (Number.isFinite(tr)) trueRanges.push(tr);
  }

  if (trueRanges.length === 0) return 0;
  if (trueRanges.length <= period) {
    return trueRanges.reduce((acc, v) => acc + v, 0) / trueRanges.length;
  }

  // Initial SMA then Wilder smoothing
  let atr = trueRanges.slice(0, period).reduce((acc, v) => acc + v, 0) / period;
  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
  }
  return atr;
}

/**
 * Computes a buffer scaled to the instrument and volatility for zone invalidation checks.
 */
export function computeInstrumentBuffer(sortedCandles: Candle[], currentPrice: number, pair?: string): { atr: number; buffer: number } {
  const atr = computeAtr(sortedCandles, 14) || currentPrice * 0.002;
  const sym = (pair || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  const isGold = sym.includes('XAU') || sym.includes('GOLD');
  const isSilver = sym.includes('XAG') || sym.includes('SILVER');
  const isJpy = sym.includes('JPY');
  const isIndex =
    sym.includes('NAS') || sym.includes('NDX') || sym.includes('US100') ||
    sym.includes('US30') || sym.includes('DOW') || sym.includes('SPX') ||
    sym.includes('SP500') || sym.includes('US500') || sym.includes('US2000') ||
    sym.includes('GER') || sym.includes('DE30') || sym.includes('DE40') ||
    sym.includes('UK100') || sym.includes('JP225') || sym.includes('HK50') ||
    sym.includes('INDEX');
  const isCrypto =
    sym.includes('BTC') || sym.includes('ETH') || sym.includes('SOL') ||
    sym.includes('XRP') || sym.includes('LTC') || sym.includes('ADA') ||
    sym.includes('DOGE') || sym.includes('BNB') || sym.includes('AVAX') ||
    sym.includes('DOT') || sym.includes('LINK') || sym.includes('MATIC') ||
    sym.includes('UNI') || sym.includes('ATOM') || sym.includes('TON') ||
    sym.includes('SUI') || sym.includes('NEAR') || sym.includes('TRX') ||
    sym.endsWith('USDT') || sym.endsWith('USDC') || sym.endsWith('BUSD') ||
    sym.includes('CRYPTO');
  const isForex = !isGold && !isSilver && !isIndex && !isCrypto && !isJpy && currentPrice < 50;

  let buffer: number;
  if (isGold) {
    buffer = Math.min(Math.max(atr * 0.15, 0.40), 2.50);
  } else if (isSilver) {
    buffer = Math.min(Math.max(atr * 0.15, 0.03), 0.25);
  } else if (isIndex) {
    buffer = Math.min(Math.max(atr * 0.15, 2.0), 15.0);
  } else if (isJpy) {
    buffer = Math.min(Math.max(atr * 0.15, 0.02), 0.06);
  } else if (isForex) {
    buffer = Math.min(Math.max(atr * 0.15, 0.00015), 0.00030);
  } else {
    buffer = Math.min(Math.max(atr * 0.15, currentPrice * 0.0005), currentPrice * 0.003);
  }

  return { atr, buffer };
}

/**
 * Detects 5-bar fractal swing highs and swing lows from chronologically sorted candles.
 */
export function detectFractalSwings(sortedCandles: Candle[], wingBars = 2): {
  swingHighs: FractalSwing[];
  swingLows: FractalSwing[];
} {
  const swingHighs: FractalSwing[] = [];
  const swingLows: FractalSwing[] = [];

  if (!sortedCandles || sortedCandles.length < wingBars * 2 + 1) {
    return { swingHighs, swingLows };
  }

  for (let i = wingBars; i < sortedCandles.length - wingBars; i++) {
    const h = Number(sortedCandles[i].high);
    const l = Number(sortedCandles[i].low);

    let isHighPeak = true;
    let strictHighDiff = false;
    for (let offset = 1; offset <= wingBars; offset++) {
      const leftH = Number(sortedCandles[i - offset].high);
      const rightH = Number(sortedCandles[i + offset].high);
      if (h < leftH || h < rightH) {
        isHighPeak = false;
        break;
      }
      if (offset === 1 && (h > leftH || h > rightH)) {
        strictHighDiff = true;
      }
    }
    if (isHighPeak && strictHighDiff) {
      swingHighs.push({
        index: i,
        price: h,
        timestamp: sortedCandles[i].timestamp,
        isBroken: false
      });
    }

    let isLowValley = true;
    let strictLowDiff = false;
    for (let offset = 1; offset <= wingBars; offset++) {
      const leftL = Number(sortedCandles[i - offset].low);
      const rightL = Number(sortedCandles[i + offset].low);
      if (l > leftL || l > rightL) {
        isLowValley = false;
        break;
      }
      if (offset === 1 && (l < leftL || l < rightL)) {
        strictLowDiff = true;
      }
    }
    if (isLowValley && strictLowDiff) {
      swingLows.push({
        index: i,
        price: l,
        timestamp: sortedCandles[i].timestamp,
        isBroken: false
      });
    }
  }

  return { swingHighs, swingLows };
}

/**
 * Computes Exponential Moving Average series for closing prices.
 */
export function computeEmaSeries(values: number[], period: number): number[] {
  if (!values || values.length === 0 || period <= 0) return [];
  if (values.length < period) {
    // Graceful adaptive initialization if shorter history provided
    const k = 2 / (values.length + 1);
    const out: number[] = [values[0]];
    for (let i = 1; i < values.length; i++) {
      out.push(values[i] * k + out[i - 1] * (1 - k));
    }
    return out;
  }

  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) sum += values[i];
  let ema = sum / period;
  const result: number[] = new Array(period - 1).fill(ema);
  result.push(ema);

  for (let i = period; i < values.length; i++) {
    ema = values[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

/**
 * Computes Wilder 14-period RSI (0..100). Returns null if fewer than period + 1 closes.
 */
export function computeWilderRsi(closes: number[], period = 14): number | null {
  if (!closes || closes.length < 3) return null;
  const effectivePeriod = Math.min(period, closes.length - 1);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= effectivePeriod; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / effectivePeriod;
  let avgLoss = losses / effectivePeriod;

  for (let i = effectivePeriod + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (effectivePeriod - 1) + gain) / effectivePeriod;
    avgLoss = (avgLoss * (effectivePeriod - 1) + loss) / effectivePeriod;
  }

  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

/**
 * Computes MACD (fast=12, slow=26, signal=9) values at the latest candle and previous candle.
 */
export function computeMacd(
  closes: number[],
  fast = 12,
  slow = 26,
  signalPeriod = 9
): {
  macdLine: number;
  signalLine: number;
  histogram: number;
  prevMacdLine: number;
  prevSignalLine: number;
  prevHistogram: number;
} | null {
  if (!closes || closes.length < 8) return null;
  const fastSeries = computeEmaSeries(closes, Math.min(fast, Math.max(3, Math.floor(closes.length / 2))));
  const slowSeries = computeEmaSeries(closes, Math.min(slow, Math.max(5, closes.length - 2)));
  const macdSeries = closes.map((_, idx) => (fastSeries[idx] ?? 0) - (slowSeries[idx] ?? 0));
  const signalSeries = computeEmaSeries(macdSeries, Math.min(signalPeriod, Math.max(3, Math.floor(closes.length / 3))));

  const last = macdSeries.length - 1;
  const prev = Math.max(0, last - 1);

  return {
    macdLine: macdSeries[last],
    signalLine: signalSeries[last],
    histogram: macdSeries[last] - signalSeries[last],
    prevMacdLine: macdSeries[prev],
    prevSignalLine: signalSeries[prev],
    prevHistogram: macdSeries[prev] - signalSeries[prev]
  };
}
