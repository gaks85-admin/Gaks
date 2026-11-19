function detectLiquiditySweeps(sortedCandles, swingHighs, swingLows, atr, options = {}) {
  if (!sortedCandles || sortedCandles.length < 6) {
    return { pools: [], sweeps: [] };
  }
  const recentWindow = options.recentWindow ?? 6;
  const minRejectionWickRatio = options.minRejectionWickRatio ?? 0.2;
  const eqTolerance = Math.max(atr * 0.35, 1e-5);
  const pools = [];
  for (const sh of swingHighs || []) {
    const nearPool = pools.find((p) => p.side === "BUY_SIDE" && Math.abs(p.price - sh.price) <= eqTolerance);
    if (nearPool) {
      nearPool.touchCount++;
      nearPool.isEqualLevel = true;
      nearPool.price = Math.max(nearPool.price, sh.price);
    } else {
      pools.push({
        side: "BUY_SIDE",
        price: sh.price,
        candleIndex: sh.index,
        timestamp: sh.timestamp,
        isEqualLevel: false,
        touchCount: 1
      });
    }
  }
  for (const sl of swingLows || []) {
    const nearPool = pools.find((p) => p.side === "SELL_SIDE" && Math.abs(p.price - sl.price) <= eqTolerance);
    if (nearPool) {
      nearPool.touchCount++;
      nearPool.isEqualLevel = true;
      nearPool.price = Math.min(nearPool.price, sl.price);
    } else {
      pools.push({
        side: "SELL_SIDE",
        price: sl.price,
        candleIndex: sl.index,
        timestamp: sl.timestamp,
        isEqualLevel: false,
        touchCount: 1
      });
    }
  }
  const sweeps = [];
  const evalStart = Math.max(3, sortedCandles.length - recentWindow);
  const seenKeys = /* @__PURE__ */ new Set();
  for (let i = evalStart; i < sortedCandles.length; i++) {
    const c = sortedCandles[i];
    const range = Math.max(1e-6, c.high - c.low);
    for (const sh of swingHighs || []) {
      if (sh.index > i - 3) continue;
      let alreadyBrokenBefore = false;
      for (let b = sh.index + 1; b < i; b++) {
        if (sortedCandles[b].close > sh.price) {
          alreadyBrokenBefore = true;
          break;
        }
      }
      if (alreadyBrokenBefore) continue;
      if (c.high > sh.price && c.close < sh.price) {
        const upperWick = c.high - Math.max(c.open, c.close);
        const wickRatio = upperWick / range;
        const sweepDepth = c.high - sh.price;
        const sweepDepthAtr = atr > 0 ? sweepDepth / atr : 0;
        if (wickRatio >= minRejectionWickRatio) {
          const key = `HIGH_${i}_${sh.price.toFixed(5)}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            sweeps.push({
              type: "HIGH_SWEEP",
              direction: "BEARISH",
              price: c.high,
              candleIndex: i,
              levelPrice: sh.price,
              sweepDepth: Number(sweepDepth.toFixed(5)),
              sweepDepthAtr: Number(sweepDepthAtr.toFixed(2)),
              rejectionWickRatio: Number(wickRatio.toFixed(2)),
              rejectionEvidence: `Buy-side liquidity swept at ${c.high} above swing high ${sh.price}, closed back inside at ${c.close} (wick ${(wickRatio * 100).toFixed(0)}%).`
            });
          }
        }
      }
    }
    for (const sl of swingLows || []) {
      if (sl.index > i - 3) continue;
      let alreadyBrokenBefore = false;
      for (let b = sl.index + 1; b < i; b++) {
        if (sortedCandles[b].close < sl.price) {
          alreadyBrokenBefore = true;
          break;
        }
      }
      if (alreadyBrokenBefore) continue;
      if (c.low < sl.price && c.close > sl.price) {
        const lowerWick = Math.min(c.open, c.close) - c.low;
        const wickRatio = lowerWick / range;
        const sweepDepth = sl.price - c.low;
        const sweepDepthAtr = atr > 0 ? sweepDepth / atr : 0;
        if (wickRatio >= minRejectionWickRatio) {
          const key = `LOW_${i}_${sl.price.toFixed(5)}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            sweeps.push({
              type: "LOW_SWEEP",
              direction: "BULLISH",
              price: c.low,
              candleIndex: i,
              levelPrice: sl.price,
              sweepDepth: Number(sweepDepth.toFixed(5)),
              sweepDepthAtr: Number(sweepDepthAtr.toFixed(2)),
              rejectionWickRatio: Number(wickRatio.toFixed(2)),
              rejectionEvidence: `Sell-side liquidity swept at ${c.low} below swing low ${sl.price}, closed back inside at ${c.close} (wick ${(wickRatio * 100).toFixed(0)}%).`
            });
          }
        }
      }
    }
  }
  return { pools, sweeps };
}
const LiquiditySweepModule = {
  id: "liquidity_sweep",
  name: "Liquidity Sweep",
  category: "ZONE",
  aliases: ["liquidity_sweep", "liquidity"],
  requiresSwings: true,
  requiresAtr: true,
  execute: (ctx) => {
    const { pools, sweeps } = detectLiquiditySweeps(
      ctx.sortedCandles,
      ctx.swingHighs,
      ctx.swingLows,
      ctx.atr
    );
    const matched = sweeps.length > 0;
    const latestSweep = sweeps[sweeps.length - 1];
    const eqPools = pools.filter((p) => p.isEqualLevel);
    let scoreOutOf10 = 0;
    if (latestSweep) {
      scoreOutOf10 = latestSweep.rejectionWickRatio >= 0.45 ? 10 : 8;
    }
    return {
      moduleId: "liquidity_sweep",
      moduleName: "Liquidity Sweep",
      category: "ZONE",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10,
      direction: latestSweep ? latestSweep.direction : "NEUTRAL",
      reason: latestSweep ? latestSweep.rejectionEvidence : `No confirmed liquidity sweep & rejection across ${pools.length} resting pool(s).`,
      evidence: sweeps.map((s) => s.rejectionEvidence),
      metrics: {
        poolCount: pools.length,
        equalLiquidityPools: eqPools.length,
        sweepCount: sweeps.length,
        latestSweepType: latestSweep?.type || "NONE",
        latestSweepDepthAtr: latestSweep?.sweepDepthAtr ?? 0
      },
      structurePatch: {
        liquiditySweeps: sweeps,
        liquidityPools: pools,
        liquidity_sweep: matched
      }
    };
  }
};
export {
  LiquiditySweepModule,
  detectLiquiditySweeps
};
