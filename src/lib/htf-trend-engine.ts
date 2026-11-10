import { Candle } from './strategy-engine.js';
import { defaultMarketDataService } from './market-data-service.js';
import { extractMarketStructure, MarketStructure } from './market-structure-engine.js';

export type TrendDirection = 'BULLISH' | 'BEARISH' | 'SIDEWAYS';

export interface HtfTrendResult {
  trend: TrendDirection;
  timeframe: 'H4' | 'D1';
  allowedDirection: 'BUY' | 'SELL' | 'BOTH' | 'NONE';
  reason: string;
  confidence: number;
  structuralTrend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | 'TRANSITIONAL';
  emaTrend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  momentum: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  trendConfidence: number;
  ema37?: number;
  ema50?: number;
  ema200?: number;
  currentPrice: number;
  swingsSummary?: string;
  source: 'REMOTE_H4' | 'REMOTE_D1' | 'CURRENT_TIMEFRAME' | 'SYNTHESIZED';
  htfCandles?: Candle[];
  htfMarketStructure?: MarketStructure;
}

interface CachedHtfTrend {
  result: HtfTrendResult;
  timestamp: number;
}

const htfTrendCache = new Map<string, CachedHtfTrend>();
const HTF_CACHE_TTL_MS = 15 * 60 * 1000;

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
 * Analyzes market structure & indicators on HTF candles to evaluate dominant institutional trend
 * using confirmed chronological swing sequences (HH/HL vs LH/LL) and EMA alignment.
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
      allowedDirection: 'BOTH',
      reason: 'Insufficient higher timeframe candle data to determine definitive trend. Permitting independent zone discovery.',
      confidence: 50,
      structuralTrend: 'SIDEWAYS',
      emaTrend: 'SIDEWAYS',
      momentum: 'NEUTRAL',
      trendConfidence: 50,
      currentPrice: 0,
      source
    };
  }

  const sorted = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const closes = sorted.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  const ms: MarketStructure = extractMarketStructure(sorted);

  // Indicators: 37 EMA, 50 EMA, and 200 EMA
  const ema37Series = calculateEma(closes, Math.min(37, closes.length));
  const ema50Series = calculateEma(closes, Math.min(50, closes.length));
  const ema200Series = calculateEma(closes, Math.min(200, closes.length));

  const latestEma37 = ema37Series[ema37Series.length - 1];
  const latestEma50 = ema50Series[ema50Series.length - 1];
  const latestEma200 = ema200Series[ema200Series.length - 1];

  // EMA Trend Evaluation
  let emaTrend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' = 'SIDEWAYS';
  if (latestEma37 && latestEma50) {
    if (currentPrice > latestEma37 && latestEma37 > latestEma50) {
      emaTrend = 'BULLISH';
    } else if (currentPrice < latestEma37 && latestEma37 < latestEma50) {
      emaTrend = 'BEARISH';
    }
  }

  // Swing Structure Evaluation (Chronological Confirmed Swings: HH+HL vs LH+LL)
  const highs = ms.swingHighs || [];
  const lows = ms.swingLows || [];

  let structuralTrend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS' | 'TRANSITIONAL' = 'SIDEWAYS';
  let hasHigherHigh = false;
  let hasHigherLow = false;
  let hasLowerLow = false;
  let hasLowerHigh = false;

  if (highs.length >= 2 && lows.length >= 2) {
    const lastH = highs[highs.length - 1].price;
    const prevH = highs[highs.length - 2].price;
    const lastL = lows[lows.length - 1].price;
    const prevL = lows[lows.length - 2].price;

    hasHigherHigh = lastH > prevH;
    hasLowerHigh = lastH < prevH;
    hasHigherLow = lastL > prevL;
    hasLowerLow = lastL < prevL;

    if (hasHigherHigh && hasHigherLow) {
      structuralTrend = 'BULLISH';
    } else if (hasLowerLow && hasLowerHigh) {
      structuralTrend = 'BEARISH';
    } else if ((hasHigherHigh && hasLowerLow) || (hasLowerHigh && hasHigherLow)) {
      structuralTrend = 'TRANSITIONAL';
    } else {
      structuralTrend = 'SIDEWAYS';
    }
  } else {
    structuralTrend = 'SIDEWAYS';
  }

  // Momentum
  const momentum: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 
    currentPrice > (closes[closes.length - 3] || currentPrice) ? 'BULLISH' :
    currentPrice < (closes[closes.length - 3] || currentPrice) ? 'BEARISH' : 'NEUTRAL';

  // Final Trend & Allowed Direction Synthesis
  let finalTrend: TrendDirection = 'SIDEWAYS';
  let allowedDirection: 'BUY' | 'SELL' | 'BOTH' | 'NONE' = 'BOTH';
  let trendConfidence = 65;

  if (structuralTrend === 'BULLISH') {
    finalTrend = 'BULLISH';
    allowedDirection = 'BOTH';
    trendConfidence = emaTrend === 'BULLISH' ? 85 : 70;
  } else if (structuralTrend === 'BEARISH') {
    finalTrend = 'BEARISH';
    allowedDirection = 'BOTH';
    trendConfidence = emaTrend === 'BEARISH' ? 85 : 70;
  } else if (structuralTrend === 'TRANSITIONAL') {
    finalTrend = 'SIDEWAYS';
    allowedDirection = 'BOTH';
    trendConfidence = 60;
  } else {
    finalTrend = 'SIDEWAYS';
    allowedDirection = 'BOTH';
    trendConfidence = 50;
  }

  const reasonNotes: string[] = [
    `Structural Trend: ${structuralTrend}`,
    `EMA Trend: ${emaTrend}`,
    `Momentum: ${momentum}`
  ];
  if (highs.length >= 2 && lows.length >= 2) {
    reasonNotes.push(`Swings: HH=${hasHigherHigh}, HL=${hasHigherLow}, LH=${hasLowerHigh}, LL=${hasLowerLow}`);
  }

  const reason = `${timeframe} Structure evaluated as ${structuralTrend} (${reasonNotes.join(', ')})`;

  return {
    trend: finalTrend,
    timeframe,
    allowedDirection,
    reason,
    confidence: trendConfidence,
    structuralTrend,
    emaTrend,
    momentum,
    trendConfidence,
    ema37: latestEma37,
    ema50: latestEma50,
    ema200: latestEma200,
    currentPrice,
    swingsSummary: `${highs.length} swing highs, ${lows.length} swing lows on ${timeframe}`,
    source,
    htfCandles: sorted,
    htfMarketStructure: ms
  };
}

export async function resolveHigherTimeframeTrend(
  symbol: string,
  currentCandles: Candle[],
  currentTimeframe: string = 'M5',
  options?: { preferredHtf?: 'H4' | 'D1'; forceRefresh?: boolean }
): Promise<HtfTrendResult> {
  const preferredHtf: 'H4' | 'D1' = options?.preferredHtf || 'H4';
  const cacheKey = `${symbol.toUpperCase()}_${preferredHtf}`;
  const now = Date.now();

  if (!options?.forceRefresh && htfTrendCache.has(cacheKey)) {
    const cached = htfTrendCache.get(cacheKey)!;
    if (now - cached.timestamp < HTF_CACHE_TTL_MS) {
      return cached.result;
    }
  }

  const tfUpper = currentTimeframe.toUpperCase().trim();
  if (tfUpper === preferredHtf || tfUpper === 'H4' || tfUpper === 'D1' || tfUpper === 'DAILY') {
    const result = evaluateHtfCandles(currentCandles, preferredHtf, 'CURRENT_TIMEFRAME');
    htfTrendCache.set(cacheKey, { result, timestamp: now });
    return result;
  }

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

  const synthesized = evaluateHtfCandles(currentCandles, preferredHtf, 'SYNTHESIZED');
  htfTrendCache.set(cacheKey, { result: synthesized, timestamp: now });
  return synthesized;
}
