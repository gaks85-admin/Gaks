import { runBacktest } from "./backtest-engine.ts";
function partitionCandles(candles, ratios = { inSampleRatio: 0.6, validationRatio: 0.2, holdoutRatio: 0.2 }) {
  const sorted = [...candles].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const total = sorted.length;
  const inSampleCount = Math.floor(total * ratios.inSampleRatio);
  const valCount = Math.floor(total * ratios.validationRatio);
  const inSample = sorted.slice(0, inSampleCount);
  const validation = sorted.slice(inSampleCount, inSampleCount + valCount);
  const holdout = sorted.slice(inSampleCount + valCount);
  return {
    inSample,
    validation,
    holdout,
    inSampleRange: {
      start: inSample[0]?.timestamp || "",
      end: inSample[inSample.length - 1]?.timestamp || "",
      count: inSample.length
    },
    validationRange: {
      start: validation[0]?.timestamp || "",
      end: validation[validation.length - 1]?.timestamp || "",
      count: validation.length
    },
    holdoutRange: {
      start: holdout[0]?.timestamp || "",
      end: holdout[holdout.length - 1]?.timestamp || "",
      count: holdout.length
    }
  };
}
async function runOutOfSampleValidation(baseConfig, candles, ratios) {
  const partitions = partitionCandles(candles, ratios);
  if (partitions.inSample.length < 10 || partitions.holdout.length < 5) {
    return {
      success: false,
      status: "FAIL",
      error: "Insufficient candles for meaningful Out-of-Sample partitioning.",
      datasetId: baseConfig.datasetId,
      datasetHash: "",
      isHoldoutConsumed: false,
      partitions,
      inSampleAnalytics: {},
      validationAnalytics: {},
      holdoutAnalytics: {},
      degradationRatio: 0,
      isPassed: false
    };
  }
  const isRun = await runBacktest({
    ...baseConfig,
    candles: partitions.inSample,
    startTime: partitions.inSampleRange.start,
    endTime: partitions.inSampleRange.end
  });
  const valRun = await runBacktest({
    ...baseConfig,
    candles: partitions.validation,
    startTime: partitions.validationRange.start,
    endTime: partitions.validationRange.end
  });
  const holdoutRun = await runBacktest({
    ...baseConfig,
    candles: partitions.holdout,
    startTime: partitions.holdoutRange.start,
    endTime: partitions.holdoutRange.end
  });
  const isAnalytics = isRun.analytics || { netProfit: 0, returnPercent: 0, totalTrades: 0 };
  const valAnalytics = valRun.analytics || { netProfit: 0, returnPercent: 0, totalTrades: 0 };
  const holdoutAnalytics = holdoutRun.analytics || { netProfit: 0, returnPercent: 0, totalTrades: 0 };
  if (isRun.tradesCompleted === 0 || holdoutRun.tradesCompleted === 0) {
    return {
      success: true,
      status: "INSUFFICIENT_TRADES",
      datasetId: baseConfig.datasetId,
      datasetHash: baseConfig.datasetId + "_holdout_v1",
      isHoldoutConsumed: true,
      partitions,
      inSampleAnalytics: isAnalytics,
      validationAnalytics: valAnalytics,
      holdoutAnalytics,
      degradationRatio: null,
      isPassed: false
    };
  }
  const degradationRatio = isAnalytics.returnPercent !== 0 ? holdoutAnalytics.returnPercent / Math.abs(isAnalytics.returnPercent) : 0;
  const isPassed = holdoutAnalytics.netProfit > 0 && (isAnalytics.returnPercent <= 0 || degradationRatio >= 0.3);
  return {
    success: true,
    status: isPassed ? "PASS" : "FAIL",
    datasetId: baseConfig.datasetId,
    datasetHash: baseConfig.datasetId + "_holdout_v1",
    isHoldoutConsumed: true,
    partitions,
    inSampleAnalytics: isAnalytics,
    validationAnalytics: valAnalytics,
    holdoutAnalytics,
    degradationRatio,
    isPassed
  };
}
export {
  partitionCandles,
  runOutOfSampleValidation
};
