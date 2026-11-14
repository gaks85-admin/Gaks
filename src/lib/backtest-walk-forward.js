import { runBacktest } from "./backtest-engine.ts";
async function runWalkForwardValidation(baseConfig, candles, wfConfig) {
  const { trainCandles, testCandles, stepCandles, windowType, candidateParameters } = wfConfig;
  if (!candles || candles.length < trainCandles + testCandles) {
    return {
      success: false,
      status: "FAIL",
      error: `Insufficient historical candles (${candles?.length || 0}) for required train (${trainCandles}) + test (${testCandles}) window size.`,
      windowType,
      totalWindows: 0,
      windowResults: [],
      overallInSamplePnL: 0,
      overallOutOfSamplePnL: 0,
      walkForwardEfficiencyRatio: 0,
      combinedEquityCurve: [],
      isPassed: false
    };
  }
  const windowResults = [];
  let currentStart = 0;
  let windowIdx = 0;
  let combinedBalance = baseConfig.initialBalance;
  const combinedEquityCurve = [
    { timestamp: candles[0].timestamp, balance: combinedBalance }
  ];
  while (currentStart + trainCandles + testCandles <= candles.length) {
    windowIdx++;
    const trainStartIdx = windowType === "anchored" ? 0 : currentStart;
    const trainEndIdx = currentStart + trainCandles;
    const testStartIdx = trainEndIdx;
    const testEndIdx = testStartIdx + testCandles;
    const trainSlice = candles.slice(trainStartIdx, trainEndIdx);
    const testSlice = candles.slice(testStartIdx, testEndIdx);
    let bestTrainPnL = -Infinity;
    let bestParams = candidateParameters[0] || {};
    let bestTrainAnalytics = null;
    const paramSets = candidateParameters.length > 0 ? candidateParameters : [{}];
    for (const params of paramSets) {
      const trainConfig = {
        ...baseConfig,
        candles: trainSlice,
        startTime: trainSlice[0].timestamp,
        endTime: trainSlice[trainSlice.length - 1].timestamp,
        strategyText: params.strategyText ? String(params.strategyText) : baseConfig.strategyText
      };
      const trainRun = await runBacktest(trainConfig);
      if (trainRun.success && trainRun.analytics) {
        if (trainRun.analytics.netProfit > bestTrainPnL) {
          bestTrainPnL = trainRun.analytics.netProfit;
          bestParams = params;
          bestTrainAnalytics = trainRun.analytics;
        }
      }
    }
    if (!bestTrainAnalytics) {
      bestTrainAnalytics = {
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0,
        netProfit: 0,
        returnPercent: 0,
        maxDrawdownPercent: 0,
        expectancyPips: 0
      };
    }
    const testConfig = {
      ...baseConfig,
      candles: testSlice,
      initialBalance: combinedBalance,
      startTime: testSlice[0].timestamp,
      endTime: testSlice[testSlice.length - 1].timestamp,
      strategyText: bestParams.strategyText ? String(bestParams.strategyText) : baseConfig.strategyText
    };
    const testRun = await runBacktest(testConfig);
    const testAnalytics = testRun.analytics || {
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      netProfit: 0,
      returnPercent: 0,
      maxDrawdownPercent: 0,
      expectancyPips: 0
    };
    combinedBalance += testAnalytics.netProfit;
    combinedEquityCurve.push({
      timestamp: testSlice[testSlice.length - 1].timestamp,
      balance: combinedBalance
    });
    const efficiencyRatio = bestTrainPnL > 0 ? testAnalytics.netProfit / bestTrainPnL : 0;
    windowResults.push({
      windowIndex: windowIdx,
      trainRange: {
        start: trainSlice[0].timestamp,
        end: trainSlice[trainSlice.length - 1].timestamp,
        candlesCount: trainSlice.length
      },
      testRange: {
        start: testSlice[0].timestamp,
        end: testSlice[testSlice.length - 1].timestamp,
        candlesCount: testSlice.length
      },
      selectedParameters: bestParams,
      trainAnalytics: bestTrainAnalytics,
      testAnalytics,
      efficiencyRatio
    });
    currentStart += stepCandles;
  }
  const overallInSamplePnL = windowResults.reduce((sum, w) => sum + w.trainAnalytics.netProfit, 0);
  const overallOutOfSamplePnL = windowResults.reduce((sum, w) => sum + w.testAnalytics.netProfit, 0);
  const totalWfTrades = windowResults.reduce((sum, w) => sum + w.testAnalytics.totalTrades, 0);
  if (totalWfTrades === 0) {
    return {
      success: true,
      status: "INSUFFICIENT_TRADES",
      windowType,
      totalWindows: windowResults.length,
      windowResults,
      overallInSamplePnL,
      overallOutOfSamplePnL,
      walkForwardEfficiencyRatio: null,
      combinedEquityCurve,
      isPassed: false
    };
  }
  const walkForwardEfficiencyRatio = overallInSamplePnL !== 0 ? overallOutOfSamplePnL / Math.abs(overallInSamplePnL) : 0;
  const isPassed = overallOutOfSamplePnL > 0 && walkForwardEfficiencyRatio >= 0.35;
  return {
    success: true,
    status: isPassed ? "PASS" : "FAIL",
    windowType,
    totalWindows: windowResults.length,
    windowResults,
    overallInSamplePnL,
    overallOutOfSamplePnL,
    walkForwardEfficiencyRatio,
    combinedEquityCurve,
    isPassed
  };
}
export {
  runWalkForwardValidation
};
