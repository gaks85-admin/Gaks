/**
 * GAKS AI — Stage F: Final Post-Correction Historical Simulation
 * Comprehensive execution of the Gaks AI strategy over eligible datasets.
 */

import { listBacktestDatasets, getBacktestDatasetCandles, BENCHMARK_DATASET_ID, DAY1_DATASET_ID } from './backtest-service.js';
import { runBacktest } from './backtest-engine.js';
import { runScientificValidation } from './backtest-scientific-engine.js';
import { computeDatasetHash } from './backtest-import-utils.js';
import { RULE_WEIGHTS } from './rule-weight-engine.js';
import { compileStrategy } from './strategy-compiler.js';

async function executeFinalStageF() {
  const originalLog = console.log;
  const reports: string[] = [];

  const logReport = (msg: string) => {
    originalLog(msg);
    reports.push(msg);
  };

  logReport('============================================================================');
  logReport('GAKS AI — STAGE F: FINAL POST-CORRECTION HISTORICAL SIMULATION');
  logReport('============================================================================\n');

  // 1. DATA AUDIT & SELECTION
  const allDatasets = await listBacktestDatasets();
  const eligibleDatasets = allDatasets.filter(ds => {
    // Exclude incomplete or excessive missing candles (using 50% threshold)
    const missingRatio = ds.validation_report?.missingCandleCount ? (ds.validation_report.missingCandleCount / ds.row_count) : 0;
    if (missingRatio > 0.5 && ds.row_count > 100) return false;
    
    // Exclude 3-candle M5 dataset
    if (ds.timeframe === 'M5' && ds.row_count <= 10) return false;

    // We explicitly want the Benchmark H1 and Day 1 M5 (as sanity)
    if (ds.id === BENCHMARK_DATASET_ID || ds.id === DAY1_DATASET_ID) return true;

    // Filter out duplicates (simple name/hash check if possible)
    return true;
  });

  // Strategy Freeze Info
  const strategyText = 'Default Gaks Strategy: EMA alignment, Order Block structure, confirmation candle, 1:2 RR';
  const compiled = compileStrategy(strategyText);
  const strategyHash = 'GAKS-STRAT-V1-DET-' + Buffer.from(strategyText).toString('base64').slice(0, 12);

  logReport('=== FROZEN STRATEGY CONFIGURATION ===');
  logReport(`- Strategy Name: Default Gaks Deterministic Strategy`);
  logReport(`- Version: 1.0.0 (Production Release Candidate)`);
  logReport(`- Configuration Hash: ${strategyHash}`);
  logReport(`- Quality Threshold: 75%`);
  logReport(`- Mandatory Rules: [${(compiled.mandatory_rules || []).join(', ')}]`);
  logReport(`- Rule Weights: ${JSON.stringify(RULE_WEIGHTS)}`);
  logReport('============================================================================\n');

  for (const ds of eligibleDatasets) {
    const candles = await getBacktestDatasetCandles(ds.id);
    const hash = computeDatasetHash(candles);
    const label = ds.id === BENCHMARK_DATASET_ID ? 'LIMITED HISTORICAL SIMULATION (~2 MONTHS)' : 
                  ds.id === DAY1_DATASET_ID ? 'SANITY CHECK (1 DAY)' : 'HISTORICAL DATASET';

    logReport(`>>> DATASET: ${ds.name} (${ds.symbol} ${ds.timeframe}) <<<`);
    logReport(`- Label: ${label}`);
    logReport(`- Dataset ID: ${ds.id}`);
    logReport(`- Candle Count: ${candles.length}`);
    logReport(`- Coverage: ${candles[0]?.timestamp} to ${candles[candles.length - 1]?.timestamp}`);
    logReport(`- Content Hash: ${hash}`);
    logReport(`------------------------------------------------------------`);

    // 2. SIMULATION EXECUTION
    const configs = [
      {
        name: 'Personal Account',
        config: {
          datasetId: ds.id,
          symbol: ds.symbol,
          timeframe: ds.timeframe,
          initialBalance: 100000,
          strategyId: 'gaks-default',
          strategyText,
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
        }
      },
      {
        name: 'Prop-Firm Challenge',
        config: {
          datasetId: ds.id,
          symbol: ds.symbol,
          timeframe: ds.timeframe,
          initialBalance: 100000,
          strategyId: 'gaks-default',
          strategyText,
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
        }
      }
    ];

    for (const sim of configs) {
      const res = await runBacktest(sim.config);
      logReport(`\n[${sim.name} Results]`);
      logReport(`- Net Profit: $${res.analytics.netProfit.toFixed(2)} (${res.analytics.returnPercent.toFixed(2)}%)`);
      logReport(`- Trades Executed: ${res.trades.length}`);
      logReport(`- Win Rate: ${res.analytics.winRate?.toFixed(1) || 0}%`);
      logReport(`- Profit Factor: ${res.analytics.profitFactor?.toFixed(2) || 'N/A'}`);
      logReport(`- Max Drawdown: ${res.analytics.maxDrawdownPercent.toFixed(2)}%`);
      
      // Decision Log Sample
      if (res.trades.length > 0) {
        logReport(`- Representative Decision (Trade #1):`);
        const firstTrade = res.trades[0];
        const ms = firstTrade.marketStructure;
        logReport(`  * Direction: ${firstTrade.direction}`);
        logReport(`  * Entry: ${firstTrade.entryPrice} | SL: ${firstTrade.stopLoss} | TP: ${firstTrade.takeProfit}`);
        logReport(`  * Score: ${firstTrade.confidence}%`);
        logReport(`  * Reason: ${firstTrade.reason}`);
      } else {
        logReport(`- No trades executed for this configuration.`);
      }
    }

    // 3. STAGE E VALIDATION
    logReport(`\n[Stage E Scientific Validation]`);
    const sciRes = await runScientificValidation({
      name: `Validation: ${ds.name}`,
      config: {
        datasetId: ds.id,
        symbol: ds.symbol,
        timeframe: ds.timeframe,
        initialBalance: 100000,
        strategyId: 'gaks-default',
        strategyText
      },
      candles
    });

    logReport(`- Overall Status: ${sciRes.status}`);
    logReport(`- E1 Lookahead: ${sciRes.e1Lookahead.passed ? 'PASSED' : 'FAILED'}`);
    logReport(`- E3 Walk-Forward Efficiency: ${sciRes.e3WalkForward.walkForwardEfficiencyRatio.toFixed(2)}`);
    logReport(`- E4 Out-of-Sample Degradation: ${sciRes.e4OutOfSample.degradationRatio.toFixed(2)} (${sciRes.e4OutOfSample.isPassed ? 'PASSED' : 'FAILED'})`);
    logReport(`- E7 Monte Carlo Risk of Ruin: ${sciRes.e7MonteCarlo.riskOfRuinPercent.toFixed(2)}%`);
    logReport(`- E8 Robustness Matrix: ${sciRes.e8Robustness.passed ? 'PASSED' : 'FAILED'}`);
    logReport('------------------------------------------------------------\n');
  }

  logReport('============================================================================');
  logReport('STAGE F FINAL SIMULATION COMPLETED');
  logReport('============================================================================');
}

executeFinalStageF().catch(err => {
  console.error('Final Stage F execution failed:', err);
  process.exit(1);
});
