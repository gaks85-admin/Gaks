/**
 * GAKS AI — Stage E5: Parameter Sensitivity Analysis Engine
 * Evaluates strategy stability under controlled parameter perturbations (OVAT and multi-variable).
 * Detects performance cliffs (>30% drop from small parameter shift) and overfitting spikes.
 */

import { ParsedCandle } from './backtest-csv.js';
import { runBacktest } from './backtest-engine.ts';
import { BacktestConfig, BacktestAnalyticsResult } from './backtest-types.js';

export interface ParameterPerturbation {
  parameterName: string;
  baselineValue: number;
  testValues: number[];
}

export interface SensitivityPoint {
  parameterName: string;
  value: number;
  deltaPercent: number;
  analytics: BacktestAnalyticsResult;
  dropFromBaselinePercent: number;
  isPerformanceCliff: boolean; // True if drop > 35% from baseline
}

export interface SensitivityReport {
  baselineAnalytics: BacktestAnalyticsResult;
  perturbationPoints: SensitivityPoint[];
  maxPerformanceDropPercent: number;
  cliffCount: number;
  isOverfitRisk: boolean;
  sensitivityScore: number | null; // null if insufficient trades
  status: 'PASS' | 'FAIL' | 'INSUFFICIENT_TRADES';
  isPassed: boolean;
}

/**
 * Runs Parameter Sensitivity Testing across bounded perturbations.
 */
export async function runParameterSensitivityAnalysis(
  baseConfig: BacktestConfig,
  candles: ParsedCandle[]
): Promise<SensitivityReport> {
  // 1. Run Baseline
  const baselineRun = await runBacktest({
    ...baseConfig,
    candles
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
      perturbationPoints: [],
      maxPerformanceDropPercent: 0,
      cliffCount: 0,
      isOverfitRisk: false,
      sensitivityScore: null,
      status: 'INSUFFICIENT_TRADES',
      isPassed: false
    };
  }

  const baselinePnL = baselineAnalytics.netProfit;
  
  // 2. Define Parameter Variations around strategy parameters
  // For default strategy: quality gate score, risk multipliers, session buffers
  const perturbations: ParameterPerturbation[] = [
    {
      parameterName: 'Quality Gate Threshold',
      baselineValue: 75,
      testValues: [65, 70, 80, 85]
    },
    {
      parameterName: 'Risk % per trade',
      baselineValue: 1.0,
      testValues: [0.8, 0.9, 1.1, 1.2]
    }
  ];

  const perturbationPoints: SensitivityPoint[] = [];
  let cliffCount = 0;
  let maxDrop = 0;

  for (const pert of perturbations) {
    for (const testVal of pert.testValues) {
      const deltaPercent = ((testVal - pert.baselineValue) / pert.baselineValue) * 100;

      // Apply perturbation to risk governor or simulation
      const perturbedConfig: BacktestConfig = {
        ...baseConfig,
        candles,
        simulation: {
          ...baseConfig.simulation,
          riskPercent: pert.parameterName === 'Risk % per trade' ? testVal : (baseConfig.simulation?.riskPercent || 1.0),
          qualityGateThreshold: pert.parameterName === 'Quality Gate Threshold' ? testVal : (baseConfig.simulation?.qualityGateThreshold || 75),
          enforceQualityGate: true
        }
      };

      const pertRun = await runBacktest(perturbedConfig);
      const pertAnalytics = pertRun.analytics || ({
        netProfit: 0,
        returnPercent: 0,
        winRate: 0,
        profitFactor: 0,
        maxDrawdownPercent: 0
      } as any);

      const pertPnL = pertAnalytics.netProfit;
      const dropFromBaseline = baselinePnL !== 0 ? ((baselinePnL - pertPnL) / Math.abs(baselinePnL)) * 100 : 0;

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

  // Sensitivity Score: 100 - maxDrop clamped between 0 and 100
  const sensitivityScore = Math.max(0, Math.min(100, Math.round(100 - maxDrop)));

  const isPassed = !isOverfitRisk && sensitivityScore >= 50;

  return {
    baselineAnalytics,
    perturbationPoints,
    maxPerformanceDropPercent: maxDrop,
    cliffCount,
    isOverfitRisk,
    sensitivityScore,
    status: isPassed ? 'PASS' : 'FAIL',
    isPassed
  };
}
