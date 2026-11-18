import { defaultMarketDataService } from "./market-data-service.js";
import { extractMarketStructure } from "./market-structure-engine.js";
const htfTrendCache = /* @__PURE__ */ new Map();
const HTF_CACHE_TTL_MS = 5 * 60 * 1e3;
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
function extractMajorSwings(sorted, atr) {
  if (sorted.length < 6) {
    return { majorHighs: [], majorLows: [] };
  }
  const lastPrice = sorted[sorted.length - 1].close || 1;
  const threshold = Math.max(atr * 1.15, lastPrice * 2e-3);
  let mode = "UNKNOWN";
  let candidateHighIdx = 0;
  let candidateHighPrice = sorted[0].high;
  let candidateLowIdx = 0;
  let candidateLowPrice = sorted[0].low;
  const pivots = [];
  for (let i = 1; i < sorted.length; i++) {
    const h = sorted[i].high;
    const l = sorted[i].low;
    if (mode === "UNKNOWN") {
      if (h > candidateHighPrice) {
        candidateHighPrice = h;
        candidateHighIdx = i;
      }
      if (l < candidateLowPrice) {
        candidateLowPrice = l;
        candidateLowIdx = i;
      }
      if (candidateHighPrice - candidateLowPrice >= threshold) {
        if (candidateHighIdx < candidateLowIdx) {
          pivots.push({ index: candidateHighIdx, price: candidateHighPrice, type: "HIGH", isBroken: false });
          mode = "DOWN";
          candidateLowIdx = i;
          candidateLowPrice = l;
        } else {
          pivots.push({ index: candidateLowIdx, price: candidateLowPrice, type: "LOW", isBroken: false });
          mode = "UP";
          candidateHighIdx = i;
          candidateHighPrice = h;
        }
      }
    } else if (mode === "UP") {
      if (h >= candidateHighPrice) {
        candidateHighPrice = h;
        candidateHighIdx = i;
      } else if (candidateHighPrice - l >= threshold) {
        pivots.push({ index: candidateHighIdx, price: candidateHighPrice, type: "HIGH", isBroken: false });
        mode = "DOWN";
        candidateLowIdx = i;
        candidateLowPrice = l;
      }
    } else {
      if (l <= candidateLowPrice) {
        candidateLowPrice = l;
        candidateLowIdx = i;
      } else if (h - candidateLowPrice >= threshold) {
        pivots.push({ index: candidateLowIdx, price: candidateLowPrice, type: "LOW", isBroken: false });
        mode = "UP";
        candidateHighIdx = i;
        candidateHighPrice = h;
      }
    }
  }
  for (const pivot of pivots) {
    for (let j = pivot.index + 1; j < sorted.length; j++) {
      if (pivot.type === "HIGH" && sorted[j].close > pivot.price) {
        pivot.isBroken = true;
        break;
      }
      if (pivot.type === "LOW" && sorted[j].close < pivot.price) {
        pivot.isBroken = true;
        break;
      }
    }
  }
  return {
    majorHighs: pivots.filter((p) => p.type === "HIGH"),
    majorLows: pivots.filter((p) => p.type === "LOW")
  };
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
  const latestClosedClose = closes[closes.length - 2] ?? currentPrice;
  const ms = extractMarketStructure(sorted);
  const atr = ms.volatilityInformation?.atr || 0;
  const emaFastPeriod = closes.length >= 50 ? 37 : Math.max(8, Math.floor(closes.length * 0.45));
  const emaSlowPeriod = closes.length >= 50 ? 50 : Math.max(emaFastPeriod + 5, Math.floor(closes.length * 0.75));
  const ema37Series = calculateEma(closes, Math.min(emaFastPeriod, closes.length));
  const ema50Series = calculateEma(closes, Math.min(emaSlowPeriod, closes.length));
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
  const momentum = currentPrice > (closes[closes.length - 3] || currentPrice) ? "BULLISH" : currentPrice < (closes[closes.length - 3] || currentPrice) ? "BEARISH" : "NEUTRAL";
  const fractalHighs = ms.swingHighs || [];
  const fractalLows = ms.swingLows || [];
  const { majorHighs, majorLows } = extractMajorSwings(sorted, atr);
  const hasMacroStructure = majorHighs.length >= 2 && majorLows.length >= 2 || majorLows.length >= 2 && majorHighs.length >= 1 || majorHighs.length >= 2 && majorLows.length >= 1;
  const evalHighs = hasMacroStructure ? majorHighs : fractalHighs;
  const evalLows = hasMacroStructure ? majorLows : fractalLows;
  let structuralTrend = "SIDEWAYS";
  let hasHigherHigh = false;
  let hasHigherLow = false;
  let hasLowerLow = false;
  let hasLowerHigh = false;
  let structureNote = "";
  if (evalHighs.length >= 2 && evalLows.length >= 2) {
    const lastHighObj = evalHighs[evalHighs.length - 1];
    const prevHighObj = evalHighs[evalHighs.length - 2];
    const lastLowObj = evalLows[evalLows.length - 1];
    const prevLowObj = evalLows[evalLows.length - 2];
    const lastH = lastHighObj.price;
    const prevH = prevHighObj.price;
    const lastL = lastLowObj.price;
    const prevL = prevLowObj.price;
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
    const latestAnchorIdx = Math.max(lastHighObj.index, lastLowObj.index);
    const hasRecentBearishBreak = (ms.BOS || []).some((b) => b.type === "BEARISH_BOS" && b.candleIndex > latestAnchorIdx) || (ms.CHOCH || []).some((c) => c.type === "BEARISH_CHOCH" && c.candleIndex >= lastLowObj.index);
    const hasRecentBullishBreak = (ms.BOS || []).some((b) => b.type === "BULLISH_BOS" && b.candleIndex > latestAnchorIdx) || (ms.CHOCH || []).some((c) => c.type === "BULLISH_CHOCH" && c.candleIndex >= lastHighObj.index);
    if (structuralTrend === "BULLISH") {
      const protectedLowBroken = lastLowObj.isBroken || currentPrice < lastL || latestClosedClose < lastL || hasRecentBearishBreak;
      const brokePriorLowToo = prevLowObj.isBroken || currentPrice < prevL || latestClosedClose < prevL;
      const macroIsBearish = majorHighs.length >= 2 && majorLows.length >= 2 && majorHighs[majorHighs.length - 1].price < majorHighs[majorHighs.length - 2].price && (majorLows[majorLows.length - 1].price < majorLows[majorLows.length - 2].price || currentPrice < majorLows[majorLows.length - 1].price);
      if (protectedLowBroken) {
        if (brokePriorLowToo || emaTrend === "BEARISH" && momentum === "BEARISH" || macroIsBearish) {
          structuralTrend = "BEARISH";
          hasLowerLow = true;
          hasHigherHigh = false;
          hasHigherLow = false;
          structureNote = ", Protected HL broken -> Bearish reversal";
        } else {
          structuralTrend = "TRANSITIONAL";
          hasHigherLow = false;
          structureNote = ", Protected HL broken -> Transitional";
        }
      } else if (emaTrend === "BEARISH" && momentum === "BEARISH" && currentPrice < lastH) {
        if (macroIsBearish) {
          structuralTrend = "BEARISH";
          hasLowerLow = true;
          hasLowerHigh = true;
          hasHigherHigh = false;
          hasHigherLow = false;
          structureNote = ", Macro LH/LL + EMA/Momentum bearish";
        } else {
          structuralTrend = "TRANSITIONAL";
          structureNote = ", Bullish swings conflict with Bearish EMA & Momentum";
        }
      }
    } else if (structuralTrend === "BEARISH") {
      const protectedHighBroken = lastHighObj.isBroken || currentPrice > lastH || latestClosedClose > lastH || hasRecentBullishBreak;
      const brokePriorHighToo = prevHighObj.isBroken || currentPrice > prevH || latestClosedClose > prevH;
      const macroIsBullish = majorHighs.length >= 2 && majorLows.length >= 2 && majorLows[majorLows.length - 1].price > majorLows[majorLows.length - 2].price && (majorHighs[majorHighs.length - 1].price > majorHighs[majorHighs.length - 2].price || currentPrice > majorHighs[majorHighs.length - 1].price);
      if (protectedHighBroken) {
        if (brokePriorHighToo || emaTrend === "BULLISH" && momentum === "BULLISH" || macroIsBullish) {
          structuralTrend = "BULLISH";
          hasHigherHigh = true;
          hasLowerLow = false;
          hasLowerHigh = false;
          structureNote = ", Protected LH broken -> Bullish reversal";
        } else {
          structuralTrend = "TRANSITIONAL";
          hasLowerHigh = false;
          structureNote = ", Protected LH broken -> Transitional";
        }
      } else if (emaTrend === "BULLISH" && momentum === "BULLISH" && currentPrice > lastL) {
        if (macroIsBullish) {
          structuralTrend = "BULLISH";
          hasHigherHigh = true;
          hasHigherLow = true;
          hasLowerLow = false;
          hasLowerHigh = false;
          structureNote = ", Macro HH/HL + EMA/Momentum bullish";
        } else {
          structuralTrend = "TRANSITIONAL";
          structureNote = ", Bearish swings conflict with Bullish EMA & Momentum";
        }
      }
    } else if (structuralTrend === "TRANSITIONAL" || structuralTrend === "SIDEWAYS") {
      if (currentPrice < lastL && currentPrice < prevL && emaTrend === "BEARISH") {
        structuralTrend = "BEARISH";
        hasLowerLow = true;
        structureNote = ", Active breakdown below swing lows + EMA bearish";
      } else if (currentPrice > lastH && currentPrice > prevH && emaTrend === "BULLISH") {
        structuralTrend = "BULLISH";
        hasHigherHigh = true;
        structureNote = ", Active breakout above swing highs + EMA bullish";
      }
    }
  } else if (evalLows.length >= 2 && evalHighs.length >= 1) {
    const lastHighObj = evalHighs[evalHighs.length - 1];
    const lastLowObj = evalLows[evalLows.length - 1];
    const prevLowObj = evalLows[evalLows.length - 2];
    hasHigherLow = lastLowObj.price > prevLowObj.price;
    hasLowerLow = lastLowObj.price < prevLowObj.price;
    if (hasHigherLow && !lastLowObj.isBroken && (currentPrice > lastHighObj.price || latestClosedClose > lastHighObj.price || lastHighObj.isBroken)) {
      structuralTrend = "BULLISH";
      hasHigherHigh = true;
      structureNote = ", Active HH + BOS above swing high holding HL";
    } else if (currentPrice < lastLowObj.price && currentPrice < prevLowObj.price && emaTrend === "BEARISH") {
      structuralTrend = "BEARISH";
      hasLowerLow = true;
      structureNote = ", Breakdown below both swing lows";
    }
  } else if (evalHighs.length >= 2 && evalLows.length >= 1) {
    const lastHighObj = evalHighs[evalHighs.length - 1];
    const prevHighObj = evalHighs[evalHighs.length - 2];
    const lastLowObj = evalLows[evalLows.length - 1];
    hasLowerHigh = lastHighObj.price < prevHighObj.price;
    hasHigherHigh = lastHighObj.price > prevHighObj.price;
    if (hasLowerHigh && !lastHighObj.isBroken && (currentPrice < lastLowObj.price || latestClosedClose < lastLowObj.price || lastLowObj.isBroken)) {
      structuralTrend = "BEARISH";
      hasLowerLow = true;
      structureNote = ", Active LL + BOS below swing low holding LH";
    } else if (currentPrice > lastHighObj.price && currentPrice > prevHighObj.price && emaTrend === "BULLISH") {
      structuralTrend = "BULLISH";
      hasHigherHigh = true;
      structureNote = ", Breakout above both swing highs";
    }
  } else if (evalLows.length >= 1 && evalHighs.length >= 1) {
    const lastL = evalLows[evalLows.length - 1].price;
    const lastH = evalHighs[evalHighs.length - 1].price;
    if (currentPrice < lastL && emaTrend === "BEARISH" && momentum === "BEARISH") {
      structuralTrend = "BEARISH";
      hasLowerLow = true;
      structureNote = ", Monotonic breakdown below swing low";
    } else if (currentPrice > lastH && emaTrend === "BULLISH" && momentum === "BULLISH") {
      structuralTrend = "BULLISH";
      hasHigherHigh = true;
      structureNote = ", Monotonic breakout above swing high";
    }
  }
  let finalTrend = "SIDEWAYS";
  let allowedDirection = "BOTH";
  let trendConfidence = 65;
  if (structuralTrend === "BULLISH") {
    finalTrend = "BULLISH";
    allowedDirection = "BUY";
    trendConfidence = emaTrend === "BULLISH" ? 85 : 70;
  } else if (structuralTrend === "BEARISH") {
    finalTrend = "BEARISH";
    allowedDirection = "SELL";
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
  if (evalHighs.length >= 2 && evalLows.length >= 2 || structureNote) {
    reasonNotes.push(`Swings${hasMacroStructure ? "(Macro)" : ""}: HH=${hasHigherHigh}, HL=${hasHigherLow}, LH=${hasLowerHigh}, LL=${hasLowerLow}${structureNote}`);
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
    swingsSummary: `${evalHighs.length} swing highs, ${evalLows.length} swing lows on ${timeframe}`,
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
      requiredCount: 100,
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
