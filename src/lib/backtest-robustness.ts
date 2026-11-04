/**
 * GAKS AI — Stage E8: Multi-Scenario Execution Robustness Suite
 * Evaluates strategy resilience across multi-cost scenarios (spread, slippage, commission, swap multipliers)
 * and determines the Break-Even Cost Multiplier and Robustness Index.
 */

import { ParsedCandle } from './backtest-csv.js';
import { runBacktest } from './backtest-engine.ts';
import { BacktestConfig, BacktestAnalyticsResult, ExecutionStressConfig } from './backtest-types.js';

export interface RobustnessScenarioResult {
  scenarioName: string;
  multiplier: number;
  stressConfig: ExecutionStressConfig;
  analytics: BacktestAnalyticsResult;
  pnlDegradationPercent: number;
  isProfitable: boolean;
}

export interface RobustnessReport {
  baselineAnalytics: BacktestAnalyticsResult;
  scenarios: RobustnessScenarioResult[];
  robustnessIndex: number; // % of scenarios that remain profitable (0-100)
  breakEvenMultiplier: number | null; // Maximum cost multiplier before PnL turns negative
  isFragile: boolean; // True if fails at 1.5x cost multiplier
  status: 'PASS' | 'FAIL' | 'INSUFFICIENT_TRADES';
  isPassed: boolean;
  passed?: boolean;
  timestamp: string;
}

/**
 * Runs Multi-Scenario Execution Robustness Testing.
 */
export async function runRobustnessSuite(
  baseConfig: BacktestConfig,
  candles: ParsedCandle[]
): Promise<RobustnessReport> {
  // 1. Run Baseline (1.0x costs)
  const baselineRun = await runBacktest({
    ...baseConfig,
    candles,
    simulation: {
      ...baseConfig.simulation,
      stress: undefined
    }
  });

  const baselineAnalytics = baselineRun.analytics || ({
    netProfit: 0,
    returnPercent: 0,
    winRate: 0,
    profitFactor: 0,
    maxDrawdownPercent: 0
  } as any);

  // Guard: Zero trades in baseline
  if (baselineRun.tradesCompleted === 0) {
    return {
      baselineAnalytics,
      scenarios: [],
      robustnessIndex: 0,
      breakEvenMultiplier: null,
      isFragile: false,
      status: 'INSUFFICIENT_TRADES',
      isPassed: false,
      timestamp: new Date().toISOString()
    };
  }

  const baselinePnL = baselineAnalytics.netProfit;

  // 2. Define Cost Scenarios
  const multipliers = [1.25, 1.50, 2.00, 3.00];
  const scenarios: RobustnessScenarioResult[] = [];

  let breakEvenMultiplier = 1.0;
  let profitableScenarioCount = 0;
  let failsAt1_5 = false;

  for (const mult of multipliers) {
    const stressConfig: ExecutionStressConfig = {
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

    const stressedAnalytics = stressedRun.analytics || ({
      netProfit: 0,
      returnPercent: 0,
      winRate: 0,
      profitFactor: 0,
      maxDrawdownPercent: 0
    } as any);

    const stressedPnL = stressedAnalytics.netProfit;
    const isProfitable = stressedPnL > 0;

    if (isProfitable) {
      profitableScenarioCount++;
      breakEvenMultiplier = mult;
    } else if (mult === 1.50) {
      failsAt1_5 = true;
    }

    const pnlDegradationPercent =
      baselinePnL !== 0 ? ((baselinePnL - stressedPnL) / Math.abs(baselinePnL)) * 100 : 0;

    scenarios.push({
      scenarioName: `Cost Multiplier ${mult.toFixed(2)}x`,
      multiplier: mult,
      stressConfig,
      analytics: stressedAnalytics,
      pnlDegradationPercent,
      isProfitable
    });
  }

  const robustnessIndex = Math.round((profitableScenarioCount / multipliers.length) * 100);
  const isFragile = failsAt1_5;
  const isPassed = !isFragile && robustnessIndex >= 50;

  return {
    baselineAnalytics,
    scenarios,
    robustnessIndex,
    breakEvenMultiplier,
    isFragile,
    status: isPassed ? 'PASS' : 'FAIL',
    isPassed,
    timestamp: new Date().toISOString()
  };
}
