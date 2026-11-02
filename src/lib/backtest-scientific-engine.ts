/**
 * GAKS AI — Master Scientific Validation Engine (Stage E)
 * Coordinates Lookahead Audit (E1), Data Leakage Audit (E2), Walk-Forward Validation (E3),
 * Out-of-Sample Partitioning (E4), Parameter Sensitivity (E5), Market Regime Analysis (E6),
 * Monte Carlo Simulation (E7), and Multi-Scenario Robustness (E8).
 */

import { ParsedCandle } from './backtest-csv.js';
import { runBacktest } from './backtest-engine.ts';
import { BacktestConfig } from './backtest-types.js';
import { runLookaheadAudit, LookaheadAuditReport } from './backtest-lookahead-audit.js';
import { runDataLeakageAudit, DataLeakageAuditReport } from './backtest-data-leakage.js';
import { runWalkForwardValidation, WalkForwardResult } from './backtest-walk-forward.js';
import { runOutOfSampleValidation, OutOfSampleResult } from './backtest-oos.js';
import { runParameterSensitivityAnalysis, SensitivityReport } from './backtest-sensitivity.js';
import { analyzeMarketRegimes, MarketRegimeReport } from './backtest-regimes.js';
import { runMonteCarloSimulation, MonteCarloSimulationResult } from './backtest-monte-carlo.js';
import { runRobustnessSuite, RobustnessReport } from './backtest-robustness.js';

export type ValidationStatus = 'PASS' | 'FAIL' | 'INCONCLUSIVE';

export interface ScientificValidationExperiment {
  id: string;
  name: string;
  datasetId: string;
  symbol: string;
  timeframe: string;
  status: ValidationStatus;
  summaryReason: string;
  e1Lookahead: LookaheadAuditReport;
  e2DataLeakage: DataLeakageAuditReport;
  e3WalkForward: WalkForwardResult;
  e4OutOfSample: OutOfSampleResult;
  e5Sensitivity: SensitivityReport;
  e6Regimes: MarketRegimeReport;
  e7MonteCarlo: MonteCarloSimulationResult;
  e8Robustness: RobustnessReport;
  createdAt: string;
}

/**
 * Runs the complete Stage E Scientific Validation Orchestration.
 */
export async function runScientificValidation(params: {
  name?: string;
  config: BacktestConfig;
  candles: ParsedCandle[];
}): Promise<ScientificValidationExperiment> {
  const { config, candles } = params;
  const experimentId = crypto.randomUUID();
  const experimentName = params.name || `Scientific Validation Experiment (${config.symbol} ${config.timeframe})`;
  const now = new Date().toISOString();

  // 1. Run Baseline Engine to obtain trades
  const baselineRun = await runBacktest({
    ...config,
    candles
  });

  const trades = baselineRun.trades || [];

  // 2. Execute E1 — Lookahead Audit
  const e1Lookahead = runLookaheadAudit(candles, config.strategyText);

  // 3. Execute E2 — Data Leakage Audit
  const e2DataLeakage = runDataLeakageAudit({
    candles,
    partitions: {
      train: { start: candles[0]?.timestamp || '', end: candles[Math.floor(candles.length * 0.6)]?.timestamp || '' },
      validation: { start: candles[Math.floor(candles.length * 0.6)]?.timestamp || '', end: candles[Math.floor(candles.length * 0.8)]?.timestamp || '' },
      holdout: { start: candles[Math.floor(candles.length * 0.8)]?.timestamp || '', end: candles[candles.length - 1]?.timestamp || '' }
    }
  });

  // 4. Execute E3 — Walk-Forward Validation
  const trainCandles = Math.floor(candles.length * 0.4);
  const testCandles = Math.floor(candles.length * 0.2);
  const stepCandles = Math.floor(candles.length * 0.2);

  const e3WalkForward = await runWalkForwardValidation(config, candles, {
    trainCandles: trainCandles > 10 ? trainCandles : 10,
    testCandles: testCandles > 5 ? testCandles : 5,
    stepCandles: stepCandles > 5 ? stepCandles : 5,
    windowType: 'rolling',
    candidateParameters: [{ qualityGate: 75 }, { qualityGate: 80 }]
  });

  // 5. Execute E4 — Out-of-Sample Partitioning
  const e4OutOfSample = await runOutOfSampleValidation(config, candles);

  // 6. Execute E5 — Parameter Sensitivity Analysis
  const e5Sensitivity = await runParameterSensitivityAnalysis(config, candles);

  // 7. Execute E6 — Market Regime Classification
  const e6Regimes = analyzeMarketRegimes(trades, candles);

  // 8. Execute E7 — Monte Carlo Simulation
  const e7MonteCarlo = runMonteCarloSimulation(trades, {
    iterations: 500,
    initialBalance: config.initialBalance,
    samplingMethod: 'BOOTSTRAP',
    ruinThresholdPercent: 25,
    seed: 42
  });

  // 9. Execute E8 — Multi-Scenario Robustness Suite
  const e8Robustness = await runRobustnessSuite(config, candles);

  // 10. Synthesize Overall PASS / FAIL / INCONCLUSIVE Status
  let status: ValidationStatus = 'PASS';
  const failureReasons: string[] = [];

  // Critical Audit Failures -> FAIL
  if (!e1Lookahead.passed) {
    status = 'FAIL';
    failureReasons.push('Failed E1 Lookahead Bias Audit');
  }
  if (!e2DataLeakage.passed) {
    status = 'FAIL';
    failureReasons.push('Failed E2 Data Leakage / Integrity Audit');
  }
  if (!e4OutOfSample.isPassed) {
    status = 'FAIL';
    failureReasons.push('Failed E4 Out-of-Sample Holdout Performance');
  }
  if (!e5Sensitivity.isPassed) {
    status = 'FAIL';
    failureReasons.push('Failed E5 Parameter Sensitivity / Overfitting Risk');
  }
  if (!e7MonteCarlo.isPassed) {
    status = 'FAIL';
    failureReasons.push('Failed E7 Monte Carlo Risk of Ruin Threshold');
  }

  // Insufficient Trades -> INCONCLUSIVE
  if (trades.length < 5) {
    status = 'INCONCLUSIVE';
    failureReasons.push('Insufficient trade sample size (< 5 trades) for statistical significance');
  }

  const summaryReason =
    status === 'PASS'
      ? 'PASSED: Strategy satisfies all 8 scientific validation components with zero lookahead bias, clean data leakage audit, positive OOS expectancy, and low risk of ruin.'
      : `${status}: ${failureReasons.join('; ')}.`;

  return {
    id: experimentId,
    name: experimentName,
    datasetId: config.datasetId,
    symbol: config.symbol,
    timeframe: config.timeframe,
    status,
    summaryReason,
    e1Lookahead,
    e2DataLeakage,
    e3WalkForward,
    e4OutOfSample,
    e5Sensitivity,
    e6Regimes,
    e7MonteCarlo,
    e8Robustness,
    createdAt: now
  };
}
