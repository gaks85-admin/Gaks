import { runBacktest } from "./backtest-engine.ts";
async function runRobustnessSuite(baseConfig, candles) {
  const baselineRun = await runBacktest({
    ...baseConfig,
    candles,
    simulation: {
      ...baseConfig.simulation,
      stress: void 0
    }
  });
  const baselineAnalytics = baselineRun.analytics || {
    netProfit: 0,
    returnPercent: 0,
    winRate: 0,
    profitFactor: 0,
    maxDrawdownPercent: 0
  };
  if (baselineRun.tradesCompleted === 0) {
    return {
      baselineAnalytics,
      scenarios: [],
      robustnessIndex: 0,
      breakEvenMultiplier: null,
      isFragile: false,
      status: "INSUFFICIENT_TRADES",
      isPassed: false,
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
  }
  const baselinePnL = baselineAnalytics.netProfit;
  const multipliers = [1.25, 1.5, 2, 3];
  const scenarios = [];
  let breakEvenMultiplier = 1;
  let profitableScenarioCount = 0;
  let failsAt1_5 = false;
  for (const mult of multipliers) {
    const stressConfig = {
      spreadMultiplier: mult,
      slippageMultiplier: mult,
      commissionMultiplier: mult,
      swapMultiplier: mult
    };
    const stressedRun = await runBacktest({
      ...baseConfig,
      candles,
      simulation: {
        ...baseConfig.simulation,
        stress: stressConfig
      }
    });
    const stressedAnalytics = stressedRun.analytics || {
      netProfit: 0,
      returnPercent: 0,
      winRate: 0,
      profitFactor: 0,
      maxDrawdownPercent: 0
    };
    const stressedPnL = stressedAnalytics.netProfit;
    const isProfitable = stressedPnL > 0;
    if (isProfitable) {
      profitableScenarioCount++;
      breakEvenMultiplier = mult;
    } else if (mult === 1.5) {
      failsAt1_5 = true;
    }
    const pnlDegradationPercent = baselinePnL !== 0 ? (baselinePnL - stressedPnL) / Math.abs(baselinePnL) * 100 : 0;
    scenarios.push({
      scenarioName: `Cost Multiplier ${mult.toFixed(2)}x`,
      multiplier: mult,
      stressConfig,
      analytics: stressedAnalytics,
      pnlDegradationPercent,
      isProfitable
    });
  }
  const robustnessIndex = Math.round(profitableScenarioCount / multipliers.length * 100);
  const isFragile = failsAt1_5;
  const isPassed = !isFragile && robustnessIndex >= 50;
  return {
    baselineAnalytics,
    scenarios,
    robustnessIndex,
    breakEvenMultiplier,
    isFragile,
    status: isPassed ? "PASS" : "FAIL",
    isPassed,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
}
export {
  runRobustnessSuite
};
