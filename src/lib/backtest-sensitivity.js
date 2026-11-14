import { runBacktest } from "./backtest-engine.ts";
async function runParameterSensitivityAnalysis(baseConfig, candles) {
  const baselineRun = await runBacktest({
    ...baseConfig,
    candles
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
      perturbationPoints: [],
      maxPerformanceDropPercent: 0,
      cliffCount: 0,
      isOverfitRisk: false,
      sensitivityScore: null,
      status: "INSUFFICIENT_TRADES",
      isPassed: false
    };
  }
  const baselinePnL = baselineAnalytics.netProfit;
  const perturbations = [
    {
      parameterName: "Quality Gate Threshold",
      baselineValue: 75,
      testValues: [65, 70, 80, 85]
    },
    {
      parameterName: "Risk % per trade",
      baselineValue: 1,
      testValues: [0.8, 0.9, 1.1, 1.2]
    }
  ];
  const perturbationPoints = [];
  let cliffCount = 0;
  let maxDrop = 0;
  for (const pert of perturbations) {
    for (const testVal of pert.testValues) {
      const deltaPercent = (testVal - pert.baselineValue) / pert.baselineValue * 100;
      const perturbedConfig = {
        ...baseConfig,
        candles,
        simulation: {
          ...baseConfig.simulation,
          riskPercent: pert.parameterName === "Risk % per trade" ? testVal : baseConfig.simulation?.riskPercent || 1,
          qualityGateThreshold: pert.parameterName === "Quality Gate Threshold" ? testVal : baseConfig.simulation?.qualityGateThreshold || 75,
          enforceQualityGate: true
        }
      };
      const pertRun = await runBacktest(perturbedConfig);
      const pertAnalytics = pertRun.analytics || {
        netProfit: 0,
        returnPercent: 0,
        winRate: 0,
        profitFactor: 0,
        maxDrawdownPercent: 0
      };
      const pertPnL = pertAnalytics.netProfit;
      const dropFromBaseline = baselinePnL !== 0 ? (baselinePnL - pertPnL) / Math.abs(baselinePnL) * 100 : 0;
      if (dropFromBaseline > maxDrop) {
        maxDrop = dropFromBaseline;
      }
      const isPerformanceCliff = dropFromBaseline > 35;
      if (isPerformanceCliff) {
        cliffCount++;
      }
      perturbationPoints.push({
        parameterName: pert.parameterName,
        value: testVal,
        deltaPercent,
        analytics: pertAnalytics,
        dropFromBaselinePercent: dropFromBaseline,
        isPerformanceCliff
      });
    }
  }
  const isOverfitRisk = cliffCount > 1 || maxDrop > 50;
  const sensitivityScore = Math.max(0, Math.min(100, Math.round(100 - maxDrop)));
  const isPassed = !isOverfitRisk && sensitivityScore >= 50;
  return {
    baselineAnalytics,
    perturbationPoints,
    maxPerformanceDropPercent: maxDrop,
    cliffCount,
    isOverfitRisk,
    sensitivityScore,
    status: isPassed ? "PASS" : "FAIL",
    isPassed
  };
}
export {
  runParameterSensitivityAnalysis
};
