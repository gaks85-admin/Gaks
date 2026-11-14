import { extractMarketStructure } from "./market-structure-engine.js";
const watcherRejectedZonesMap = globalThis.__watcherRejectedZonesMap || /* @__PURE__ */ new Map();
globalThis.__watcherRejectedZonesMap = watcherRejectedZonesMap;
function recordRejectedZone(watcherId, zone, reason) {
  if (!watcherId || !zone) return;
  const existing = watcherRejectedZonesMap.get(watcherId) || [];
  const now = Date.now();
  const pruned = existing.filter((r) => now - r.rejectedAt < 4 * 60 * 60 * 1e3);
  pruned.push({
    low: zone.low,
    high: zone.high,
    direction: zone.direction,
    rejectedAt: now,
    reason
  });
  watcherRejectedZonesMap.set(watcherId, pruned);
  console.log(`[ZONE REJECTION REGISTRY] Watcher ${watcherId}: Registered rejected zone [${zone.low} - ${zone.high}] (${zone.direction}). Total active rejected levels: ${pruned.length}. Reason: ${reason}`);
}
function getRejectedZones(watcherId) {
  if (!watcherId) return [];
  const existing = watcherRejectedZonesMap.get(watcherId) || [];
  const now = Date.now();
  const pruned = existing.filter((r) => now - r.rejectedAt < 4 * 60 * 60 * 1e3);
  if (pruned.length !== existing.length) {
    watcherRejectedZonesMap.set(watcherId, pruned);
  }
  return pruned;
}
function clearRejectedZones(watcherId) {
  if (watcherId) watcherRejectedZonesMap.delete(watcherId);
}
function generateZoneId(pair, type, direction) {
  const cleanPair = (pair || "ZONE").replace(/[^a-zA-Z0-9]/g, "");
  const timestamp = Date.now().toString(36);
  const randomSuffix = Math.random().toString(36).substring(2, 6);
  return `zone_${cleanPair}_${direction.toLowerCase()}_${timestamp}_${randomSuffix}`;
}
function calculateBuffer(candles, currentPrice, pair) {
  const sym = (pair || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const isGold = sym.includes("XAU") || sym.includes("GOLD");
  const isSilver = sym.includes("XAG") || sym.includes("SILVER");
  const isJpy = sym.includes("JPY");
  const isIndex = sym.includes("NAS") || sym.includes("NDX") || sym.includes("US100") || sym.includes("US30") || sym.includes("DOW") || sym.includes("SPX") || sym.includes("SP500") || sym.includes("US500") || sym.includes("US2000") || sym.includes("GER") || sym.includes("DE30") || sym.includes("DE40") || sym.includes("UK100") || sym.includes("JP225") || sym.includes("HK50") || sym.includes("INDEX");
  const isCrypto = sym.includes("BTC") || sym.includes("ETH") || sym.includes("SOL") || sym.includes("XRP") || sym.includes("LTC") || sym.includes("ADA") || sym.includes("DOGE") || sym.includes("BNB") || sym.includes("AVAX") || sym.includes("DOT") || sym.includes("LINK") || sym.includes("MATIC") || sym.includes("UNI") || sym.includes("ATOM") || sym.includes("TON") || sym.includes("SUI") || sym.includes("NEAR") || sym.includes("TRX") || sym.endsWith("USDT") || sym.endsWith("USDC") || sym.endsWith("BUSD") || sym.includes("CRYPTO");
  const isForex = !isGold && !isSilver && !isIndex && !isCrypto && !isJpy && currentPrice < 50;
  let atr = currentPrice * (isForex ? 2e-3 : 3e-3);
  if (candles && candles.length >= 2) {
    let totalTr = 0;
    for (let i = 1; i < candles.length; i++) {
      const high = candles[i].high;
      const low = candles[i].low;
      const prevClose = candles[i - 1].close;
      const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
      totalTr += tr;
    }
    atr = totalTr / (candles.length - 1);
  }
  let buffer;
  if (isGold) {
    buffer = Math.min(Math.max(atr * 0.15, 0.4), 2.5);
  } else if (isSilver) {
    buffer = Math.min(Math.max(atr * 0.15, 0.03), 0.25);
  } else if (isIndex) {
    buffer = Math.min(Math.max(atr * 0.15, 2), 15);
  } else if (isJpy) {
    buffer = Math.min(Math.max(atr * 0.15, 0.02), 0.06);
  } else if (isForex) {
    buffer = Math.min(Math.max(atr * 0.15, 15e-5), 3e-4);
  } else {
    buffer = Math.min(Math.max(atr * 0.15, currentPrice * 5e-4), currentPrice * 3e-3);
  }
  return { atr, buffer };
}
function identifyCandidateZones(candles, marketStructure, compiledStrategy, currentPrice, rejectedZones) {
  if (!candles || candles.length < 2) return [];
  const sortedCandles = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const latestCandle = sortedCandles[sortedCandles.length - 1];
  const activePrice = currentPrice && currentPrice > 0 ? currentPrice : latestCandle.close;
  const trend = marketStructure?.trend || "SIDEWAYS";
  const pair = marketStructure?.pair || "MARKET";
  const { atr, buffer } = calculateBuffer(sortedCandles, activePrice, pair);
  const rules = compiledStrategy?.compiled_rules;
  const hasOrderBlockPreference = !!(rules?.order_block || rules?.supply_demand || rules?.unmitigated_zone);
  const hasFvgPreference = !!rules?.fair_value_gap;
  const hasSrPreference = !!(rules?.support || rules?.resistance || rules?.support_rejection || rules?.resistance_rejection);
  const hasLiquidityPreference = !!rules?.liquidity_sweep;
  const isStrategyFiltered = hasOrderBlockPreference || hasFvgPreference || hasSrPreference || hasLiquidityPreference;
  const allowFvg = isStrategyFiltered ? hasFvgPreference : true;
  const allowOrderBlocks = isStrategyFiltered ? hasOrderBlockPreference : true;
  const allowLiquidity = isStrategyFiltered ? hasLiquidityPreference : true;
  const allowSr = isStrategyFiltered ? hasSrPreference : true;
  const enforceUnmitigated = rules?.unmitigated_zone !== false;
  const candidateZones = [];
  if (allowFvg && marketStructure?.fairValueGaps && marketStructure.fairValueGaps.length > 0) {
    for (const fvg of marketStructure.fairValueGaps) {
      if (fvg.isFilled) continue;
      if (fvg.candleIndex !== void 0 && fvg.candleIndex < sortedCandles.length - 45) continue;
      if (fvg.filledPercentage !== void 0 && fvg.filledPercentage > 0.2) continue;
      if (fvg.type === "BULLISH_FVG" && fvg.bottom <= activePrice) {
        if (fvg.candleIndex !== void 0) {
          let gapMitigated = false;
          for (let k = fvg.candleIndex + 1; k < sortedCandles.length; k++) {
            if (sortedCandles[k].low <= fvg.top) {
              gapMitigated = true;
              break;
            }
          }
          if (gapMitigated) continue;
        }
        const low = Number(fvg.bottom.toFixed(5));
        const high = Number(fvg.top.toFixed(5));
        const invalidation = Number((low - buffer).toFixed(5));
        const distanceRatio = Math.abs(activePrice - high) / activePrice;
        const proximityScore = Math.max(0, 100 - distanceRatio * 1e3);
        const strength = Math.round(proximityScore * (trend === "BULLISH" ? 1 : 0.8));
        candidateZones.push({
          id: generateZoneId(pair, "BULLISH_FVG", "BUY"),
          type: "BULLISH_FVG",
          direction: "BUY",
          high,
          low,
          invalidationLevel: invalidation,
          strength,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          createdCandleTime: String(latestCandle.timestamp),
          tappedAt: null,
          tapCount: 0,
          status: "WAITING_FOR_TAP",
          timeframe: marketStructure?.timeframe || "M5",
          originCandle: String(latestCandle.timestamp),
          evidence: [`Bullish Fair Value Gap [${low} - ${high}]`],
          reasoning: `Fresh Unmitigated Bullish Fair Value Gap [${low} - ${high}].`,
          candleIndex: fvg.candleIndex
        });
      } else if (fvg.type === "BEARISH_FVG" && fvg.top >= activePrice) {
        if (fvg.candleIndex !== void 0) {
          let gapMitigated = false;
          for (let k = fvg.candleIndex + 1; k < sortedCandles.length; k++) {
            if (sortedCandles[k].high >= fvg.bottom) {
              gapMitigated = true;
              break;
            }
          }
          if (gapMitigated) continue;
        }
        const low = Number(fvg.bottom.toFixed(5));
        const high = Number(fvg.top.toFixed(5));
        const invalidation = Number((high + buffer).toFixed(5));
        const distanceRatio = Math.abs(low - activePrice) / activePrice;
        const proximityScore = Math.max(0, 100 - distanceRatio * 1e3);
        const strength = Math.round(proximityScore * (trend === "BEARISH" ? 1 : 0.8));
        candidateZones.push({
          id: generateZoneId(pair, "BEARISH_FVG", "SELL"),
          type: "BEARISH_FVG",
          direction: "SELL",
          high,
          low,
          invalidationLevel: invalidation,
          strength,
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          createdCandleTime: String(latestCandle.timestamp),
          tappedAt: null,
          tapCount: 0,
          status: "WAITING_FOR_TAP",
          timeframe: marketStructure?.timeframe || "M5",
          originCandle: String(latestCandle.timestamp),
          evidence: [`Bearish Fair Value Gap [${low} - ${high}]`],
          reasoning: `Fresh Unmitigated Bearish Fair Value Gap [${low} - ${high}].`,
          candleIndex: fvg.candleIndex
        });
      }
    }
  }
  if (allowOrderBlocks) {
    for (let i = sortedCandles.length - 2; i >= Math.max(0, sortedCandles.length - 120); i--) {
      const c = sortedCandles[i];
      const body = Math.abs(c.close - c.open);
      const zoneHeight = c.high - c.low;
      const minZoneHeight = Math.max(atr * 0.04, 1e-5);
      const isDownCandle = c.close <= c.open || c.close > c.open && body <= atr * 0.25;
      const isSwingLow = (marketStructure?.swingLows || []).some(
        (sl) => Math.abs(sl.index - i) <= 2 || c.low <= sl.price && Math.abs(sl.index - i) <= 5
      );
      let isLocalValley = true;
      for (let w = Math.max(0, i - 3); w <= Math.min(sortedCandles.length - 1, i + 3); w++) {
        if (sortedCandles[w].low < c.low) {
          isLocalValley = false;
          break;
        }
      }
      const isOriginLow = isSwingLow || isLocalValley;
      const isLowerWickRejection = zoneHeight > 0 && (Math.min(c.open, c.close) - c.low) / zoneHeight >= 0.25;
      const qualifiesDemand = isDownCandle || isOriginLow || isLowerWickRejection;
      if (qualifiesDemand && zoneHeight >= minZoneHeight) {
        const obLow = Number(c.low.toFixed(5));
        let obHigh = Number(Math.max(c.open, c.close).toFixed(5));
        if (obHigh - obLow < minZoneHeight) {
          obHigh = Number(Math.min(c.high, obLow + minZoneHeight).toFixed(5));
        }
        if (obHigh <= obLow) {
          obHigh = Number(c.high.toFixed(5));
        }
        let displacementIdx = -1;
        let hasStructuralBreak = false;
        let highestHigh = obHigh;
        for (let d = i + 1; d < Math.min(sortedCandles.length, i + 15); d++) {
          const dispCandle = sortedCandles[d];
          if (dispCandle.high > highestHigh) {
            highestHigh = dispCandle.high;
          }
          const dispExpansion = dispCandle.close - obHigh;
          const dispBody = dispCandle.close - dispCandle.open;
          const hasDecisiveExpansion = dispExpansion >= Math.max(atr * 0.35, buffer * 0.8) && dispBody >= atr * 0.15 || dispExpansion >= atr * 0.6;
          const brokeSwingHigh = (marketStructure?.swingHighs || []).some(
            (sh) => sh.index < d && sh.index >= Math.max(0, i - 30) && dispCandle.high > sh.price
          );
          const hasBosOrChoch = (marketStructure?.BOS || []).some(
            (b) => b.type === "BULLISH_BOS" && b.candleIndex >= i && b.candleIndex <= d
          ) || (marketStructure?.CHOCH || []).some(
            (ch) => ch.type === "BULLISH_CHOCH" && ch.candleIndex >= i && ch.candleIndex <= d
          );
          const createdFvg = (marketStructure?.fairValueGaps || []).some(
            (f) => f.type === "BULLISH_FVG" && f.candleIndex >= i && f.candleIndex <= d
          );
          if (displacementIdx === -1 && (hasDecisiveExpansion || brokeSwingHigh || hasBosOrChoch || createdFvg)) {
            displacementIdx = d;
            hasStructuralBreak = brokeSwingHigh || hasBosOrChoch || createdFvg;
          } else if (brokeSwingHigh || hasBosOrChoch || createdFvg) {
            hasStructuralBreak = true;
          }
        }
        for (let d = Math.min(sortedCandles.length, i + 15); d < sortedCandles.length; d++) {
          if (sortedCandles[d].high > highestHigh) {
            highestHigh = sortedCandles[d].high;
          }
        }
        const maxDisplacement = highestHigh - obHigh;
        if (displacementIdx === -1 && maxDisplacement >= atr * 0.8) {
          displacementIdx = i + 1;
        }
        if (displacementIdx !== -1) {
          const invalidation = Number((obLow - buffer).toFixed(5));
          let isInvalidated = false;
          let tapCount = 0;
          for (let k = displacementIdx + 1; k < sortedCandles.length; k++) {
            if (sortedCandles[k].close < invalidation) {
              isInvalidated = true;
              break;
            }
            if (sortedCandles[k].low <= obHigh) {
              tapCount++;
            }
          }
          const isMitigated = tapCount >= 4;
          if (!isInvalidated && (!enforceUnmitigated || !isMitigated)) {
            if (activePrice >= obLow - buffer * 0.5) {
              const isCurrentlyInZone = activePrice <= obHigh && activePrice >= obLow;
              const zoneStatus = isCurrentlyInZone ? "ZONE_TAPPED" : tapCount > 0 ? "WAITING_FOR_RETEST" : "WAITING_FOR_TAP";
              const displacementInAtr = maxDisplacement / Math.max(1e-4, atr);
              const displacementScore = Math.min(35, Math.round(displacementInAtr * 8));
              const originBonus = isOriginLow ? 30 : 0;
              const structuralBonus = hasStructuralBreak ? 20 : 0;
              const freshnessBonus = tapCount === 0 ? 15 : 10;
              const distanceInAtr = Math.abs(activePrice - obHigh) / Math.max(1e-4, atr);
              const proximityScore = Math.max(0, 15 - distanceInAtr * 1);
              const strength = Math.round(Math.min(100, (displacementScore + originBonus + structuralBonus + freshnessBonus + proximityScore) * (trend === "BULLISH" ? 1 : 0.85)));
              candidateZones.push({
                id: generateZoneId(pair, "BULLISH_ORDER_BLOCK", "BUY"),
                type: "BULLISH_ORDER_BLOCK",
                direction: "BUY",
                high: obHigh,
                low: obLow,
                invalidationLevel: invalidation,
                strength,
                createdAt: (/* @__PURE__ */ new Date()).toISOString(),
                createdCandleTime: String(c.timestamp),
                displacementCandleTime: String(sortedCandles[displacementIdx].timestamp),
                displacementIndex: displacementIdx,
                tappedAt: tapCount > 0 ? (/* @__PURE__ */ new Date()).toISOString() : null,
                tapCount,
                status: zoneStatus,
                timeframe: marketStructure?.timeframe || "M5",
                originCandle: String(c.timestamp),
                evidence: [
                  `Institutional Demand Zone [${obLow} - ${obHigh}]`,
                  hasStructuralBreak ? "BOS / Swing High Broken" : "Structural Expansion",
                  isOriginLow ? "Origin Swing Low" : "Consolidation Base",
                  `Displacement: +${maxDisplacement.toFixed(4)}`
                ],
                reasoning: `Institutional Demand Zone / Bullish Order Block [${obLow} - ${obHigh}] confirmed with structural displacement.${hasStructuralBreak ? " (BOS / Swing High Broken)" : ""}${isOriginLow ? " [Origin Swing Low]" : ""}`,
                candleIndex: i
              });
            }
          }
        }
      }
      const isUpCandle = c.close >= c.open || c.close < c.open && body <= atr * 0.25;
      const isSwingHigh = (marketStructure?.swingHighs || []).some(
        (sh) => Math.abs(sh.index - i) <= 2 || c.high >= sh.price && Math.abs(sh.index - i) <= 5
      );
      let isLocalPeak = true;
      for (let w = Math.max(0, i - 3); w <= Math.min(sortedCandles.length - 1, i + 3); w++) {
        if (sortedCandles[w].high > c.high) {
          isLocalPeak = false;
          break;
        }
      }
      const isOriginHigh = isSwingHigh || isLocalPeak;
      const isUpperWickRejection = zoneHeight > 0 && (c.high - Math.max(c.open, c.close)) / zoneHeight >= 0.25;
      const qualifiesSupply = isUpCandle || isOriginHigh || isUpperWickRejection;
      if (qualifiesSupply && zoneHeight >= minZoneHeight) {
        const obHigh = Number(c.high.toFixed(5));
        let obLow = Number(Math.min(c.open, c.close).toFixed(5));
        if (obHigh - obLow < minZoneHeight) {
          obLow = Number(Math.max(c.low, obHigh - minZoneHeight).toFixed(5));
        }
        if (obHigh <= obLow) {
          obLow = Number(c.low.toFixed(5));
        }
        let displacementIdx = -1;
        let hasStructuralBreak = false;
        let lowestLow = obLow;
        for (let d = i + 1; d < Math.min(sortedCandles.length, i + 15); d++) {
          const dispCandle = sortedCandles[d];
          if (dispCandle.low < lowestLow) {
            lowestLow = dispCandle.low;
          }
          const dispExpansion = obLow - dispCandle.close;
          const dispBody = dispCandle.open - dispCandle.close;
          const hasDecisiveExpansion = dispExpansion >= Math.max(atr * 0.35, buffer * 0.8) && dispBody >= atr * 0.15 || dispExpansion >= atr * 0.6;
          const brokeSwingLow = (marketStructure?.swingLows || []).some(
            (sl) => sl.index < d && sl.index >= Math.max(0, i - 30) && dispCandle.low < sl.price
          );
          const hasBosOrChoch = (marketStructure?.BOS || []).some(
            (b) => b.type === "BEARISH_BOS" && b.candleIndex >= i && b.candleIndex <= d
          ) || (marketStructure?.CHOCH || []).some(
            (ch) => ch.type === "BEARISH_CHOCH" && ch.candleIndex >= i && ch.candleIndex <= d
          );
          const createdFvg = (marketStructure?.fairValueGaps || []).some(
            (f) => f.type === "BEARISH_FVG" && f.candleIndex >= i && f.candleIndex <= d
          );
          if (displacementIdx === -1 && (hasDecisiveExpansion || brokeSwingLow || hasBosOrChoch || createdFvg)) {
            displacementIdx = d;
            hasStructuralBreak = brokeSwingLow || hasBosOrChoch || createdFvg;
          } else if (brokeSwingLow || hasBosOrChoch || createdFvg) {
            hasStructuralBreak = true;
          }
        }
        for (let d = Math.min(sortedCandles.length, i + 15); d < sortedCandles.length; d++) {
          if (sortedCandles[d].low < lowestLow) {
            lowestLow = sortedCandles[d].low;
          }
        }
        const maxDisplacement = obLow - lowestLow;
        if (displacementIdx === -1 && maxDisplacement >= atr * 0.8) {
          displacementIdx = i + 1;
        }
        if (displacementIdx !== -1) {
          const invalidation = Number((obHigh + buffer).toFixed(5));
          let isInvalidated = false;
          let tapCount = 0;
          for (let k = displacementIdx + 1; k < sortedCandles.length; k++) {
            if (sortedCandles[k].close > invalidation) {
              isInvalidated = true;
              break;
            }
            if (sortedCandles[k].high >= obLow) {
              tapCount++;
            }
          }
          const isMitigated = tapCount >= 4;
          if (!isInvalidated && (!enforceUnmitigated || !isMitigated)) {
            if (activePrice <= obHigh + buffer * 0.5) {
              const isCurrentlyInZone = activePrice >= obLow && activePrice <= obHigh;
              const zoneStatus = isCurrentlyInZone ? "ZONE_TAPPED" : tapCount > 0 ? "WAITING_FOR_RETEST" : "WAITING_FOR_TAP";
              const displacementInAtr = maxDisplacement / Math.max(1e-4, atr);
              const displacementScore = Math.min(35, Math.round(displacementInAtr * 8));
              const originBonus = isOriginHigh ? 30 : 0;
              const structuralBonus = hasStructuralBreak ? 20 : 0;
              const freshnessBonus = tapCount === 0 ? 15 : 10;
              const distanceInAtr = Math.abs(obLow - activePrice) / Math.max(1e-4, atr);
              const proximityScore = Math.max(0, 15 - distanceInAtr * 1);
              const strength = Math.round(Math.min(100, (displacementScore + originBonus + structuralBonus + freshnessBonus + proximityScore) * (trend === "BEARISH" ? 1 : 0.85)));
              candidateZones.push({
                id: generateZoneId(pair, "BEARISH_ORDER_BLOCK", "SELL"),
                type: "BEARISH_ORDER_BLOCK",
                direction: "SELL",
                high: obHigh,
                low: obLow,
                invalidationLevel: invalidation,
                strength,
                createdAt: (/* @__PURE__ */ new Date()).toISOString(),
                createdCandleTime: String(c.timestamp),
                displacementCandleTime: String(sortedCandles[displacementIdx].timestamp),
                displacementIndex: displacementIdx,
                tappedAt: tapCount > 0 ? (/* @__PURE__ */ new Date()).toISOString() : null,
                tapCount,
                status: zoneStatus,
                timeframe: marketStructure?.timeframe || "M5",
                originCandle: String(c.timestamp),
                evidence: [
                  `Institutional Supply Zone [${obLow} - ${obHigh}]`,
                  hasStructuralBreak ? "BOS / Swing Low Broken" : "Structural Expansion",
                  isOriginHigh ? "Origin Swing High" : "Consolidation Base",
                  `Displacement: -${maxDisplacement.toFixed(4)}`
                ],
                reasoning: `Institutional Supply Zone / Bearish Order Block [${obLow} - ${obHigh}] confirmed with structural displacement.${hasStructuralBreak ? " (BOS / Swing Low Broken)" : ""}${isOriginHigh ? " [Origin Swing High]" : ""}`,
                candleIndex: i
              });
            }
          }
        }
      }
    }
  }
  if (allowLiquidity && marketStructure?.swingLows && marketStructure.swingLows.length > 0) {
    const validSwingLows = marketStructure.swingLows.filter((s) => !s.isBroken && s.price < activePrice);
    if (validSwingLows.length > 0) {
      const nearestLow = validSwingLows[validSwingLows.length - 1];
      const lowPrice = Number(nearestLow.price.toFixed(5));
      const zoneHigh = Number((lowPrice + buffer * 0.8).toFixed(5));
      const invalidation = Number((lowPrice - buffer).toFixed(5));
      const distanceRatio = Math.abs(activePrice - zoneHigh) / activePrice;
      const strength = Math.round(Math.max(0, 85 - distanceRatio * 1e3));
      candidateZones.push({
        id: generateZoneId(pair, "SWING_LOW_LIQUIDITY", "BUY"),
        type: "SWING_LOW_LIQUIDITY",
        direction: "BUY",
        high: zoneHigh,
        low: lowPrice,
        invalidationLevel: invalidation,
        strength,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        createdCandleTime: String(nearestLow.timestamp),
        tappedAt: null,
        tapCount: 0,
        status: "WAITING_FOR_TAP",
        timeframe: marketStructure?.timeframe || "M5",
        originCandle: String(nearestLow.timestamp),
        evidence: [`Protected Swing Low at ${lowPrice}`],
        reasoning: `Protected Swing Low liquidity zone at price ${lowPrice}.`,
        candleIndex: nearestLow.index
      });
    }
  }
  if (allowLiquidity && marketStructure?.swingHighs && marketStructure.swingHighs.length > 0) {
    const validSwingHighs = marketStructure.swingHighs.filter((s) => !s.isBroken && s.price > activePrice);
    if (validSwingHighs.length > 0) {
      const nearestHigh = validSwingHighs[validSwingHighs.length - 1];
      const highPrice = Number(nearestHigh.price.toFixed(5));
      const zoneLow = Number((highPrice - buffer * 0.8).toFixed(5));
      const invalidation = Number((highPrice + buffer).toFixed(5));
      const distanceRatio = Math.abs(zoneLow - activePrice) / activePrice;
      const strength = Math.round(Math.max(0, 85 - distanceRatio * 1e3));
      candidateZones.push({
        id: generateZoneId(pair, "SWING_HIGH_LIQUIDITY", "SELL"),
        type: "SWING_HIGH_LIQUIDITY",
        direction: "SELL",
        high: highPrice,
        low: zoneLow,
        invalidationLevel: invalidation,
        strength,
        createdAt: (/* @__PURE__ */ new Date()).toISOString(),
        createdCandleTime: String(nearestHigh.timestamp),
        tappedAt: null,
        tapCount: 0,
        status: "WAITING_FOR_TAP",
        timeframe: marketStructure?.timeframe || "M5",
        originCandle: String(nearestHigh.timestamp),
        evidence: [`Protected Swing High at ${highPrice}`],
        reasoning: `Protected Swing High liquidity zone at price ${highPrice}.`,
        candleIndex: nearestHigh.index
      });
    }
  }
  if (allowSr && marketStructure?.supportZones && marketStructure.supportZones.length > 0) {
    for (const sz of marketStructure.supportZones) {
      if (sz.priceMin < activePrice) {
        const low = Number(sz.priceMin.toFixed(5));
        const high = Number(sz.priceMax.toFixed(5));
        const invalidation = Number((low - buffer).toFixed(5));
        candidateZones.push({
          id: generateZoneId(pair, "SUPPORT", "BUY"),
          type: "SUPPORT",
          direction: "BUY",
          high,
          low,
          invalidationLevel: invalidation,
          strength: Math.min(100, (sz.strength || 1) * 20),
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          createdCandleTime: String(latestCandle.timestamp),
          tappedAt: null,
          tapCount: 0,
          status: "WAITING_FOR_TAP",
          reasoning: `Structural Support Zone [${low} - ${high}].`
        });
      }
    }
  }
  if (allowSr && marketStructure?.resistanceZones && marketStructure.resistanceZones.length > 0) {
    for (const rz of marketStructure.resistanceZones) {
      if (rz.priceMax > activePrice) {
        const low = Number(rz.priceMin.toFixed(5));
        const high = Number(rz.priceMax.toFixed(5));
        const invalidation = Number((high + buffer).toFixed(5));
        candidateZones.push({
          id: generateZoneId(pair, "RESISTANCE", "SELL"),
          type: "RESISTANCE",
          direction: "SELL",
          high,
          low,
          invalidationLevel: invalidation,
          strength: Math.min(100, (rz.strength || 1) * 20),
          createdAt: (/* @__PURE__ */ new Date()).toISOString(),
          createdCandleTime: String(latestCandle.timestamp),
          tappedAt: null,
          tapCount: 0,
          status: "WAITING_FOR_TAP",
          reasoning: `Structural Resistance Zone [${low} - ${high}].`
        });
      }
    }
  }
  if (marketStructure?.htfCandles && marketStructure.htfCandles.length >= 10 && candles !== marketStructure.htfCandles) {
    try {
      const htfMs = marketStructure.htfMarketStructure || extractMarketStructure(marketStructure.htfCandles);
      htfMs.trend = marketStructure.htfTrend || htfMs.trend;
      htfMs.htfTrend = marketStructure.htfTrend;
      htfMs.htfTimeframe = marketStructure.htfTimeframe || "H4";
      htfMs.htfAllowedDirection = marketStructure.htfAllowedDirection;
      htfMs.pair = pair;
      const htfCandidates = identifyCandidateZones(marketStructure.htfCandles, htfMs, compiledStrategy, activePrice, rejectedZones);
      for (const htfCand of htfCandidates) {
        htfCand.htfTimeframe = marketStructure.htfTimeframe || "H4";
        htfCand.strength = Math.min(100, (htfCand.strength || 80) + 10);
        if (!candidateZones.some((cz) => cz.id === htfCand.id || cz.low === htfCand.low && cz.high === htfCand.high)) {
          candidateZones.push(htfCand);
        }
      }
    } catch (e) {
      console.warn(`[ZONE ENGINE] Error evaluating HTF candidate zones:`, e);
    }
  }
  if (candidateZones.length === 0) {
    return [];
  }
  const htfTrend = marketStructure?.htfTrend || "SIDEWAYS";
  const htfTimeframe = marketStructure?.htfTimeframe || "H4";
  let filteredCandidates = candidateZones;
  if (filteredCandidates.length === 0) {
    return [];
  }
  if (Array.isArray(rejectedZones) && rejectedZones.length > 0 && filteredCandidates.length > 0) {
    const originalCount = filteredCandidates.length;
    filteredCandidates = filteredCandidates.filter((candidate) => {
      const isRejected = rejectedZones.some((rz) => {
        const overlaps = Math.max(candidate.low, rz.low) <= Math.min(candidate.high, rz.high);
        const nearIdentical = Math.abs(candidate.low - rz.low) / (candidate.low || 1) < 15e-4 && Math.abs(candidate.high - rz.high) / (candidate.high || 1) < 15e-4;
        const sameDirection = !rz.direction || rz.direction === candidate.direction;
        return (overlaps || nearIdentical) && sameDirection;
      });
      return !isRejected;
    });
    if (originalCount > 0 && filteredCandidates.length === 0) {
      console.log(`[ZONE QUALITY DISENGAGEMENT] ${pair}: Filtered out ${originalCount} candidate zone(s) that were previously rejected by quality control. Waiting for another zone to appear.`);
      return [];
    }
  }
  const distinctCandidates = [];
  for (const candidate of filteredCandidates) {
    const overlappingIdx = distinctCandidates.findIndex(
      (existing) => existing.direction === candidate.direction && Math.max(existing.low, candidate.low) <= Math.min(existing.high, candidate.high)
    );
    if (overlappingIdx === -1) {
      distinctCandidates.push(candidate);
    } else {
      const existing = distinctCandidates[overlappingIdx];
      if (candidate.direction === "SELL") {
        if (candidate.high > existing.high || candidate.high === existing.high && candidate.strength > existing.strength) {
          distinctCandidates[overlappingIdx] = candidate;
        }
      } else {
        if (candidate.low < existing.low || candidate.low === existing.low && candidate.strength > existing.strength) {
          distinctCandidates[overlappingIdx] = candidate;
        }
      }
    }
  }
  distinctCandidates.sort((a, b) => {
    const distA = Math.abs((a.direction === "SELL" ? a.low : a.high) - activePrice);
    const distB = Math.abs((b.direction === "SELL" ? b.low : b.high) - activePrice);
    const scoreA = a.strength + (distA <= atr * 2 ? 15 : 0);
    const scoreB = b.strength + (distB <= atr * 2 ? 15 : 0);
    return scoreB - scoreA;
  });
  return distinctCandidates.slice(0, 10).map((z) => {
    z.htfTrend = htfTrend || "SIDEWAYS";
    z.htfTimeframe = htfTimeframe;
    z.htfReason = marketStructure?.htfReason;
    if (htfTrend && htfTrend !== "SIDEWAYS") {
      z.reasoning = `[${htfTimeframe} ${htfTrend} Trend Aligned] ` + z.reasoning;
    }
    return z;
  });
}
function identifyMarkedZone(candles, marketStructure, compiledStrategy, currentPrice, rejectedZones) {
  const candidates = identifyCandidateZones(candles, marketStructure, compiledStrategy, currentPrice, rejectedZones);
  return candidates[0] || null;
}
function isPriceInOrTappingZone(zone, candle, currentPrice) {
  if (!zone || !candle) return false;
  const refTime = zone.displacementCandleTime || zone.createdCandleTime;
  if (refTime && candle.timestamp) {
    const candleTime = new Date(candle.timestamp).getTime();
    const zoneOriginTime = new Date(refTime).getTime();
    if (!isNaN(candleTime) && !isNaN(zoneOriginTime) && candleTime <= zoneOriginTime) {
      return false;
    }
  }
  const activePrice = currentPrice !== void 0 && currentPrice !== null && !isNaN(currentPrice) ? currentPrice : candle.close;
  if (zone.direction === "SELL") {
    const livePriceInZone2 = activePrice >= zone.low && activePrice <= zone.invalidationLevel;
    const candleHighInZone = candle.high >= zone.low && candle.close <= zone.invalidationLevel;
    return livePriceInZone2 || candleHighInZone;
  } else if (zone.direction === "BUY") {
    const livePriceInZone2 = activePrice <= zone.high && activePrice >= zone.invalidationLevel;
    const candleLowInZone = candle.low <= zone.high && candle.close >= zone.invalidationLevel;
    return livePriceInZone2 || candleLowInZone;
  }
  const livePriceInZone = activePrice >= zone.low && activePrice <= zone.high;
  const candleOverlaps = candle.low <= zone.high && candle.high >= zone.low;
  return livePriceInZone || candleOverlaps;
}
function evaluateZoneRejection(zone, latestCandle, currentPrice, prevCandle) {
  const candleRange = Math.max(1e-5, latestCandle.high - latestCandle.low);
  if (zone.direction === "BUY") {
    if (latestCandle.close < zone.invalidationLevel || currentPrice < zone.invalidationLevel) {
      return { isRejected: false, rejectionReason: "Price broke below BUY invalidation level." };
    }
    const candleReachedZone = latestCandle.low <= zone.high || prevCandle && prevCandle.low <= zone.high;
    if (!candleReachedZone && currentPrice > zone.high) {
      return { isRejected: false, rejectionReason: "Price has not tested the marked BUY zone." };
    }
    const lowerWick = Math.min(latestCandle.open, latestCandle.close) - latestCandle.low;
    const lowerWickRatio = lowerWick / candleRange;
    if (lowerWickRatio >= 0.2 && latestCandle.low <= zone.high && latestCandle.close >= zone.low) {
      return {
        isRejected: true,
        rejectionType: "WICK",
        rejectionReason: `Bullish wick rejection: Lower shadow ${(lowerWickRatio * 100).toFixed(0)}% tested zone [${zone.low} - ${zone.high}] and rejected upward.`
      };
    }
    const isBullishCandle = latestCandle.close > latestCandle.open;
    if (isBullishCandle && candleReachedZone && latestCandle.close >= zone.low) {
      return {
        isRejected: true,
        rejectionType: "BOUNCE",
        rejectionReason: `Bullish candle rejection: Closed green (${latestCandle.close.toFixed(5)} > ${latestCandle.open.toFixed(5)}) off marked zone.`
      };
    }
    if (candleReachedZone && currentPrice > latestCandle.open && currentPrice >= zone.low) {
      return {
        isRejected: true,
        rejectionType: "DEPARTURE",
        rejectionReason: `Bullish rejection bounce: Price (${currentPrice.toFixed(5)}) tested zone [${zone.low} - ${zone.high}] and advancing upward holding invalidation (${zone.invalidationLevel.toFixed(5)}).`
      };
    }
  } else if (zone.direction === "SELL") {
    if (latestCandle.close > zone.invalidationLevel || currentPrice > zone.invalidationLevel) {
      return { isRejected: false, rejectionReason: "Price broke above SELL invalidation level." };
    }
    const candleReachedZone = latestCandle.high >= zone.low || prevCandle && prevCandle.high >= zone.low;
    if (!candleReachedZone && currentPrice < zone.low) {
      return { isRejected: false, rejectionReason: "Price has not tested the marked SELL zone." };
    }
    const upperWick = latestCandle.high - Math.max(latestCandle.open, latestCandle.close);
    const upperWickRatio = upperWick / candleRange;
    if (upperWickRatio >= 0.2 && latestCandle.high >= zone.low && latestCandle.close <= zone.high) {
      return {
        isRejected: true,
        rejectionType: "WICK",
        rejectionReason: `Bearish wick rejection: Upper shadow ${(upperWickRatio * 100).toFixed(0)}% tested zone [${zone.low} - ${zone.high}] and rejected downward.`
      };
    }
    const isBearishCandle = latestCandle.close < latestCandle.open;
    if (isBearishCandle && candleReachedZone && latestCandle.close <= zone.high) {
      return {
        isRejected: true,
        rejectionType: "BOUNCE",
        rejectionReason: `Bearish candle rejection: Closed red (${latestCandle.close.toFixed(5)} < ${latestCandle.open.toFixed(5)}) off marked zone.`
      };
    }
    if (candleReachedZone && currentPrice < latestCandle.open && currentPrice <= zone.high) {
      return {
        isRejected: true,
        rejectionType: "DEPARTURE",
        rejectionReason: `Bearish rejection bounce: Price (${currentPrice.toFixed(5)}) tested zone [${zone.low} - ${zone.high}] and advancing downward holding invalidation (${zone.invalidationLevel.toFixed(5)}).`
      };
    }
  }
  return { isRejected: false, rejectionReason: "Awaiting clean price action rejection from marked zone." };
}
function detectLargeDisplacementAway(zone, candles, latestCandle, effectiveAtr = 5e-4, currentPrice) {
  return { hasDisplaced: false };
}
function evaluateZoneState(zone, latestCandle, currentPrice, atr, candles, marketStructure) {
  const updatedZone = { ...zone };
  const effectiveAtr = atr || 5e-4;
  const hasOpposingChoch = zone.direction === "BUY" && marketStructure?.CHOCH?.some((c) => c.type === "BEARISH_CHOCH") || zone.direction === "SELL" && marketStructure?.CHOCH?.some((c) => c.type === "BULLISH_CHOCH");
  if (hasOpposingChoch && zone.status === "WAITING_FOR_TAP") {
    updatedZone.status = "INVALIDATED";
    return {
      status: "INVALIDATED",
      isTapped: false,
      isInvalidated: true,
      reason: `Zone invalidated: Structural CHOCH detected contrary to ${zone.direction} marked zone.`,
      updatedZone
    };
  }
  const activePrice = currentPrice !== void 0 && currentPrice !== null && !isNaN(currentPrice) ? currentPrice : latestCandle.close;
  if (zone.status === "CONFIRMED") {
    const zPair = (marketStructure?.pair || zone.id || "").toUpperCase();
    const isIdxOrBigCrypto = zPair.includes("NAS") || zPair.includes("US30") || zPair.includes("SPX") || zPair.includes("GER") || zPair.includes("UK100") || zone.high >= 1e3;
    const pipSize = isIdxOrBigCrypto ? 1 : zone.high > 10 ? 0.01 : 1e-4;
    const departure = zone.direction === "SELL" ? zone.low - activePrice : activePrice - zone.high;
    const departurePips = departure / pipSize;
    const maxDepartureTolerance = Math.max(effectiveAtr * 3, pipSize * 30);
    if (departure > maxDepartureTolerance) {
      updatedZone.status = "EXPIRED";
      return {
        status: "EXPIRED",
        isTapped: true,
        isInvalidated: true,
        isRejected: false,
        reason: `Zone expired: Confirmed ${zone.direction} zone [${zone.low.toFixed(5)} - ${zone.high.toFixed(5)}] has moved ${departurePips.toFixed(1)} pips past zone. Retest entry window has passed.`,
        updatedZone
      };
    }
  }
  const invLevel = zone.invalidationLevel !== void 0 && zone.invalidationLevel !== null && !isNaN(zone.invalidationLevel) ? zone.invalidationLevel : zone.direction === "BUY" ? zone.low - (zone.high - zone.low) * 0.5 : zone.high + (zone.high - zone.low) * 0.5;
  if (zone.direction === "BUY") {
    if (latestCandle.close < invLevel || activePrice < invLevel) {
      updatedZone.status = "INVALIDATED";
      return {
        status: "INVALIDATED",
        isTapped: false,
        isInvalidated: true,
        reason: `Zone invalidated: Price (${activePrice.toFixed(5)}) or Candle Close (${latestCandle.close.toFixed(5)}) broke below BUY invalidation level (${invLevel.toFixed(5)}).`,
        updatedZone
      };
    }
  } else if (zone.direction === "SELL") {
    if (latestCandle.close > invLevel || activePrice > invLevel) {
      updatedZone.status = "INVALIDATED";
      return {
        status: "INVALIDATED",
        isTapped: false,
        isInvalidated: true,
        reason: `Zone invalidated: Price (${activePrice.toFixed(5)}) or Candle Close (${latestCandle.close.toFixed(5)}) broke above SELL invalidation level (${invLevel.toFixed(5)}).`,
        updatedZone
      };
    }
  }
  const prevCandle = candles && candles.length >= 2 ? candles[candles.length - 2] : void 0;
  const candleList = candles && candles.length > 0 ? candles : latestCandle ? [latestCandle] : [];
  let tapCandleIndex = -1;
  let tapCandle = void 0;
  const originTime = zone.displacementCandleTime || zone.createdCandleTime;
  const originTimestamp = originTime ? new Date(originTime).getTime() : 0;
  if (candleList.length > 0) {
    for (let cIdx = 0; cIdx < candleList.length; cIdx++) {
      const c = candleList[cIdx];
      if (originTimestamp > 0 && c.timestamp) {
        const cTime = new Date(c.timestamp).getTime();
        if (!isNaN(cTime) && cTime <= originTimestamp) {
          continue;
        }
      }
      if (isPriceInOrTappingZone(zone, c, currentPrice)) {
        tapCandleIndex = cIdx;
        tapCandle = c;
        break;
      }
    }
  }
  const liveTapping = isPriceInOrTappingZone(zone, latestCandle, currentPrice);
  if (tapCandleIndex === -1 && liveTapping) {
    tapCandleIndex = candleList.length - 1;
    tapCandle = latestCandle;
  }
  const wasPreviouslyTapped = zone.status === "ZONE_TAPPED" || zone.status === "CONFIRMED" || zone.tapCount !== void 0 && zone.tapCount > 0 || !!zone.tappedAt;
  if (tapCandleIndex !== -1 || wasPreviouslyTapped) {
    const tapTimestamp = tapCandle?.timestamp ? String(tapCandle.timestamp) : (/* @__PURE__ */ new Date()).toISOString();
    updatedZone.tappedAt = zone.tappedAt || tapTimestamp;
    updatedZone.tapCount = Math.max(zone.tapCount || 1, 1);
    const isLatestCandleTheTap = tapCandleIndex === candleList.length - 1;
    if (isLatestCandleTheTap && tapCandleIndex !== -1) {
      const rejection2 = evaluateZoneRejection(zone, latestCandle, currentPrice, prevCandle);
      if (rejection2.isRejected) {
        updatedZone.status = "CONFIRMED";
        return {
          status: "CONFIRMED",
          isTapped: true,
          isInvalidated: false,
          isRejected: true,
          rejectionReason: rejection2.rejectionReason,
          reason: `Zone valid: Price (${currentPrice.toFixed(5)}) confirmed immediate rejection bounce off marked zone [${zone.low} - ${zone.high}]. ${rejection2.rejectionReason}`,
          updatedZone
        };
      }
      updatedZone.status = "ZONE_TAPPED";
      return {
        status: "ZONE_TAPPED",
        isTapped: true,
        isInvalidated: false,
        isRejected: false,
        reason: `Zone tapped: Candle at ${tapCandle?.timestamp || "current time"} entered marked zone [${zone.low} - ${zone.high}]. Awaiting next candle to evaluate retest vs continuation.`,
        updatedZone
      };
    }
    const postTapCandles = candles && tapCandleIndex >= 0 ? candles.slice(tapCandleIndex + 1) : candles && candles.length >= 2 ? [candles[candles.length - 1]] : [];
    const nextCandle = postTapCandles.length > 0 ? postTapCandles[0] : latestCandle;
    if (zone.direction === "BUY") {
      const brokeThrough = postTapCandles.some((c) => {
        const cRange = Math.max(c.high - c.low, 1e-5);
        const lowerWickRatio = (Math.min(c.open, c.close) - c.low) / cRange;
        return c.close < zone.invalidationLevel || currentPrice < zone.invalidationLevel || c.close < zone.low && c.close < c.open && lowerWickRatio < 0.2;
      });
      if (brokeThrough) {
        updatedZone.status = "INVALIDATED";
        return {
          status: "INVALIDATED",
          isTapped: true,
          isInvalidated: true,
          isRejected: false,
          reason: `Zone invalidated: After tapping, price kept going downward through marked zone [${zone.low} - ${zone.high}] (Current: ${currentPrice.toFixed(5)}, Invalidation: ${zone.invalidationLevel.toFixed(5)}) instead of holding retest.`,
          updatedZone
        };
      }
    } else if (zone.direction === "SELL") {
      const brokeThrough = postTapCandles.some((c) => {
        const cRange = Math.max(c.high - c.low, 1e-5);
        const upperWickRatio = (c.high - Math.max(c.open, c.close)) / cRange;
        return c.close > zone.invalidationLevel || currentPrice > zone.invalidationLevel || c.close > zone.high && c.close > c.open && upperWickRatio < 0.2;
      });
      if (brokeThrough) {
        updatedZone.status = "INVALIDATED";
        return {
          status: "INVALIDATED",
          isTapped: true,
          isInvalidated: true,
          isRejected: false,
          reason: `Zone invalidated: After tapping, price kept going upward through marked zone [${zone.low} - ${zone.high}] (Current: ${currentPrice.toFixed(5)}, Invalidation: ${zone.invalidationLevel.toFixed(5)}) instead of holding retest.`,
          updatedZone
        };
      }
    }
    const rejection = evaluateZoneRejection(zone, latestCandle, currentPrice, prevCandle);
    let madeRetest = rejection.isRejected;
    if (!madeRetest && postTapCandles.length > 0) {
      for (const c of postTapCandles) {
        const cRange = Math.max(c.high - c.low, 1e-5);
        if (zone.direction === "BUY") {
          const lowerWickRatio = (Math.min(c.open, c.close) - c.low) / cRange;
          if (c.low <= zone.high && c.close >= zone.low && (c.close > c.open || lowerWickRatio >= 0.2)) {
            madeRetest = true;
            break;
          }
        } else if (zone.direction === "SELL") {
          const upperWickRatio = (c.high - Math.max(c.open, c.close)) / cRange;
          if (c.high >= zone.low && c.close <= zone.high && (c.close < c.open || upperWickRatio >= 0.2)) {
            madeRetest = true;
            break;
          }
        }
      }
    }
    if (madeRetest) {
      const zPair = (marketStructure?.pair || zone.id || "").toUpperCase();
      const isIdxOrBigCrypto = zPair.includes("NAS") || zPair.includes("US30") || zPair.includes("SPX") || zPair.includes("GER") || zPair.includes("UK100") || zone.high >= 1e3;
      const pipSize = isIdxOrBigCrypto ? 1 : zone.high > 10 ? 0.01 : 1e-4;
      const departure = zone.direction === "SELL" ? zone.low - currentPrice : currentPrice - zone.high;
      const departurePips = departure / pipSize;
      const maxDepartureTolerance = Math.max(effectiveAtr * 3, pipSize * 30);
      if (departure > maxDepartureTolerance) {
        updatedZone.status = "EXPIRED";
        return {
          status: "EXPIRED",
          isTapped: true,
          isInvalidated: true,
          isRejected: false,
          reason: `Zone expired: After tapping and rejecting, price moved ${departurePips.toFixed(1)} pips past marked ${zone.direction} zone [${zone.low.toFixed(5)} - ${zone.high.toFixed(5)}]. Retest entry window has passed.`,
          updatedZone
        };
      }
      updatedZone.status = "CONFIRMED";
      return {
        status: "CONFIRMED",
        isTapped: true,
        isInvalidated: false,
        isRejected: true,
        rejectionReason: rejection.rejectionReason || "Confirmed valid retest holding marked zone.",
        reason: `Zone valid: After tapping, next candle successfully made a retest respecting marked ${zone.direction} zone [${zone.low} - ${zone.high}] with confirmed rejection.`,
        updatedZone
      };
    }
    updatedZone.status = "ZONE_TAPPED";
    return {
      status: "ZONE_TAPPED",
      isTapped: true,
      isInvalidated: false,
      isRejected: false,
      reason: `Zone tapped: Next candle is retesting marked zone [${zone.low} - ${zone.high}]. Awaiting retest close or bounce confirmation.`,
      updatedZone
    };
  }
  const displacementCheck = detectLargeDisplacementAway(zone, candles?.slice(0, -1), latestCandle, effectiveAtr, currentPrice);
  if (displacementCheck.hasDisplaced) {
    updatedZone.status = "EXPIRED_WITHOUT_ENTRY";
    updatedZone.displacementOrigin = displacementCheck.origin;
    return {
      status: "EXPIRED_WITHOUT_ENTRY",
      isTapped: false,
      isInvalidated: false,
      reason: displacementCheck.reason || `Zone expired without entry: Large candle displacement detected departing without retrace.`,
      updatedZone,
      displacementOrigin: displacementCheck.origin
    };
  }
  updatedZone.status = "WAITING_FOR_TAP";
  return {
    status: "WAITING_FOR_TAP",
    isTapped: false,
    isInvalidated: false,
    reason: `Sticking with entry position: Price (${currentPrice.toFixed(5)}) has not tapped marked zone [${zone.low} - ${zone.high}]. No large candle displacement detected; maintaining entry position.`,
    updatedZone
  };
}
export {
  clearRejectedZones,
  detectLargeDisplacementAway,
  evaluateZoneRejection,
  evaluateZoneState,
  generateZoneId,
  getRejectedZones,
  identifyCandidateZones,
  identifyMarkedZone,
  isPriceInOrTappingZone,
  recordRejectedZone
};
