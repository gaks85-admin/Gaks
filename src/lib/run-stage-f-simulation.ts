/**
 * GAKS AI — Stage F: Full Historical Simulation & Validation Runner
 * Executes deterministic historical simulations across eligible datasets,
 * enforcing strict live-trading isolation, personal & prop-firm risk profiles,
 * execution cost breakdowns (C1-C7), and Stage E scientific validations.
 */

import { listBacktestDatasets, getBacktestDatasetCandles, BENCHMARK_DATASET_ID, DAY1_DATASET_ID } from './backtest-service.js';
import { runBacktest } from './backtest-engine.js';
import { runScientificValidation } from './backtest-scientific-engine.js';
import { computeDatasetHash } from './backtest-import-utils.js';

async function executeStageFSimulations() {
  const originalLog = console.log;
  const silentLog = (...args: any[]) => {
    if (args[0] && typeof args[0] === 'string' && (
      args[0].startsWith('===') || 
      args[0].startsWith('>>>') || 
      args[0].startsWith('- ') || 
      args[0].startsWith('DATASET') || 
      args[0].startsWith('STAGE F') || 
      args[0].startsWith('Personal') || 
      args[0].startsWith('Prop-Firm') || 
      args[0].startsWith('Scientific')
    )) {
      originalLog(...args);
    }
  };

  originalLog('============================================================================');
  originalLog('GAKS AI — STAGE F: FULL HISTORICAL SIMULATION ENGINE EXECUTION');
  originalLog('============================================================================\n');

  const datasets = await listBacktestDatasets();
  const benchmarkDs = datasets.find(d => d.id === BENCHMARK_DATASET_ID) || {
    id: BENCHMARK_DATASET_ID,
    symbol: 'EURUSD',
    timeframe: 'H1',
    name: 'EURUSD 2025 Q1 Benchmark',
    status: 'ready',
    version: '1.0.0'
  };

  const day1Ds = datasets.find(d => d.id === DAY1_DATASET_ID) || {
    id: DAY1_DATASET_ID,
    symbol: 'EURUSD',
    timeframe: 'M5',
    name: 'EURUSD 2025 Day 1 M5',
    status: 'ready',
    version: '1.0.0'
  };

  const eligibleDatasets = [benchmarkDs, day1Ds];

  for (const ds of eligibleDatasets) {
    const candles = await getBacktestDatasetCandles(ds.id);
    const hash = computeDatasetHash(candles);
    originalLog(`\n============================================================================`);
    originalLog(`DATASET SIMULATION: ${ds.name} (${ds.symbol} ${ds.timeframe})`);
    originalLog(`- Dataset ID: ${ds.id}`);
    originalLog(`- Candle Count: ${candles.length}`);
    originalLog(`- First Candle: ${candles[0]?.timestamp}`);
    originalLog(`- Last Candle: ${candles[candles.length - 1]?.timestamp}`);
    originalLog(`- Content Hash (SHA-256): ${hash}`);
    originalLog(`============================================================================\n`);

    console.log = silentLog;

    // 1. Personal Account Simulation
    originalLog(`>>> RUNNING PERSONAL ACCOUNT SIMULATION (${ds.symbol} ${ds.timeframe}) <<<`);
    const personalConfig = {
      datasetId: ds.id,
      symbol: ds.symbol,
      timeframe: ds.timeframe,
      initialBalance: 100000,
      strategyId: 'gaks-default',
      strategyText: 'Default Gaks Deterministic Strategy',
      candles,
      simulation: {
        riskPercent: 1.0,
        spreadPips: 1.5,
        slippagePips: 0.5,
        commissionPerLot: 3.5,
        enforceQualityGate: true,
        qualityGateThreshold: 75,
        enforceMarketHours: true,
        enforceEconomicNewsGate: true
      }
    };

    const personalRes = await runBacktest(personalConfig);
    console.log(`Personal Simulation Result:`);
    console.log(`- Success: ${personalRes.success}`);
    console.log(`- Total Trades: ${personalRes.trades.length}`);
    console.log(`- Net Profit: $${personalRes.analytics.netProfit.toFixed(2)}`);
    console.log(`- Return %: ${personalRes.analytics.returnPercent.toFixed(2)}%`);
    console.log(`- Max Drawdown: ${personalRes.analytics.maxDrawdownPercent.toFixed(2)}% ($${personalRes.analytics.maxDrawdownCurrency.toFixed(2)})`);
    console.log(`- Win Rate: ${personalRes.analytics.winRate !== null ? personalRes.analytics.winRate.toFixed(1) + '%' : 'N/A'}`);
    console.log(`- Profit Factor: ${personalRes.analytics.profitFactor !== null ? personalRes.analytics.profitFactor.toFixed(2) : 'N/A'}`);
    console.log(`- Spread Cost: $${personalRes.analytics.totalSpreadCost.toFixed(2)}`);
    console.log(`- Slippage Cost: $${personalRes.analytics.totalSlippageCost.toFixed(2)}`);
    console.log(`- Commission Cost: $${personalRes.analytics.totalCommissionCost.toFixed(2)}`);
    console.log(`- Swap Cost: $${personalRes.analytics.totalSwapCost.toFixed(2)}`);
    console.log(`- Final Balance: $${personalRes.finalBalance.toFixed(2)}`);

    // 2. Prop-Firm Simulation
    console.log(`\n>>> RUNNING PROP-FIRM CHALLENGE SIMULATION (${ds.symbol} ${ds.timeframe}) <<<`);
    const propConfig = {
      datasetId: ds.id,
      symbol: ds.symbol,
      timeframe: ds.timeframe,
      initialBalance: 100000,
      strategyId: 'gaks-default',
      strategyText: 'Default Gaks Deterministic Strategy',
      candles,
      simulation: {
        riskPercent: 1.0,
        spreadPips: 1.5,
        slippagePips: 0.5,
        commissionPerLot: 3.5,
        enforceQualityGate: true,
        qualityGateThreshold: 75,
        enforceMarketHours: true,
        enforceEconomicNewsGate: true,
        propFirmRules: {
          maxDailyLossPercent: 5.0,
          maxTotalLossPercent: 10.0,
          profitTargetPercent: 10.0,
          prohibitWeekendHolding: true
        }
      }
    };

    const propRes = await runBacktest(propConfig);
    console.log(`Prop-Firm Simulation Result:`);
    console.log(`- Success: ${propRes.success}`);
    console.log(`- Total Trades: ${propRes.trades.length}`);
    console.log(`- Net Profit: $${propRes.analytics.netProfit.toFixed(2)}`);
    console.log(`- Return %: ${propRes.analytics.returnPercent.toFixed(2)}%`);
    console.log(`- Max Drawdown: ${propRes.analytics.maxDrawdownPercent.toFixed(2)}%`);
    console.log(`- Rule Violations / Breaches: ${propRes.restrictionsSummary?.violationsCount || 0}`);

    // 3. Stage E Scientific Validation Integration
    console.log(`\n>>> RUNNING INTEGRATED STAGE E SCIENTIFIC VALIDATION (${ds.symbol} ${ds.timeframe}) <<<`);
    const sciRes = await runScientificValidation({
      name: `Stage F Full Validation (${ds.symbol} ${ds.timeframe})`,
      config: {
        datasetId: ds.id,
        symbol: ds.symbol,
        timeframe: ds.timeframe,
        initialBalance: 100000,
        strategyId: 'gaks-default',
        strategyText: 'Default Gaks Deterministic Strategy'
      },
      candles
    });

    console.log(`Scientific Validation Result:`);
    console.log(`- Status: ${sciRes.status}`);
    console.log(`- Summary Reason: ${sciRes.summaryReason}`);
    console.log(`- E1 Lookahead Audit: ${sciRes.e1Lookahead.passed ? 'PASSED' : 'FAILED'} (${sciRes.e1Lookahead.passedChecks}/${sciRes.e1Lookahead.totalChecks} checks)`);
    console.log(`- E2 Data Leakage: ${sciRes.e2DataLeakage.passed ? 'PASSED' : 'FAILED'}`);
    console.log(`- E3 Walk-Forward Efficiency: ${sciRes.e3WalkForward.walkForwardEfficiencyRatio.toFixed(2)} (${sciRes.e3WalkForward.windowType})`);
    console.log(`- E4 Out-of-Sample Holdout: ${sciRes.e4OutOfSample.isPassed ? 'PASSED' : 'FAILED'} (Degradation Ratio: ${sciRes.e4OutOfSample.degradationRatio.toFixed(2)})`);
    console.log(`- E5 Parameter Sensitivity Score: ${sciRes.e5Sensitivity.sensitivityScore}/100`);
    console.log(`- E6 Market Regimes Evaluated: ${sciRes.e6Regimes?.regimes?.length || 0} regimes (Threshold: ${sciRes.e6Regimes?.minSampleThreshold || 30} trades, Inconclusive: ${sciRes.e6Regimes?.isInconclusive})`);
    console.log(`- E7 Monte Carlo Risk of Ruin: ${sciRes.e7MonteCarlo.riskOfRuinPercent.toFixed(2)}% (Median Equity: $${sciRes.e7MonteCarlo.finalEquity.p50.toFixed(2)})`);
    console.log(`- E8 Robustness Matrix: ${sciRes.e8Robustness.passed ? 'PASSED' : 'FAILED'} (${sciRes.e8Robustness.scenarios.filter(s => s.isProfitable).length}/${sciRes.e8Robustness.scenarios.length} profitable)`);
  }

  console.log('\n============================================================================');
  console.log('STAGE F FULL SIMULATION ENGINE RUN COMPLETED');
  console.log('============================================================================');
}

executeStageFSimulations().catch(err => {
  console.error('Simulation execution failed:', err);
  process.exit(1);
});
