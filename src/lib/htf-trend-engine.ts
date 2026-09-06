import { Candle } from './strategy-engine.js';
import { defaultMarketDataService } from './market-data-service.js';
import { extractMarketStructure, MarketStructure } from './market-structure-engine.js';

export type TrendDirection = 'BULLISH' | 'BEARISH' | 'SIDEWAYS';

export interface HtfTrendResult {
  trend: TrendDirection;
  timeframe: 'H4' | 'D1';
  allowedDirection: 'BUY' | 'SELL' | 'NONE';
  reason: string;
  confidence: number;
  ema50?: number;
  ema200?: number;
  currentPrice: number;
  swingsSummary?: string;
  source: 'REMOTE_H4' | 'REMOTE_D1' | 'CURRENT_TIMEFRAME' | 'SYNTHESIZED';
}

interface CachedHtfTrend {
  result: HtfTrendResult;
  timestamp: number;
}

// In-memory cache for HTF trend results (TTL 15 minutes = 900,000ms)
const htfTrendCache = new Map<string, CachedHtfTrend>();
const HTF_CACHE_TTL_MS = 15 * 60 * 1000;

/**
 * Calculates exponential moving average (EMA)
 */
function calculateEma(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const emaValues: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    const ema = values[i] * k + emaValues[i - 1] * (1 - k);
    emaValues.push(ema);
  }
  return emaValues;
}

/**
 * Analyzes market structure & indicators on HTF candles to evaluate dominant institutional trend.
 */
export function evaluateHtfCandles(
  candles: Candle[],
  timeframe: 'H4' | 'D1',
  source: 'REMOTE_H4' | 'REMOTE_D1' | 'CURRENT_TIMEFRAME' | 'SYNTHESIZED'
): HtfTrendResult {
  if (!candles || candles.length < 5) {
    return {
      trend: 'SIDEWAYS',
      timeframe,
      allowedDirection: 'NONE',
      reason: 'Insufficient higher timeframe candle data to determine clear trend. Defaulting to NO TRADE.',
      confidence: 0,
      currentPrice: 0,
      source
    };
  }

  const sorted = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const closes = sorted.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  const ms: MarketStructure = extractMarketStructure(sorted);

  // Indicators: 50 EMA and 200 EMA (or 20/50 if fewer candles)
  const ema50Period = Math.min(50, Math.max(10, Math.floor(closes.length * 0.75)));
  const ema200Period = Math.min(200, closes.length);

  const ema50Series = calculateEma(closes, ema50Period);
  const ema200Series = calculateEma(closes, ema200Period);

  const latestEma50 = ema50Series[ema50Series.length - 1];
  const latestEma200 = ema200Series[ema200Series.length - 1];

  let bullishScore = 0;
  let bearishScore = 0;
  const reasonNotes: string[] = [];

  // 1. Price vs EMA
  if (latestEma50 && latestEma200) {
    if (currentPrice > latestEma50 && latestEma50 > latestEma200) {
      bullishScore += 3;
      reasonNotes.push(`Price (${currentPrice.toFixed(2)}) above ${ema50Period}/${ema200Period} EMA alignment`);
    } else if (currentPrice < latestEma50 && latestEma50 < latestEma200) {
      bearishScore += 3;
      reasonNotes.push(`Price (${currentPrice.toFixed(2)}) below ${ema50Period}/${ema200Period} EMA alignment`);
    } else if (currentPrice > latestEma50) {
      bullishScore += 1.5;
      reasonNotes.push(`Price above ${ema50Period} EMA`);
    } else if (currentPrice < latestEma50) {
      bearishScore += 1.5;
      reasonNotes.push(`Price below ${ema50Period} EMA`);
    }
  }

  // 2. Swing Highs & Swing Lows Progression (Higher Highs / Higher Lows vs Lower Highs / Lower Lows)
  const highs = ms.swingHighs || [];
  const lows = ms.swingLows || [];

  if (lows.length >= 2) {
    const lastLow = lows[lows.length - 1].price;
    const prevLow = lows[lows.length - 2].price;
    if (lastLow > prevLow) {
      bullishScore += 2.5;
      reasonNotes.push(`Higher Low formed (${prevLow.toFixed(2)} -> ${lastLow.toFixed(2)})`);
    } else if (lastLow < prevLow) {
      bearishScore += 2.5;
      reasonNotes.push(`Lower Low formed (${prevLow.toFixed(2)} -> ${lastLow.toFixed(2)})`);
    }
  }

  if (highs.length >= 2) {
    const lastHigh = highs[highs.length - 1].price;
    const prevHigh = highs[highs.length - 2].price;
    if (lastHigh > prevHigh) {
      bullishScore += 2.0;
      reasonNotes.push(`Higher High formed (${prevHigh.toFixed(2)} -> ${lastHigh.toFixed(2)})`);
    } else if (lastHigh < prevHigh) {
      bearishScore += 2.0;
      reasonNotes.push(`Lower High formed (${prevHigh.toFixed(2)} -> ${lastHigh.toFixed(2)})`);
    }
  }

  // 3. Break of Structure (BOS)
  if (ms.BOS && ms.BOS.length > 0) {
    const recentBOS = ms.BOS.slice(-2);
    const hasBullishBOS = recentBOS.some(b => b.type === 'BULLISH_BOS');
    const hasBearishBOS = recentBOS.some(b => b.type === 'BEARISH_BOS');
    if (hasBullishBOS && !hasBearishBOS) {
      bullishScore += 2.5;
      reasonNotes.push('Recent Bullish BOS');
    } else if (hasBearishBOS && !hasBullishBOS) {
      bearishScore += 2.5;
      reasonNotes.push('Recent Bearish BOS');
    }
  }

  // Final trend determination
  let trend: TrendDirection = 'SIDEWAYS';
  let allowedDirection: 'BUY' | 'SELL' | 'NONE' = 'NONE';
  let confidence = 50;

  // Strict trend threshold: require decisive directional bias and confidence
  if (bullishScore >= bearishScore + 2.0 && bullishScore >= 4.0) {
    trend = 'BULLISH';
    allowedDirection = 'BUY';
    confidence = Math.min(95, Math.round(65 + bullishScore * 4));
  } else if (bearishScore >= bullishScore + 2.0 && bearishScore >= 4.0) {
    trend = 'BEARISH';
    allowedDirection = 'SELL';
    confidence = Math.min(95, Math.round(65 + bearishScore * 4));
  } else {
    // Trend is sideways, consolidating, or unclear: default to NO TRADE!
    trend = 'SIDEWAYS';
    allowedDirection = 'NONE';
    confidence = 45;
  }

  const swingsSummary = `${highs.length} swing highs, ${lows.length} swing lows on ${timeframe}`;
  const reason = trend === 'SIDEWAYS'
    ? `${timeframe} Trend is SIDEWAYS / unclear (${reasonNotes.join(', ') || 'Mixed structural momentum / consolidation'}). Defaulting to NO TRADE.`
    : `${timeframe} Trend is ${trend}: ${reasonNotes.join(', ') || 'Aligned institutional signals'}.`;

  return {
    trend,
    timeframe,
    allowedDirection,
    reason,
    confidence,
    ema50: latestEma50,
    ema200: latestEma200,
    currentPrice,
    swingsSummary,
    source
  };
}

/**
 * Resolves the Higher Timeframe (4hr or 1day) trend for any given pair.
 * Checks in-memory cache first to avoid repeating remote API calls.
 */
export async function resolveHigherTimeframeTrend(
  symbol: string,
  currentCandles: Candle[],
  currentTimeframe: string = 'M5',
  options?: { preferredHtf?: 'H4' | 'D1'; forceRefresh?: boolean }
): Promise<HtfTrendResult> {
  const preferredHtf: 'H4' | 'D1' = options?.preferredHtf || 'H4';
  const cacheKey = `${symbol.toUpperCase()}_${preferredHtf}`;
  const now = Date.now();

  // 1. Check in-memory cache
  if (!options?.forceRefresh && htfTrendCache.has(cacheKey)) {
    const cached = htfTrendCache.get(cacheKey)!;
    if (now - cached.timestamp < HTF_CACHE_TTL_MS) {
      return cached.result;
    }
  }

  const tfUpper = currentTimeframe.toUpperCase().trim();

  // 2. If current timeframe is ALREADY H4 or D1, evaluate directly
  if (tfUpper === preferredHtf || tfUpper === 'H4' || tfUpper === 'D1' || tfUpper === 'DAILY') {
    const result = evaluateHtfCandles(currentCandles, preferredHtf, 'CURRENT_TIMEFRAME');
    htfTrendCache.set(cacheKey, { result, timestamp: now });
    return result;
  }

  // 3. Attempt fetching real H4 / D1 candles via defaultMarketDataService
  try {
    const remoteRes = await defaultMarketDataService.getMarketData({
      symbol,
      timeframe: preferredHtf,
      requiredCount: 50,
      purpose: `HTF ${preferredHtf} Trend Alignment`
    });

    if (remoteRes.isValid && remoteRes.candles && remoteRes.candles.length >= 10) {
      const source = preferredHtf === 'D1' ? 'REMOTE_D1' : 'REMOTE_H4';
      const result = evaluateHtfCandles(remoteRes.candles, preferredHtf, source);
      htfTrendCache.set(cacheKey, { result, timestamp: now });
      return result;
    }
  } catch (err) {
    console.warn(`[HTF TREND ENGINE] Failed to fetch remote ${preferredHtf} candles for ${symbol}:`, err);
  }

  // 4. Fallback: Synthesize HTF trend from available current candles
  const synthesized = evaluateHtfCandles(currentCandles, preferredHtf, 'SYNTHESIZED');
  htfTrendCache.set(cacheKey, { result: synthesized, timestamp: now });
  return synthesized;
}
