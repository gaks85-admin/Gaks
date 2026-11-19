function detectTrendlineBreakoutAndRetest(sortedCandles, swingHighs, swingLows, atr) {
  const trendlines = [];
  const breakouts = [];
  const retests = [];
  if (!sortedCandles || sortedCandles.length < 8) {
    return { trendlines, breakouts, retests };
  }
  const lastIdx = sortedCandles.length - 1;
  const effectiveAtr = atr > 0 ? atr : Math.max(1e-4, sortedCandles[lastIdx].close * 2e-3);
  const breakTolerance = effectiveAtr * 0.08;
  const retestBand = effectiveAtr * 0.55;
  if (swingHighs && swingHighs.length >= 2) {
    for (let idx = swingHighs.length - 1; idx >= 1; idx--) {
      const p2 = swingHighs[idx];
      const p1 = swingHighs[idx - 1];
      if (p2.price < p1.price && p2.index > p1.index) {
        const slope = (p2.price - p1.price) / (p2.index - p1.index);
        const project = (x) => p1.price + slope * (x - p1.index);
        trendlines.push({
          side: "DESCENDING_RESISTANCE",
          startIndex: p1.index,
          endIndex: p2.index,
          startPrice: p1.price,
          endPrice: p2.price,
          slope,
          projectedLatestPrice: Number(project(lastIdx).toFixed(5))
        });
        let breakoutIdx = -1;
        const scanStart = Math.max(p2.index + 1, lastIdx - 12);
        for (let k = scanStart; k <= lastIdx; k++) {
          const linePrice = project(k);
          const prevLinePrice = project(k - 1);
          if (sortedCandles[k - 1].close <= prevLinePrice + breakTolerance && sortedCandles[k].close > linePrice + breakTolerance) {
            breakoutIdx = k;
            breakouts.push({
              type: "UPPER_BREAKOUT",
              direction: "BULLISH",
              candleIndex: k,
              breakPrice: sortedCandles[k].close,
              trendlinePrice: Number(linePrice.toFixed(5)),
              evidence: `Candle ${k} closed at ${sortedCandles[k].close} above descending trendline (${linePrice.toFixed(5)})`
            });
            break;
          }
        }
        if (breakoutIdx !== -1 && breakoutIdx < lastIdx) {
          for (let r = breakoutIdx + 1; r <= lastIdx; r++) {
            const linePrice = project(r);
            if (sortedCandles[r].low <= linePrice + retestBand && sortedCandles[r].close >= linePrice - breakTolerance) {
              retests.push({
                type: "BULLISH_RETEST",
                candleIndex: r,
                levelPrice: Number(linePrice.toFixed(5)),
                confirmed: sortedCandles[r].close >= sortedCandles[r].open || sortedCandles[r].close > linePrice,
                evidence: `Retested broken descending trendline at ${linePrice.toFixed(5)} and held close ${sortedCandles[r].close}`
              });
              break;
            }
          }
        }
        break;
      }
    }
  }
  if (swingLows && swingLows.length >= 2) {
    for (let idx = swingLows.length - 1; idx >= 1; idx--) {
      const p2 = swingLows[idx];
      const p1 = swingLows[idx - 1];
      if (p2.price > p1.price && p2.index > p1.index) {
        const slope = (p2.price - p1.price) / (p2.index - p1.index);
        const project = (x) => p1.price + slope * (x - p1.index);
        trendlines.push({
          side: "ASCENDING_SUPPORT",
          startIndex: p1.index,
          endIndex: p2.index,
          startPrice: p1.price,
          endPrice: p2.price,
          slope,
          projectedLatestPrice: Number(project(lastIdx).toFixed(5))
        });
        let breakoutIdx = -1;
        const scanStart = Math.max(p2.index + 1, lastIdx - 12);
        for (let k = scanStart; k <= lastIdx; k++) {
          const linePrice = project(k);
          const prevLinePrice = project(k - 1);
          if (sortedCandles[k - 1].close >= prevLinePrice - breakTolerance && sortedCandles[k].close < linePrice - breakTolerance) {
            breakoutIdx = k;
            breakouts.push({
              type: "LOWER_BREAKOUT",
              direction: "BEARISH",
              candleIndex: k,
              breakPrice: sortedCandles[k].close,
              trendlinePrice: Number(linePrice.toFixed(5)),
              evidence: `Candle ${k} closed at ${sortedCandles[k].close} below ascending trendline (${linePrice.toFixed(5)})`
            });
            break;
          }
        }
        if (breakoutIdx !== -1 && breakoutIdx < lastIdx) {
          for (let r = breakoutIdx + 1; r <= lastIdx; r++) {
            const linePrice = project(r);
            if (sortedCandles[r].high >= linePrice - retestBand && sortedCandles[r].close <= linePrice + breakTolerance) {
              retests.push({
                type: "BEARISH_RETEST",
                candleIndex: r,
                levelPrice: Number(linePrice.toFixed(5)),
                confirmed: sortedCandles[r].close <= sortedCandles[r].open || sortedCandles[r].close < linePrice,
                evidence: `Retested broken ascending trendline at ${linePrice.toFixed(5)} and rejected lower to ${sortedCandles[r].close}`
              });
              break;
            }
          }
        }
        break;
      }
    }
  }
  return { trendlines, breakouts, retests };
}
function getOrComputeTrendline(ctx) {
  if (!ctx.marketStructure._trendlineAnalysis) {
    ctx.marketStructure._trendlineAnalysis = detectTrendlineBreakoutAndRetest(
      ctx.sortedCandles,
      ctx.swingHighs,
      ctx.swingLows,
      ctx.atr
    );
  }
  return ctx.marketStructure._trendlineAnalysis;
}
const TrendlineBreakoutModule = {
  id: "trendline_breakout",
  name: "Trendline Breakout",
  category: "STRUCTURE",
  aliases: ["trendline_breakout", "trendline"],
  requiresSwings: true,
  requiresAtr: true,
  execute: (ctx) => {
    const tl = getOrComputeTrendline(ctx);
    const latestBreak = tl.breakouts[tl.breakouts.length - 1];
    const matched = tl.breakouts.length > 0;
    const scoreOutOf10 = matched ? 10 : tl.trendlines.length > 0 ? 3 : 0;
    return {
      moduleId: "trendline_breakout",
      moduleName: "Trendline Breakout",
      category: "STRUCTURE",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10,
      direction: latestBreak ? latestBreak.direction : "NEUTRAL",
      reason: latestBreak ? latestBreak.evidence : `Fitted ${tl.trendlines.length} trendline(s) with no decisive breakout close yet.`,
      evidence: tl.breakouts.map((b) => b.evidence),
      metrics: {
        trendlineCount: tl.trendlines.length,
        breakoutCount: tl.breakouts.length,
        latestBreakoutType: latestBreak?.type || "NONE"
      },
      structurePatch: {
        trendlines: tl.trendlines,
        breakouts: tl.breakouts,
        retests: tl.retests,
        trendline_breakout: matched
      }
    };
  }
};
const BreakAndRetestModule = {
  id: "break_and_retest",
  name: "Break and Retest",
  category: "PRICE_ACTION",
  aliases: ["break_and_retest", "retest"],
  requiresSwings: true,
  requiresAtr: true,
  execute: (ctx) => {
    const tl = getOrComputeTrendline(ctx);
    const confirmedRetests = tl.retests.filter((r) => r.confirmed);
    const latest = confirmedRetests[confirmedRetests.length - 1] || tl.retests[tl.retests.length - 1];
    const matched = confirmedRetests.length > 0;
    return {
      moduleId: "break_and_retest",
      moduleName: "Break and Retest",
      category: "PRICE_ACTION",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10: matched ? 10 : latest ? 5 : 0,
      direction: latest ? latest.type === "BULLISH_RETEST" ? "BULLISH" : "BEARISH" : "NEUTRAL",
      reason: matched && latest ? latest.evidence : "No confirmed break-and-retest pattern detected.",
      evidence: confirmedRetests.map((r) => r.evidence),
      metrics: {
        retestCount: tl.retests.length,
        confirmedCount: confirmedRetests.length
      },
      structurePatch: {
        retests: tl.retests,
        break_and_retest: matched
      }
    };
  }
};
export {
  BreakAndRetestModule,
  TrendlineBreakoutModule,
  detectTrendlineBreakoutAndRetest
};
