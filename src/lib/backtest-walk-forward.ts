/**
 * GAKS AI — Stage E3: Walk-Forward Validation Engine
 * Implements chronological rolling and anchored walk-forward optimization across history.
 * Parameter selection occurs strictly in-sample; candidate parameters are frozen before test window evaluation.
 */

import { ParsedCandle } from './backtest-csv.js';
import { runBacktest } from './backtest-engine.ts';
import { BacktestConfig, BacktestAnalyticsResult } from './backtest-types.js';

export interface WalkForwardWindowConfig {
  trainCandles: number;
  testCandles: number;
  stepCandles: number;
  windowType: 'rolling' | 'anchored';
  candidateParameters: Record<string, any>[]; // List of parameter combinations to evaluate in-sample
}

export interface WalkForwardWindowResult {
  windowIndex: number;
  trainRange: { start: string; end: string; candlesCount: number };
  testRange: { start: string; end: string; candlesCount: number };
  selectedParameters: Record<string, any>;
  trainAnalytics: BacktestAnalyticsResult;
  testAnalytics: BacktestAnalyticsResult;
  efficiencyRatio: number; // Test Net PnL / Train Net PnL
}

export interface WalkForwardResult {
  success: boolean;
  error?: string;
  status: 'PASS' | 'FAIL' | 'INSUFFICIENT_TRADES';
  windowType: 'rolling' | 'anchored';
  totalWindows: number;
  windowResults: WalkForwardWindowResult[];
  overallInSamplePnL: number;
  overallOutOfSamplePnL: number;
  walkForwardEfficiencyRatio: number | null; // null if insufficient trades
  combinedEquityCurve: { timestamp: string; balance: number }[];
  isPassed: boolean;
}

/**
 * Executes Walk-Forward Validation over a historical candle dataset.
 */
export async function runWalkForwardValidation(
  baseConfig: BacktestConfig,
  candles: ParsedCandle[],
  wfConfig: WalkForwardWindowConfig
): Promise<WalkForwardResult> {
  const { trainCandles, testCandles, stepCandles, windowType, candidateParameters } = wfConfig;

  if (!candles || candles.length < trainCandles + testCandles) {
    return {
      success: false,
      status: 'FAIL',
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

  const windowResults: WalkForwardWindowResult[] = [];
  let currentStart = 0;
  let windowIdx = 0;

  let combinedBalance = baseConfig.initialBalance;
  const combinedEquityCurve: { timestamp: string; balance: number }[] = [
    { timestamp: candles[0].timestamp, balance: combinedBalance }
  ];

  while (currentStart + trainCandles + testCandles <= candles.length) {
    windowIdx++;

    // 1. Determine Window Index Ranges
    const trainStartIdx = windowType === 'anchored' ? 0 : currentStart;
    const trainEndIdx = currentStart + trainCandles;
    const testStartIdx = trainEndIdx;
    const testEndIdx = testStartIdx + testCandles;

    const trainSlice = candles.slice(trainStartIdx, trainEndIdx);
    const testSlice = candles.slice(testStartIdx, testEndIdx);

    // 2. In-Sample Optimization: Find best parameter combination on trainSlice ONLY
    let bestTrainPnL = -Infinity;
    let bestParams: Record<string, number> = candidateParameters[0] || {};
    let bestTrainAnalytics: BacktestAnalyticsResult | null = null;

    const paramSets = candidateParameters.length > 0 ? candidateParameters : [{}];

    for (const params of paramSets) {
      const trainConfig: BacktestConfig = {
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
      // Fallback if no params produced valid run
      bestTrainAnalytics = {
        totalTrades: 0,
        winRate: 0,
        profitFactor: 0,
        netProfit: 0,
        returnPercent: 0,
        maxDrawdownPercent: 0,
        expectancyPips: 0
      } as any;
    }

    // 3. Out-of-Sample Evaluation: Run frozen bestParams on unseen testSlice
    const testConfig: BacktestConfig = {
      ...baseConfig,
      candles: testSlice,
      initialBalance: combinedBalance,
      startTime: testSlice[0].timestamp,
      endTime: testSlice[testSlice.length - 1].timestamp,
      strategyText: bestParams.strategyText ? String(bestParams.strategyText) : baseConfig.strategyText
    };

    const testRun = await runBacktest(testConfig);
    const testAnalytics = testRun.analytics || ({
      totalTrades: 0,
      winRate: 0,
      profitFactor: 0,
      netProfit: 0,
      returnPercent: 0,
      maxDrawdownPercent: 0,
      expectancyPips: 0
    } as any);

    // Update combined equity curve
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

    // Advance step size
    currentStart += stepCandles;
  }

  const overallInSamplePnL = windowResults.reduce((sum, w) => sum + w.trainAnalytics.netProfit, 0);
  const overallOutOfSamplePnL = windowResults.reduce((sum, w) => sum + w.testAnalytics.netProfit, 0);
  const totalWfTrades = windowResults.reduce((sum, w) => sum + w.testAnalytics.totalTrades, 0);

  if (totalWfTrades === 0) {
    return {
      success: true,
      status: 'INSUFFICIENT_TRADES',
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

  const walkForwardEfficiencyRatio =
    overallInSamplePnL !== 0 ? overallOutOfSamplePnL / Math.abs(overallInSamplePnL) : 0;

  // Criteria for PASS: Positive overall OOS PnL and Efficiency Ratio >= 0.35
  const isPassed = overallOutOfSamplePnL > 0 && walkForwardEfficiencyRatio >= 0.35;

  return {
    success: true,
    status: isPassed ? 'PASS' : 'FAIL',
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
