import { defaultMarketDataService } from "./market-data-service.js";
import { extractMarketStructure } from "./market-structure-engine.js";
const htfTrendCache = /* @__PURE__ */ new Map();
const HTF_CACHE_TTL_MS = 15 * 60 * 1e3;
function calculateEma(values, period) {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const emaValues = [values[0]];
  for (let i = 1; i < values.length; i++) {
    const ema = values[i] * k + emaValues[i - 1] * (1 - k);
    emaValues.push(ema);
  }
  return emaValues;
}
function evaluateHtfCandles(candles, timeframe, source) {
  if (!candles || candles.length < 5) {
    return {
      trend: "SIDEWAYS",
      timeframe,
      allowedDirection: "BOTH",
      reason: "Insufficient higher timeframe candle data to determine definitive trend. Permitting independent zone discovery.",
      confidence: 50,
      structuralTrend: "SIDEWAYS",
      emaTrend: "SIDEWAYS",
      momentum: "NEUTRAL",
      trendConfidence: 50,
      currentPrice: 0,
      source
    };
  }
  const sorted = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const closes = sorted.map((c) => c.close);
  const currentPrice = closes[closes.length - 1];
  const ms = extractMarketStructure(sorted);
  const ema37Series = calculateEma(closes, Math.min(37, closes.length));
  const ema50Series = calculateEma(closes, Math.min(50, closes.length));
  const ema200Series = calculateEma(closes, Math.min(200, closes.length));
  const latestEma37 = ema37Series[ema37Series.length - 1];
  const latestEma50 = ema50Series[ema50Series.length - 1];
  const latestEma200 = ema200Series[ema200Series.length - 1];
  let emaTrend = "SIDEWAYS";
  if (latestEma37 && latestEma50) {
    if (currentPrice > latestEma37 && latestEma37 > latestEma50) {
      emaTrend = "BULLISH";
    } else if (currentPrice < latestEma37 && latestEma37 < latestEma50) {
      emaTrend = "BEARISH";
    }
  }
  const highs = ms.swingHighs || [];
  const lows = ms.swingLows || [];
  let structuralTrend = "SIDEWAYS";
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
      structuralTrend = "BULLISH";
    } else if (hasLowerLow && hasLowerHigh) {
      structuralTrend = "BEARISH";
    } else if (hasHigherHigh && hasLowerLow || hasLowerHigh && hasHigherLow) {
      structuralTrend = "TRANSITIONAL";
    } else {
      structuralTrend = "SIDEWAYS";
    }
  } else {
    structuralTrend = "SIDEWAYS";
  }
  const momentum = currentPrice > (closes[closes.length - 3] || currentPrice) ? "BULLISH" : currentPrice < (closes[closes.length - 3] || currentPrice) ? "BEARISH" : "NEUTRAL";
  let finalTrend = "SIDEWAYS";
  let allowedDirection = "BOTH";
  let trendConfidence = 65;
  if (structuralTrend === "BULLISH") {
    finalTrend = "BULLISH";
    allowedDirection = "BOTH";
    trendConfidence = emaTrend === "BULLISH" ? 85 : 70;
  } else if (structuralTrend === "BEARISH") {
    finalTrend = "BEARISH";
    allowedDirection = "BOTH";
    trendConfidence = emaTrend === "BEARISH" ? 85 : 70;
  } else if (structuralTrend === "TRANSITIONAL") {
    finalTrend = "SIDEWAYS";
    allowedDirection = "BOTH";
    trendConfidence = 60;
  } else {
    finalTrend = "SIDEWAYS";
    allowedDirection = "BOTH";
    trendConfidence = 50;
  }
  const reasonNotes = [
    `Structural Trend: ${structuralTrend}`,
    `EMA Trend: ${emaTrend}`,
    `Momentum: ${momentum}`
  ];
  if (highs.length >= 2 && lows.length >= 2) {
    reasonNotes.push(`Swings: HH=${hasHigherHigh}, HL=${hasHigherLow}, LH=${hasLowerHigh}, LL=${hasLowerLow}`);
  }
  const reason = `${timeframe} Structure evaluated as ${structuralTrend} (${reasonNotes.join(", ")})`;
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
async function resolveHigherTimeframeTrend(symbol, currentCandles, currentTimeframe = "M5", options) {
  const preferredHtf = options?.preferredHtf || "H4";
  const cacheKey = `${symbol.toUpperCase()}_${preferredHtf}`;
  const now = Date.now();
  if (!options?.forceRefresh && htfTrendCache.has(cacheKey)) {
    const cached = htfTrendCache.get(cacheKey);
    if (now - cached.timestamp < HTF_CACHE_TTL_MS) {
      return cached.result;
    }
  }
  const tfUpper = currentTimeframe.toUpperCase().trim();
  if (tfUpper === preferredHtf || tfUpper === "H4" || tfUpper === "D1" || tfUpper === "DAILY") {
    const result = evaluateHtfCandles(currentCandles, preferredHtf, "CURRENT_TIMEFRAME");
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
      const source = preferredHtf === "D1" ? "REMOTE_D1" : "REMOTE_H4";
      const result = evaluateHtfCandles(remoteRes.candles, preferredHtf, source);
      htfTrendCache.set(cacheKey, { result, timestamp: now });
      return result;
    }
  } catch (err) {
    console.warn(`[HTF TREND ENGINE] Failed to fetch remote ${preferredHtf} candles for ${symbol}:`, err);
  }
  const synthesized = evaluateHtfCandles(currentCandles, preferredHtf, "SYNTHESIZED");
  htfTrendCache.set(cacheKey, { result: synthesized, timestamp: now });
  return synthesized;
}
export {
  evaluateHtfCandles,
  resolveHigherTimeframeTrend
};
