function analyzeBosAndChoch(sortedCandles, swingHighs, swingLows, options = {}) {
  const detectBos = options.detectBos !== false;
  const detectChoch = options.detectChoch !== false;
  const closes = sortedCandles.map((c) => Number(c.close));
  const bosList = [];
  if (detectBos || detectChoch) {
    swingHighs.forEach((sh, shIdx) => {
      for (let j = sh.index + 1; j < sortedCandles.length; j++) {
        if (closes[j] > sh.price) {
          sh.isBroken = true;
          sh.brokenByIndex = j;
          if (detectBos) {
            bosList.push({
              type: "BULLISH_BOS",
              price: sh.price,
              candleIndex: j,
              evidence: `Candle at index ${j} (close: ${closes[j]}) closed above swing high at index ${sh.index} (price: ${sh.price})`,
              levelIndex: shIdx
            });
          }
          break;
        }
      }
    });
    swingLows.forEach((sl, slIdx) => {
      for (let j = sl.index + 1; j < sortedCandles.length; j++) {
        if (closes[j] < sl.price) {
          sl.isBroken = true;
          sl.brokenByIndex = j;
          if (detectBos) {
            bosList.push({
              type: "BEARISH_BOS",
              price: sl.price,
              candleIndex: j,
              evidence: `Candle at index ${j} (close: ${closes[j]}) closed below swing low at index ${sl.index} (price: ${sl.price})`,
              levelIndex: slIdx
            });
          }
          break;
        }
      }
    });
  }
  let preBreakTrend = "SIDEWAYS";
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const lastH = swingHighs[swingHighs.length - 1].price;
    const prevH = swingHighs[swingHighs.length - 2].price;
    const lastL = swingLows[swingLows.length - 1].price;
    const prevL = swingLows[swingLows.length - 2].price;
    if (lastH > prevH && lastL > prevL) preBreakTrend = "BULLISH";
    else if (lastH < prevH && lastL < prevL) preBreakTrend = "BEARISH";
  }
  const chochList = [];
  if (detectChoch && preBreakTrend !== "SIDEWAYS") {
    if (preBreakTrend === "BULLISH") {
      const protectedLow = swingLows[swingLows.length - 1];
      for (let j = protectedLow.index + 1; j < sortedCandles.length; j++) {
        if (closes[j] < protectedLow.price) {
          chochList.push({
            type: "BEARISH_CHOCH",
            price: protectedLow.price,
            candleIndex: j,
            evidence: `Bullish trend protected low at index ${protectedLow.index} (price: ${protectedLow.price}) broken by close at index ${j} (price: ${closes[j]})`
          });
          break;
        }
      }
    } else {
      const protectedHigh = swingHighs[swingHighs.length - 1];
      for (let j = protectedHigh.index + 1; j < sortedCandles.length; j++) {
        if (closes[j] > protectedHigh.price) {
          chochList.push({
            type: "BULLISH_CHOCH",
            price: protectedHigh.price,
            candleIndex: j,
            evidence: `Bearish trend protected high at index ${protectedHigh.index} (price: ${protectedHigh.price}) broken by close at index ${j} (price: ${closes[j]})`
          });
          break;
        }
      }
    }
  }
  let currentTrend = preBreakTrend;
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const lastHighObj = swingHighs[swingHighs.length - 1];
    const lastLowObj = swingLows[swingLows.length - 1];
    const prevLowObj = swingLows[swingLows.length - 2];
    const prevHighObj = swingHighs[swingHighs.length - 2];
    const latestClose = closes[closes.length - 1];
    const bearishBreakAfterSwings = bosList.some((b) => b.type === "BEARISH_BOS" && b.candleIndex > Math.max(lastHighObj.index, lastLowObj.index)) || chochList.some((c) => c.type === "BEARISH_CHOCH");
    const bullishBreakAfterSwings = bosList.some((b) => b.type === "BULLISH_BOS" && b.candleIndex > Math.max(lastHighObj.index, lastLowObj.index)) || chochList.some((c) => c.type === "BULLISH_CHOCH");
    if (preBreakTrend === "BULLISH") {
      const lowBroken = lastLowObj.isBroken || latestClose < lastLowObj.price || bearishBreakAfterSwings;
      if (lowBroken) {
        const brokeBothLows = prevLowObj.isBroken || latestClose < prevLowObj.price;
        currentTrend = brokeBothLows ? "BEARISH" : "SIDEWAYS";
      }
    } else if (preBreakTrend === "BEARISH") {
      const highBroken = lastHighObj.isBroken || latestClose > lastHighObj.price || bullishBreakAfterSwings;
      if (highBroken) {
        const brokeBothHighs = prevHighObj.isBroken || latestClose > prevHighObj.price;
        currentTrend = brokeBothHighs ? "BULLISH" : "SIDEWAYS";
      }
    }
  }
  return { BOS: bosList, CHOCH: chochList, trend: currentTrend, preBreakTrend };
}
function getOrComputeStructureBreaks(ctx, needBos, needChoch) {
  const existing = ctx.marketStructure._structureBreakAnalysis;
  if (existing && (!needBos || ctx.marketStructure._bosComputed) && (!needChoch || ctx.marketStructure._chochComputed)) {
    return existing;
  }
  const analysis = analyzeBosAndChoch(ctx.sortedCandles, ctx.swingHighs, ctx.swingLows, {
    detectBos: needBos || Boolean(ctx.marketStructure._bosComputed),
    detectChoch: needChoch || Boolean(ctx.marketStructure._chochComputed)
  });
  ctx.marketStructure._structureBreakAnalysis = analysis;
  if (needBos) ctx.marketStructure._bosComputed = true;
  if (needChoch) ctx.marketStructure._chochComputed = true;
  return analysis;
}
const BosModule = {
  id: "bos",
  name: "BOS",
  category: "STRUCTURE",
  aliases: ["bos", "break_of_structure"],
  requiresSwings: true,
  requiresAtr: false,
  execute: (ctx) => {
    const analysis = getOrComputeStructureBreaks(ctx, true, Boolean(ctx.compiledRules.choch));
    const latestBos = analysis.BOS[analysis.BOS.length - 1];
    const matched = analysis.BOS.length > 0;
    const direction = latestBos ? latestBos.type === "BULLISH_BOS" ? "BULLISH" : "BEARISH" : analysis.trend === "SIDEWAYS" ? "NEUTRAL" : analysis.trend;
    return {
      moduleId: "bos",
      moduleName: "BOS",
      category: "STRUCTURE",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10: matched ? 10 : 0,
      direction,
      reason: latestBos ? `Confirmed ${analysis.BOS.length} Break(s) of Structure; latest: ${latestBos.evidence}` : "No Break of Structure (BOS) detected in swing sequence.",
      evidence: analysis.BOS.slice(-3).map((b) => b.evidence),
      metrics: {
        bosCount: analysis.BOS.length,
        latestType: latestBos?.type || "NONE",
        structuralTrend: analysis.trend
      },
      structurePatch: {
        BOS: analysis.BOS,
        trend: analysis.trend,
        bos: matched
      }
    };
  }
};
const ChochModule = {
  id: "choch",
  name: "CHOCH",
  category: "STRUCTURE",
  aliases: ["choch", "change_of_character"],
  requiresSwings: true,
  requiresAtr: false,
  execute: (ctx) => {
    const analysis = getOrComputeStructureBreaks(ctx, Boolean(ctx.compiledRules.bos), true);
    const latestChoch = analysis.CHOCH[analysis.CHOCH.length - 1];
    const matched = analysis.CHOCH.length > 0;
    const direction = latestChoch ? latestChoch.type === "BULLISH_CHOCH" ? "BULLISH" : "BEARISH" : "NEUTRAL";
    return {
      moduleId: "choch",
      moduleName: "CHOCH",
      category: "STRUCTURE",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10: matched ? 10 : 0,
      direction,
      reason: latestChoch ? `Confirmed Change of Character (${latestChoch.type}): ${latestChoch.evidence}` : "No Change of Character (CHOCH) reversal break detected.",
      evidence: analysis.CHOCH.map((c) => c.evidence),
      metrics: {
        chochCount: analysis.CHOCH.length,
        latestType: latestChoch?.type || "NONE",
        preBreakTrend: analysis.preBreakTrend,
        structuralTrend: analysis.trend
      },
      structurePatch: {
        CHOCH: analysis.CHOCH,
        trend: analysis.trend,
        choch: matched
      }
    };
  }
};
export {
  BosModule,
  ChochModule,
  analyzeBosAndChoch
};
