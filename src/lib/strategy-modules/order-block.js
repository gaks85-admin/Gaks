import { computeInstrumentBuffer, detectFractalSwings } from "./primitives.js";
function detectOrderBlocks(sortedCandles, options = {}) {
  if (!sortedCandles || sortedCandles.length < 4) return [];
  const latestCandle = sortedCandles[sortedCandles.length - 1];
  const activePrice = options.currentPrice && options.currentPrice > 0 ? options.currentPrice : Number(latestCandle.close);
  const calc = computeInstrumentBuffer(sortedCandles, activePrice, options.pair);
  const atr = options.atr && options.atr > 0 ? options.atr : calc.atr;
  const buffer = options.buffer && options.buffer > 0 ? options.buffer : calc.buffer;
  let swingHighs = options.swingHighs;
  let swingLows = options.swingLows;
  if (!swingHighs || !swingLows) {
    const swings = detectFractalSwings(sortedCandles, 2);
    swingHighs = swingHighs || swings.swingHighs;
    swingLows = swingLows || swings.swingLows;
  }
  const fvgs = options.fairValueGaps || [];
  const bosList = options.bosList || [];
  const chochList = options.chochList || [];
  const enforceUnmitigated = options.enforceUnmitigated !== false;
  const lookbackBars = options.lookbackBars || 120;
  const minZoneHeight = Math.max(atr * 0.04, 1e-5);
  const detected = [];
  const startIdx = Math.max(0, sortedCandles.length - lookbackBars);
  for (let i = sortedCandles.length - 2; i >= startIdx; i--) {
    const c = sortedCandles[i];
    const body = Math.abs(Number(c.close) - Number(c.open));
    const zoneHeight = Number(c.high) - Number(c.low);
    if (zoneHeight < minZoneHeight) continue;
    const isDownCandle = Number(c.close) <= Number(c.open) || Number(c.close) > Number(c.open) && body <= atr * 0.25;
    const isSwingLow = swingLows.some(
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
    if (isDownCandle || isOriginLow || isLowerWickRejection) {
      const obLow = Number(c.low.toFixed(5));
      let obHigh = Number(Math.max(c.open, c.close).toFixed(5));
      if (obHigh - obLow < minZoneHeight) {
        obHigh = Number(Math.min(c.high, obLow + minZoneHeight).toFixed(5));
      }
      if (obHigh <= obLow) obHigh = Number(c.high.toFixed(5));
      let displacementIdx = -1;
      let hasStructuralBreak = false;
      let highestHigh = obHigh;
      const zoneRange = Math.max(obHigh - obLow, atr * 0.1);
      for (let d = i + 1; d < Math.min(sortedCandles.length, i + 15); d++) {
        const dc = sortedCandles[d];
        if (dc.high > highestHigh) highestHigh = dc.high;
        const dispExpansion = dc.close - obHigh;
        const dispBody = dc.close - dc.open;
        const hasDecisiveExpansion = dispExpansion >= Math.max(atr * 0.65, buffer * 1.2) && dispBody >= atr * 0.25 || dispExpansion >= atr * 0.9;
        const brokeSwingHigh = swingHighs.some(
          (sh) => sh.index < d && sh.index >= Math.max(0, i - 30) && dc.close > sh.price
        );
        const hasBosOrChoch = bosList.some((b) => b.type === "BULLISH_BOS" && b.candleIndex >= i && b.candleIndex <= d) || chochList.some((ch) => ch.type === "BULLISH_CHOCH" && ch.candleIndex >= i && ch.candleIndex <= d);
        const createdFvg = fvgs.some(
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
        if (sortedCandles[d].high > highestHigh) highestHigh = sortedCandles[d].high;
      }
      const maxDisplacement = highestHigh - obHigh;
      if (displacementIdx === -1 && maxDisplacement >= Math.max(atr * 0.95, zoneRange * 1.2)) {
        displacementIdx = i + 1;
      }
      const hasMeaningfulDeparture = hasStructuralBreak ? maxDisplacement >= Math.max(atr * 0.55, zoneRange * 0.9) : maxDisplacement >= Math.max(atr * 0.85, zoneRange * 1.15);
      if (displacementIdx !== -1 && hasMeaningfulDeparture) {
        const invalidation = Number((obLow - buffer).toFixed(5));
        let isInvalidated = false;
        let tapCount = 0;
        let priorTapCount = 0;
        for (let k = displacementIdx + 1; k < sortedCandles.length; k++) {
          if (sortedCandles[k].close < invalidation) {
            isInvalidated = true;
            break;
          }
          if (sortedCandles[k].low <= obHigh) {
            tapCount++;
            if (k < sortedCandles.length - 2) priorTapCount++;
          }
        }
        const isMitigated = priorTapCount >= 2 || tapCount >= 3;
        if (!isInvalidated && (!enforceUnmitigated || !isMitigated) && activePrice >= obLow - buffer * 0.5) {
          const isTappedNow = activePrice <= obHigh && activePrice >= obLow || latestCandle.low <= obHigh && latestCandle.close >= invalidation;
          const displacementAtrRatio = maxDisplacement / Math.max(1e-4, atr);
          const displacementScore = Math.min(35, Math.round(displacementAtrRatio * 8));
          const originBonus = isOriginLow ? 30 : 0;
          const structuralBonus = hasStructuralBreak ? 20 : 0;
          const freshnessBonus = tapCount === 0 ? 15 : 10;
          const distanceInAtr = Math.abs(activePrice - obHigh) / Math.max(1e-4, atr);
          const proximityScore = Math.max(0, 15 - distanceInAtr);
          const strength = Math.round(Math.min(100, displacementScore + originBonus + structuralBonus + freshnessBonus + proximityScore));
          detected.push({
            type: "BULLISH_ORDER_BLOCK",
            direction: "BUY",
            high: obHigh,
            low: obLow,
            invalidationLevel: invalidation,
            candleIndex: i,
            displacementIndex: displacementIdx,
            displacement: Number(maxDisplacement.toFixed(5)),
            displacementAtrRatio: Number(displacementAtrRatio.toFixed(2)),
            hasStructuralBreak,
            isOriginSwing: isOriginLow,
            tapCount,
            isMitigated,
            isInvalidated,
            isTappedNow,
            strength,
            timestamp: c.timestamp,
            evidence: [
              `Bullish OB [${obLow} - ${obHigh}]`,
              `Displacement +${displacementAtrRatio.toFixed(2)} ATR`,
              hasStructuralBreak ? "Confirmed BOS/Swing Break" : "Impulsive Departure",
              isMitigated ? `Mitigated (${tapCount} taps)` : `Unmitigated (${tapCount} taps)`
            ]
          });
        }
      }
    }
    const isUpCandle = Number(c.close) >= Number(c.open) || Number(c.close) < Number(c.open) && body <= atr * 0.25;
    const isSwingHigh = swingHighs.some(
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
    if (isUpCandle || isOriginHigh || isUpperWickRejection) {
      const obHigh = Number(c.high.toFixed(5));
      let obLow = Number(Math.min(c.open, c.close).toFixed(5));
      if (obHigh - obLow < minZoneHeight) {
        obLow = Number(Math.max(c.low, obHigh - minZoneHeight).toFixed(5));
      }
      if (obHigh <= obLow) obLow = Number(c.low.toFixed(5));
      let displacementIdx = -1;
      let hasStructuralBreak = false;
      let lowestLow = obLow;
      const zoneRange = Math.max(obHigh - obLow, atr * 0.1);
      for (let d = i + 1; d < Math.min(sortedCandles.length, i + 15); d++) {
        const dc = sortedCandles[d];
        if (dc.low < lowestLow) lowestLow = dc.low;
        const dispExpansion = obLow - dc.close;
        const dispBody = dc.open - dc.close;
        const hasDecisiveExpansion = dispExpansion >= Math.max(atr * 0.65, buffer * 1.2) && dispBody >= atr * 0.25 || dispExpansion >= atr * 0.9;
        const brokeSwingLow = swingLows.some(
          (sl) => sl.index < d && sl.index >= Math.max(0, i - 30) && dc.close < sl.price
        );
        const hasBosOrChoch = bosList.some((b) => b.type === "BEARISH_BOS" && b.candleIndex >= i && b.candleIndex <= d) || chochList.some((ch) => ch.type === "BEARISH_CHOCH" && ch.candleIndex >= i && ch.candleIndex <= d);
        const createdFvg = fvgs.some(
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
        if (sortedCandles[d].low < lowestLow) lowestLow = sortedCandles[d].low;
      }
      const maxDisplacement = obLow - lowestLow;
      if (displacementIdx === -1 && maxDisplacement >= Math.max(atr * 0.95, zoneRange * 1.2)) {
        displacementIdx = i + 1;
      }
      const hasMeaningfulDeparture = hasStructuralBreak ? maxDisplacement >= Math.max(atr * 0.55, zoneRange * 0.9) : maxDisplacement >= Math.max(atr * 0.85, zoneRange * 1.15);
      if (displacementIdx !== -1 && hasMeaningfulDeparture) {
        const invalidation = Number((obHigh + buffer).toFixed(5));
        let isInvalidated = false;
        let tapCount = 0;
        let priorTapCount = 0;
        for (let k = displacementIdx + 1; k < sortedCandles.length; k++) {
          if (sortedCandles[k].close > invalidation) {
            isInvalidated = true;
            break;
          }
          if (sortedCandles[k].high >= obLow) {
            tapCount++;
            if (k < sortedCandles.length - 2) priorTapCount++;
          }
        }
        const isMitigated = priorTapCount >= 2 || tapCount >= 3;
        if (!isInvalidated && (!enforceUnmitigated || !isMitigated) && activePrice <= obHigh + buffer * 0.5) {
          const isTappedNow = activePrice >= obLow && activePrice <= obHigh || latestCandle.high >= obLow && latestCandle.close <= invalidation;
          const displacementAtrRatio = maxDisplacement / Math.max(1e-4, atr);
          const displacementScore = Math.min(35, Math.round(displacementAtrRatio * 8));
          const originBonus = isOriginHigh ? 30 : 0;
          const structuralBonus = hasStructuralBreak ? 20 : 0;
          const freshnessBonus = tapCount === 0 ? 15 : 10;
          const distanceInAtr = Math.abs(obLow - activePrice) / Math.max(1e-4, atr);
          const proximityScore = Math.max(0, 15 - distanceInAtr);
          const strength = Math.round(Math.min(100, displacementScore + originBonus + structuralBonus + freshnessBonus + proximityScore));
          detected.push({
            type: "BEARISH_ORDER_BLOCK",
            direction: "SELL",
            high: obHigh,
            low: obLow,
            invalidationLevel: invalidation,
            candleIndex: i,
            displacementIndex: displacementIdx,
            displacement: Number(maxDisplacement.toFixed(5)),
            displacementAtrRatio: Number(displacementAtrRatio.toFixed(2)),
            hasStructuralBreak,
            isOriginSwing: isOriginHigh,
            tapCount,
            isMitigated,
            isInvalidated,
            isTappedNow,
            strength,
            timestamp: c.timestamp,
            evidence: [
              `Bearish OB [${obLow} - ${obHigh}]`,
              `Displacement -${displacementAtrRatio.toFixed(2)} ATR`,
              hasStructuralBreak ? "Confirmed BOS/Swing Break" : "Impulsive Departure",
              isMitigated ? `Mitigated (${tapCount} taps)` : `Unmitigated (${tapCount} taps)`
            ]
          });
        }
      }
    }
  }
  return detected.sort((a, b) => b.strength - a.strength);
}
function runOrderBlockConcept(moduleId, moduleName, ctx, directionFilter) {
  const enforceUnmitigated = moduleId === "unmitigated_zone" || ctx.compiledRules.unmitigated_zone !== false;
  let allObs = ctx.marketStructure._detectedOrderBlocks;
  if (!Array.isArray(allObs)) {
    allObs = detectOrderBlocks(ctx.sortedCandles, {
      atr: ctx.atr,
      pair: ctx.pair,
      currentPrice: ctx.currentPrice,
      swingHighs: ctx.swingHighs,
      swingLows: ctx.swingLows,
      fairValueGaps: ctx.marketStructure.fairValueGaps || [],
      bosList: ctx.marketStructure.BOS || [],
      chochList: ctx.marketStructure.CHOCH || [],
      enforceUnmitigated
    });
    ctx.marketStructure._detectedOrderBlocks = allObs;
  }
  const filtered = directionFilter ? allObs.filter((ob) => ob.direction === directionFilter) : allObs;
  const freshObs = enforceUnmitigated ? filtered.filter((ob) => !ob.isMitigated && !ob.isInvalidated) : filtered;
  const tappedObs = freshObs.filter((ob) => ob.isTappedNow);
  const bestOb = tappedObs[0] || freshObs[0];
  const zoneTapped = Boolean(
    tappedObs.length > 0 || ctx.marketStructure.zone_tapped === true || ctx.marketStructure.zone_status === "ZONE_TAPPED" || ctx.marketStructure.zone_status === "CONFIRMED"
  );
  const matched = freshObs.length > 0 || zoneTapped;
  let scoreOutOf10 = 0;
  if (zoneTapped) scoreOutOf10 = 10;
  else if (freshObs.length > 0) scoreOutOf10 = bestOb.strength >= 60 ? 8 : 7;
  const direction = bestOb ? bestOb.direction === "BUY" ? "BULLISH" : "BEARISH" : "NEUTRAL";
  return {
    moduleId,
    moduleName,
    category: "ZONE",
    activated: true,
    executed: true,
    matched,
    scoreOutOf10,
    direction,
    reason: bestOb ? `${moduleName}: Detected ${freshObs.length} unmitigated order block(s); top zone ${bestOb.type} [${bestOb.low} - ${bestOb.high}] (${bestOb.isTappedNow ? "TAPPED" : "WAITING_FOR_TAP"}).` : `${moduleName}: No qualifying unmitigated order block with displacement found in current price structure.`,
    evidence: bestOb ? bestOb.evidence : [],
    metrics: {
      totalDetected: filtered.length,
      unmitigatedCount: freshObs.length,
      tappedCount: tappedObs.length,
      topZoneStrength: bestOb?.strength ?? 0,
      topZoneDisplacementAtr: bestOb?.displacementAtrRatio ?? 0
    },
    structurePatch: {
      orderBlocks: freshObs,
      order_block: matched
    }
  };
}
const OrderBlockModule = {
  id: "order_block",
  name: "Order Block",
  category: "ZONE",
  aliases: ["order_block", "ob", "orderblock"],
  requiresSwings: true,
  requiresAtr: true,
  execute: (ctx) => runOrderBlockConcept("order_block", "Order Block", ctx)
};
const SupplyDemandModule = {
  id: "supply_demand",
  name: "Supply and Demand",
  category: "ZONE",
  aliases: ["supply_demand", "supply_and_demand"],
  requiresSwings: true,
  requiresAtr: true,
  execute: (ctx) => runOrderBlockConcept("supply_demand", "Supply and Demand", ctx)
};
const UnmitigatedZoneModule = {
  id: "unmitigated_zone",
  name: "Unmitigated Zone",
  category: "ZONE",
  aliases: ["unmitigated_zone", "unmitigated"],
  requiresSwings: true,
  requiresAtr: true,
  execute: (ctx) => runOrderBlockConcept("unmitigated_zone", "Unmitigated Zone", ctx)
};
const DemandZoneModule = {
  id: "demand_zone",
  name: "Demand Zone",
  category: "ZONE",
  aliases: ["demand_zone", "demand"],
  requiresSwings: true,
  requiresAtr: true,
  execute: (ctx) => runOrderBlockConcept("demand_zone", "Demand Zone", ctx, "BUY")
};
const SupplyZoneModule = {
  id: "supply_zone",
  name: "Supply Zone",
  category: "ZONE",
  aliases: ["supply_zone", "supply"],
  requiresSwings: true,
  requiresAtr: true,
  execute: (ctx) => runOrderBlockConcept("supply_zone", "Supply Zone", ctx, "SELL")
};
export {
  DemandZoneModule,
  OrderBlockModule,
  SupplyDemandModule,
  SupplyZoneModule,
  UnmitigatedZoneModule,
  detectOrderBlocks
};
