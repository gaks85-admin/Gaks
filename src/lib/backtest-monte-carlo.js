function createMulberry32(seed) {
  let a = seed >>> 0;
  return function() {
    let t = a += 1831565813;
    t = Math.imul(t ^ t >>> 15, t | 1);
    t ^= t + Math.imul(t ^ t >>> 7, t | 61);
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
function getPercentile(sortedValues, percentile) {
  if (sortedValues.length === 0) return 0;
  const index = Math.floor(percentile / 100 * (sortedValues.length - 1));
  return sortedValues[index];
}
function runMonteCarloSimulation(trades, config) {
  const { iterations, initialBalance, samplingMethod, ruinThresholdPercent, seed } = config;
  if (!trades || trades.length < 5) {
    return {
      iterationsExecuted: 0,
      samplingMethod,
      seedUsed: seed,
      finalEquity: { p5: initialBalance, p50: initialBalance, p95: initialBalance },
      maxDrawdownPercent: { p5: 0, p50: 0, p95: 0 },
      maxLosingStreak: { p5: 0, p50: 0, p95: 0 },
      riskOfRuinPercent: null,
      status: "INSUFFICIENT_TRADES",
      sampleSimulatedCurves: [],
      isPassed: false,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  const random = createMulberry32(seed);
  const tradePnLs = trades.map((t) => t.netPnL);
  const N = tradePnLs.length;
  const finalEquities = [];
  const maxDrawdowns = [];
  const maxLosingStreaks = [];
  let ruinCount = 0;
  const sampleSimulatedCurves = [];
  for (let iter = 0; iter < iterations; iter++) {
    let sampledPnLs = [];
    if (samplingMethod === "RESHUFFLE") {
      sampledPnLs = [...tradePnLs];
      for (let i = N - 1; i > 0; i--) {
        const j = Math.floor(random() * (i + 1));
        [sampledPnLs[i], sampledPnLs[j]] = [sampledPnLs[j], sampledPnLs[i]];
      }
    } else {
      for (let i = 0; i < N; i++) {
        const idx = Math.floor(random() * N);
        sampledPnLs.push(tradePnLs[idx]);
      }
    }
    let currentBalance = initialBalance;
    let peakBalance = initialBalance;
    let maxDd = 0;
    let currentStreak = 0;
    let maxStreak = 0;
    const equityCurve = [initialBalance];
    for (const pnl of sampledPnLs) {
      currentBalance += pnl;
      equityCurve.push(currentBalance);
      if (currentBalance > peakBalance) {
        peakBalance = currentBalance;
      }
      const dd = peakBalance > 0 ? (peakBalance - currentBalance) / peakBalance * 100 : 0;
      if (dd > maxDd) {
        maxDd = dd;
      }
      if (pnl < 0) {
        currentStreak++;
        if (currentStreak > maxStreak) {
          maxStreak = currentStreak;
        }
      } else {
        currentStreak = 0;
      }
    }
    finalEquities.push(currentBalance);
    maxDrawdowns.push(maxDd);
    maxLosingStreaks.push(maxStreak);
    if (maxDd >= ruinThresholdPercent) {
      ruinCount++;
    }
    if (iter < 5) {
      sampleSimulatedCurves.push({ iteration: iter + 1, equityCurve });
    }
  }
  finalEquities.sort((a, b) => a - b);
  maxDrawdowns.sort((a, b) => a - b);
  maxLosingStreaks.sort((a, b) => a - b);
  const riskOfRuinPercent = ruinCount / iterations * 100;
  const isPassed = riskOfRuinPercent < 5 && getPercentile(finalEquities, 50) >= initialBalance;
  return {
    iterationsExecuted: iterations,
    samplingMethod,
    seedUsed: seed,
    finalEquity: {
      p5: getPercentile(finalEquities, 5),
      p50: getPercentile(finalEquities, 50),
      p95: getPercentile(finalEquities, 95)
    },
    maxDrawdownPercent: {
      p5: getPercentile(maxDrawdowns, 5),
      p50: getPercentile(maxDrawdowns, 50),
      p95: getPercentile(maxDrawdowns, 95)
    },
    maxLosingStreak: {
      p5: getPercentile(maxLosingStreaks, 5),
      p50: getPercentile(maxLosingStreaks, 50),
      p95: getPercentile(maxLosingStreaks, 95)
    },
    riskOfRuinPercent,
    status: isPassed ? "PASS" : "FAIL",
    sampleSimulatedCurves,
    isPassed,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
}
export {
  createMulberry32,
  runMonteCarloSimulation
};
