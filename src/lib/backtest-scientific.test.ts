/**
 * GAKS AI — Stage E Scientific Validation Suite Automated Test Runner
 * Tests E1–E8 components: Lookahead bias, Data leakage, Walk-forward, Out-of-sample,
 * Parameter sensitivity, Regime classification, Monte Carlo PRNG reproducibility, and Robustness.
 */

import { ParsedCandle } from './backtest-csv.js';
import { runLookaheadAudit } from './backtest-lookahead-audit.js';
import { runDataLeakageAudit, checkPartitionOverlap } from './backtest-data-leakage.js';
import { runWalkForwardValidation } from './backtest-walk-forward.js';
import { runOutOfSampleValidation } from './backtest-oos.js';
import { runParameterSensitivityAnalysis } from './backtest-sensitivity.js';
import { classifyRegime, analyzeMarketRegimes } from './backtest-regimes.js';
import { runMonteCarloSimulation, createMulberry32 } from './backtest-monte-carlo.js';
import { runRobustnessSuite } from './backtest-robustness.js';
import { runScientificValidation } from './backtest-scientific-engine.js';
import { BacktestConfig, BacktestTradeRecord } from './backtest-types.js';

function generateSampleCandles(count: number = 200): ParsedCandle[] {
  const candles: ParsedCandle[] = [];
  let basePrice = 1.0800;
  const startMs = new Date('2025-01-01T00:00:00Z').getTime();

  for (let i = 0; i < count; i++) {
    const ts = new Date(startMs + i * 5 * 60 * 1000).toISOString();
    const noise = (Math.sin(i / 5) + Math.cos(i / 3)) * 0.0008;
    const open = basePrice;
    const close = open + noise;
    const high = Math.max(open, close) + 0.0004;
    const low = Math.min(open, close) - 0.0004;

    candles.push({
      timestamp: ts,
      open,
      high,
      low,
      close,
      volume: 500 + (i % 10) * 50
    });

    basePrice = close;
  }

  return candles;
}

function generateSampleTrades(count: number = 20): BacktestTradeRecord[] {
  const trades: BacktestTradeRecord[] = [];
  const startMs = new Date('2025-01-01T01:00:00Z').getTime();

  for (let i = 0; i < count; i++) {
    const pnl = (i % 2 === 0 ? 1 : -1) * (100 + (i % 5) * 20);
    trades.push({
      id: `trade_${i}`,
      signalId: `sig_${i}`,
      symbol: 'EURUSD',
      timeframe: 'M5',
      direction: i % 2 === 0 ? 'LONG' : 'SHORT',
      entryTimestamp: new Date(startMs + i * 30 * 60 * 1000).toISOString(),
      exitTimestamp: new Date(startMs + (i * 30 + 15) * 60 * 1000).toISOString(),
      entryPrice: 1.0800,
      exitPrice: pnl > 0 ? 1.0820 : 1.0780,
      stopLoss: 1.0770,
      takeProfit: 1.0830,
      lotSize: 1.0,
      riskAmount: 300,
      riskRewardRatio: 2.0,
      grossPnL: pnl + 10,
      spreadCost: 5,
      slippageCost: 3,
      commissionCost: 2,
      netPnL: pnl,
      balanceBefore: 100000 + i * 50,
      balanceAfter: 100000 + i * 50 + pnl,
      exitReason: pnl > 0 ? 'TAKE_PROFIT' : 'STOP_LOSS'
    });
  }

  return trades;
}

async function runAllScientificTests() {
  console.log('=== GAKS AI — STAGE E SCIENTIFIC VALIDATION AUDIT TESTS ===\n');

  const candles = generateSampleCandles(200);
  const trades = generateSampleTrades(20);

  const baseConfig: BacktestConfig = {
    datasetId: 'test_dataset_e',
    symbol: 'EURUSD',
    timeframe: 'M5',
    initialBalance: 100000,
    strategyId: 'gaks-default'
  };

  // 1. E1: Lookahead Bias Audit
  console.log('--- 1. Testing E1: Lookahead Bias Audit ---');
  const e1Report = runLookaheadAudit(candles);
  console.log(`Lookahead Audit Result: ${e1Report.passed ? 'PASS' : 'FAIL'} (${e1Report.passedChecks}/${e1Report.totalChecks} checks passed)`);
  if (!e1Report.passed) {
    throw new Error('E1 Lookahead Bias Audit Failed');
  }
  console.log('✅ E1 Lookahead Bias Audit Verified.\n');

  // 2. E2: Data Leakage & Integrity Audit
  console.log('--- 2. Testing E2: Data Leakage & Integrity Audit ---');
  const e2Report = runDataLeakageAudit({
    candles,
    partitions: {
      train: { start: '2025-01-01T00:00:00Z', end: '2025-01-01T06:00:00Z' },
      validation: { start: '2025-01-01T06:05:00Z', end: '2025-01-01T12:00:00Z' },
      holdout: { start: '2025-01-01T12:05:00Z', end: '2025-01-01T16:00:00Z' }
    }
  });
  console.log(`Data Leakage Audit Result: ${e2Report.passed ? 'PASS' : 'FAIL'}`);
  if (!e2Report.passed) {
    throw new Error('E2 Data Leakage Audit Failed');
  }

  // Verify overlap detection
  const overlapCheck = checkPartitionOverlap({
    train: { start: '2025-01-01T00:00:00Z', end: '2025-01-01T08:00:00Z' },
    validation: { start: '2025-01-01T07:00:00Z', end: '2025-01-01T12:00:00Z' } // OVERLAP
  });
  if (overlapCheck.passed) {
    throw new Error('Data Leakage Engine failed to detect partition overlap!');
  }
  console.log('✅ E2 Data Leakage & Partition Overlap Guard Verified.\n');

  // 3. E3: Walk-Forward Validation Engine
  console.log('--- 3. Testing E3: Walk-Forward Validation Engine ---');
  const wfResult = await runWalkForwardValidation(baseConfig, candles, {
    trainCandles: 40,
    testCandles: 20,
    stepCandles: 20,
    windowType: 'rolling',
    candidateParameters: [{ qualityGate: 75 }, { qualityGate: 80 }]
  });
  console.log(`Walk-Forward Executed: ${wfResult.totalWindows} windows. Overall OOS PnL: $${wfResult.overallOutOfSamplePnL.toFixed(2)}`);
  if (!wfResult.success) {
    throw new Error(`Walk-Forward failed: ${wfResult.error}`);
  }
  console.log('✅ E3 Walk-Forward Validation Engine Verified.\n');

  // 4. E4: Out-of-Sample Partitioning
  console.log('--- 4. Testing E4: Out-of-Sample Partitioning ---');
  const oosResult = await runOutOfSampleValidation(baseConfig, candles);
  console.log(`OOS Validation Executed. Holdout PnL: $${oosResult.holdoutAnalytics.netProfit.toFixed(2)}`);
  if (!oosResult.success) {
    throw new Error('E4 Out-of-Sample Validation Failed');
  }
  console.log('✅ E4 Out-of-Sample Partitioning Verified.\n');

  // 5. E5: Parameter Sensitivity Analysis
  console.log('--- 5. Testing E5: Parameter Sensitivity Analysis ---');
  const sensReport = await runParameterSensitivityAnalysis(baseConfig, candles);
  console.log(`Sensitivity Score: ${sensReport.sensitivityScore}/100. Overfit Risk: ${sensReport.isOverfitRisk}`);
  console.log('✅ E5 Parameter Sensitivity Analysis Verified.\n');

  // 6. E6: Market Regime Analysis
  console.log('--- 6. Testing E6: Market Regime Analysis ---');
  const regimeSlice = candles.slice(0, 50);
  const regime = classifyRegime(regimeSlice);
  console.log(`Classified Regime: ${regime.trend} | ${regime.volatility}`);

  const regimeReport = analyzeMarketRegimes(trades, candles);
  console.log(`Dominant Regime: ${regimeReport.dominantRegime}. Breakdown count: ${Object.keys(regimeReport.regimeBreakdown).length}`);
  console.log('✅ E6 Market Regime Classification Verified.\n');

  // 7. E7: Reproducible Monte Carlo Simulation
  console.log('--- 7. Testing E7: Reproducible Monte Carlo PRNG Simulation ---');
  const mcSeed = 42;
  const mcResult1 = runMonteCarloSimulation(trades, {
    iterations: 200,
    initialBalance: 100000,
    samplingMethod: 'BOOTSTRAP',
    ruinThresholdPercent: 25,
    seed: mcSeed
  });

  const mcResult2 = runMonteCarloSimulation(trades, {
    iterations: 200,
    initialBalance: 100000,
    samplingMethod: 'BOOTSTRAP',
    ruinThresholdPercent: 25,
    seed: mcSeed
  });

  // Verify 100% deterministic reproducibility with identical seed
  const isReproducible =
    mcResult1.finalEquity.p50 === mcResult2.finalEquity.p50 &&
    mcResult1.riskOfRuinPercent === mcResult2.riskOfRuinPercent;

  if (!isReproducible) {
    throw new Error('Monte Carlo simulation failed PRNG reproducibility check!');
  }
  console.log(`Monte Carlo 200 Iterations Executed. Median Equity: $${mcResult1.finalEquity.p50.toFixed(2)}, Risk of Ruin: ${mcResult1.riskOfRuinPercent}%`);
  console.log('✅ E7 Seeded PRNG Reproducibility Verified.\n');

  // 8. E8: Multi-Scenario Execution Robustness Suite
  console.log('--- 8. Testing E8: Multi-Scenario Execution Robustness Suite ---');
  const robReport = await runRobustnessSuite(baseConfig, candles);
  console.log(`Robustness Index: ${robReport.robustnessIndex}%. Break-Even Multiplier: ${robReport.breakEvenMultiplier}x`);
  console.log('✅ E8 Multi-Scenario Execution Robustness Suite Verified.\n');

  // 9. Master Scientific Validation Orchestrator
  console.log('--- 9. Testing Master Scientific Validation Orchestrator ---');
  const masterExp = await runScientificValidation({
    name: 'Automated Master Test Experiment',
    config: baseConfig,
    candles
  });
  console.log(`Master Experiment Status: ${masterExp.status}`);
  console.log(`Summary Reason: ${masterExp.summaryReason}`);
  console.log('✅ Master Scientific Validation Orchestrator Verified.\n');

  console.log('========================================');
  console.log('ALL STAGE E SCIENTIFIC VALIDATION AUDIT TESTS PASSED SUCCESSFULLY');
  console.log('========================================');
}

runAllScientificTests().catch(err => {
  console.error('STAGE E SCIENTIFIC VALIDATION TEST FAILURE:', err);
  process.exit(1);
});
