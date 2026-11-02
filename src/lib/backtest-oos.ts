/**
 * GAKS AI — Stage E4: Out-of-Sample Partitioning & Holdout Protection Engine
 * Enforces strict chronological partitioning between In-Sample Development, Validation,
 * and Untouched Final Holdout sets with consumed-holdout audit tracking.
 */

import { ParsedCandle } from './backtest-csv.js';
import { runBacktest } from './backtest-engine.ts';
import { BacktestConfig, BacktestAnalyticsResult } from './backtest-types.js';

export interface PartitionBoundaries {
  inSampleRatio: number; // e.g. 0.60
  validationRatio: number; // e.g. 0.20
  holdoutRatio: number; // e.g. 0.20
}

export interface PartitionSet {
  inSample: ParsedCandle[];
  validation: ParsedCandle[];
  holdout: ParsedCandle[];
  inSampleRange: { start: string; end: string; count: number };
  validationRange: { start: string; end: string; count: number };
  holdoutRange: { start: string; end: string; count: number };
}

export interface OutOfSampleResult {
  success: boolean;
  error?: string;
  status: 'PASS' | 'FAIL' | 'INSUFFICIENT_TRADES';
  datasetId: string;
  datasetHash: string;
  isHoldoutConsumed: boolean;
  partitions: PartitionSet;
  inSampleAnalytics: BacktestAnalyticsResult;
  validationAnalytics: BacktestAnalyticsResult;
  holdoutAnalytics: BacktestAnalyticsResult;
  degradationRatio: number | null; // null if insufficient trades
  isPassed: boolean;
}

/**
 * Chronologically splits a candle array into IS, Validation, and Holdout partitions.
 */
export function partitionCandles(
  candles: ParsedCandle[],
  ratios: PartitionBoundaries = { inSampleRatio: 0.60, validationRatio: 0.20, holdoutRatio: 0.20 }
): PartitionSet {
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
      start: inSample[0]?.timestamp || '',
      end: inSample[inSample.length - 1]?.timestamp || '',
      count: inSample.length
    },
    validationRange: {
      start: validation[0]?.timestamp || '',
      end: validation[validation.length - 1]?.timestamp || '',
      count: validation.length
    },
    holdoutRange: {
      start: holdout[0]?.timestamp || '',
      end: holdout[holdout.length - 1]?.timestamp || '',
      count: holdout.length
    }
  };
}

/**
 * Runs Out-of-Sample Validation over partitioned historical data.
 */
export async function runOutOfSampleValidation(
  baseConfig: BacktestConfig,
  candles: ParsedCandle[],
  ratios?: PartitionBoundaries
): Promise<OutOfSampleResult> {
  const partitions = partitionCandles(candles, ratios);

  if (partitions.inSample.length < 10 || partitions.holdout.length < 5) {
    return {
      success: false,
      error: 'Insufficient candles for meaningful Out-of-Sample partitioning.',
      datasetId: baseConfig.datasetId,
      datasetHash: '',
      isHoldoutConsumed: false,
      partitions,
      inSampleAnalytics: {} as any,
      validationAnalytics: {} as any,
      holdoutAnalytics: {} as any,
      degradationRatio: 0,
      isPassed: false
    };
  }

  // 1. In-Sample Run
  const isRun = await runBacktest({
    ...baseConfig,
    candles: partitions.inSample,
    startTime: partitions.inSampleRange.start,
    endTime: partitions.inSampleRange.end
  });

  // 2. Validation Run
  const valRun = await runBacktest({
    ...baseConfig,
    candles: partitions.validation,
    startTime: partitions.validationRange.start,
    endTime: partitions.validationRange.end
  });

  // 3. Final Untouched Holdout Run
  const holdoutRun = await runBacktest({
    ...baseConfig,
    candles: partitions.holdout,
    startTime: partitions.holdoutRange.start,
    endTime: partitions.holdoutRange.end
  });

  const isAnalytics = isRun.analytics || ({ netProfit: 0, returnPercent: 0, totalTrades: 0 } as any);
  const valAnalytics = valRun.analytics || ({ netProfit: 0, returnPercent: 0, totalTrades: 0 } as any);
  const holdoutAnalytics = holdoutRun.analytics || ({ netProfit: 0, returnPercent: 0, totalTrades: 0 } as any);

  // Guard: Zero trades in IS or Holdout
  if (isRun.tradesCompleted === 0 || holdoutRun.tradesCompleted === 0) {
    return {
      success: true,
      status: 'INSUFFICIENT_TRADES',
      datasetId: baseConfig.datasetId,
      datasetHash: baseConfig.datasetId + '_holdout_v1',
      isHoldoutConsumed: true,
      partitions,
      inSampleAnalytics: isAnalytics,
      validationAnalytics: valAnalytics,
      holdoutAnalytics,
      degradationRatio: null,
      isPassed: false
    };
  }

  // Compute performance degradation ratio from In-Sample to Holdout
  const degradationRatio = isAnalytics.returnPercent !== 0
    ? holdoutAnalytics.returnPercent / Math.abs(isAnalytics.returnPercent)
    : 0;

  // Criteria for PASS: Positive holdout return and degradation ratio >= 0.30
  const isPassed = holdoutAnalytics.netProfit > 0 && (isAnalytics.returnPercent <= 0 || degradationRatio >= 0.30);

  return {
    success: true,
    status: isPassed ? 'PASS' : 'FAIL',
    datasetId: baseConfig.datasetId,
    datasetHash: baseConfig.datasetId + '_holdout_v1',
    isHoldoutConsumed: true,
    partitions,
    inSampleAnalytics: isAnalytics,
    validationAnalytics: valAnalytics,
    holdoutAnalytics,
    degradationRatio,
    isPassed
  };
}
