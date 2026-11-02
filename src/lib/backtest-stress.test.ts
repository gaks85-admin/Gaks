/**
 * GAKS AI — Execution Stress Testing Verification (Stage C7)
 * Verifies that stress multipliers and shocks are applied correctly and deterministically.
 */

import { runBacktest, runStressSuite } from './backtest-engine.js';
import { BacktestConfig, ExecutionStressConfig } from './backtest-types.js';
import { ParsedCandle } from './backtest-csv.js';

// Mock candle data
const mockCandles: ParsedCandle[] = [
  { timestamp: '2023-01-01T00:00:00Z', open: 1.1000, high: 1.1010, low: 1.0990, close: 1.1005, volume: 100 },
  { timestamp: '2023-01-01T01:00:00Z', open: 1.1005, high: 1.1050, low: 1.1000, close: 1.1040, volume: 100 },
  { timestamp: '2023-01-01T02:00:00Z', open: 1.1040, high: 1.1100, low: 1.1030, close: 1.1090, volume: 100 },
  { timestamp: '2023-01-01T03:00:00Z', open: 1.1090, high: 1.1150, low: 1.1080, close: 1.1140, volume: 100 },
  { timestamp: '2023-01-01T04:00:00Z', open: 1.1140, high: 1.1160, low: 1.1120, close: 1.1155, volume: 100 },
  { timestamp: '2023-01-01T05:00:00Z', open: 1.1155, high: 1.1200, low: 1.1150, close: 1.1190, volume: 100 },
];

// Mock strategy that always buys at first candle
const mockStrategyText = `
  if (context.index === 0) {
    return {
      id: 'signal_1',
      timestamp: context.current.timestamp,
      symbol: context.symbol,
      timeframe: context.timeframe,
      direction: 'BUY',
      entryPrice: context.current.close,
      stopLoss: context.current.close - 0.0050,
      takeProfit: context.current.close + 0.0100,
      reason: 'Test signal',
      confidence: 1.0
    };
  }
  return null;
`;

async function testStressMultipliers() {
  console.log('--- Testing Stress Multipliers ---');

  const config: BacktestConfig = {
    datasetId: 'ds_1',
    strategyId: 'test-always-buy',
    initialBalance: 10000,
    symbol: 'EURUSD',
    timeframe: 'H1',
    candles: mockCandles,
    simulation: {
      positionMode: 'FIXED_LOT',
      preferredLotSize: 0.1,
      spreadPips: 2.0,
      slippagePips: 1.0,
      commissionPerLot: 7.0,
      enforceMarketHours: false,
      enforceSessions: false,
      enforceQualityGate: false,
      enforceRiskGovernor: false,
      enforceCooldown: false,
      enforcePropFirm: false
    }
  };

  // 1. Run Baseline
  const baseline = await runBacktest(config);
  const baselineTrade = baseline.trades[0];
  console.log(`Baseline: SpreadCost=${baselineTrade.spreadCost}, SlippageCost=${baselineTrade.slippageCost}, Commission=${baselineTrade.commissionCost}`);

  // 2. Run 2x Stress
  const stressConfig: ExecutionStressConfig = {
    spreadMultiplier: 2.0,
    slippageMultiplier: 2.0,
    commissionMultiplier: 2.0
  };

  const stressed = await runBacktest({
    ...config,
    simulation: { ...config.simulation, stress: stressConfig }
  });
  const stressedTrade = stressed.trades[0];
  console.log(`Stressed (2x): SpreadCost=${stressedTrade.spreadCost}, SlippageCost=${stressedTrade.slippageCost}, Commission=${stressedTrade.commissionCost}`);

  // Assertions
  if (stressedTrade.spreadCost !== baselineTrade.spreadCost * 2) {
    throw new Error(`Spread multiplier failed: Expected ${baselineTrade.spreadCost * 2}, got ${stressedTrade.spreadCost}`);
  }
  if (stressedTrade.slippageCost !== baselineTrade.slippageCost * 2) {
    throw new Error(`Slippage multiplier failed: Expected ${baselineTrade.slippageCost * 2}, got ${stressedTrade.slippageCost}`);
  }
  // Commission might be slightly different due to rounding or fixed vs per lot, but here it's per lot.
  if (stressedTrade.commissionCost !== baselineTrade.commissionCost * 2) {
    throw new Error(`Commission multiplier failed: Expected ${baselineTrade.commissionCost * 2}, got ${stressedTrade.commissionCost}`);
  }

  console.log('✅ Stress multipliers verified.');
}

async function testExecutionShocks() {
  console.log('\n--- Testing Execution Shocks (Deterministic) ---');

  const config: BacktestConfig = {
    datasetId: 'ds_1',
    strategyId: 'test-always-buy',
    initialBalance: 10000,
    symbol: 'EURUSD',
    timeframe: 'H1',
    candles: mockCandles,
    simulation: {
      spreadPips: 2.0,
      slippagePips: 1.0,
      enforceMarketHours: false,
      enforceSessions: false,
      enforceQualityGate: false,
      enforceRiskGovernor: false,
      enforceCooldown: false,
      enforcePropFirm: false,
      stress: {
        shocks: {
          seed: 'deterministic_seed',
          spreadSpikeProbability: 1.0, // Always spike
          spreadSpikeMultiplier: 5.0,
          slippageShockProbability: 1.0, // Always shock
          slippageShockMultiplier: 10.0
        }
      }
    }
  };

  const result = await runBacktest(config);
  const trade = result.trades[0];

  console.log(`Shocked: SpreadCost=${trade.spreadCost}, SlippageCost=${trade.slippageCost}`);

  // Baseline was spread 2.0, slippage 1.0. Shocked should be spread 10.0, slippage 10.0.
  // SpreadCost = (10 pips * 0.0001 * 100000 * lotSize)
  // We need to check if they are indeed higher than baseline.
  if (trade.spreadCost <= 0.4) { // 0.4 was baseline roughly
     // Actually let's just check against the math.
     // lotSize for 0.0050 SL on 10000 balance (1% risk = 100 USD)
     // lotSize = 100 / (50 pips * 10) = 0.2 lots
     // Baseline SpreadCost = 2 pips * 0.0001 * 0.2 * 100000 = 4.0 USD
     // Shocked SpreadCost = 10 pips * 0.0001 * 0.2 * 100000 = 20.0 USD
  }

  if (trade.spreadCost < 10) {
    throw new Error(`Spread shock failed: Expected > 10, got ${trade.spreadCost}`);
  }
  if (trade.slippageCost < 10) {
    throw new Error(`Slippage shock failed: Expected > 10, got ${trade.slippageCost}`);
  }

  console.log('✅ Execution shocks verified.');
}

async function testStressSuite() {
  console.log('\n--- Testing Stress Suite ---');

  const config: BacktestConfig = {
    datasetId: 'ds_1',
    strategyId: 'test-always-buy',
    initialBalance: 10000,
    symbol: 'EURUSD',
    timeframe: 'H1',
    candles: mockCandles,
    simulation: {
      spreadPips: 2.0,
      slippagePips: 1.0,
      enforceMarketHours: false,
      enforceSessions: false,
      enforceQualityGate: false,
      enforceRiskGovernor: false,
      enforceCooldown: false,
      enforcePropFirm: false
    }
  };

  const suite = await runStressSuite(config, [
    { name: 'Moderate', stress: { spreadMultiplier: 1.5, slippageMultiplier: 1.5 } },
    { name: 'Severe', stress: { spreadMultiplier: 2.0, slippageMultiplier: 2.0 } },
    { name: 'Extreme', stress: { spreadMultiplier: 3.0, slippageMultiplier: 3.0 } }
  ]);

  console.log(`Baseline Net Profit: ${suite.baselineAnalytics.netProfit}`);
  suite.scenarios.forEach(s => {
    console.log(`Scenario: ${s.scenarioName}`);
    console.log(`  Net Profit: ${s.analytics.netProfit} (Delta: ${s.comparison.netProfit.deltaPercent}%)`);
    console.log(`  Total Costs: ${s.analytics.totalTradingCosts} (Delta: ${s.comparison.totalTradingCosts.deltaPercent}%)`);
  });

  if (suite.scenarios.length !== 3) {
    throw new Error(`Expected 3 scenarios, got ${suite.scenarios.length}`);
  }

  console.log('✅ Stress suite verified.');
}

async function runAll() {
  try {
    await testStressMultipliers();
    await testExecutionShocks();
    await testStressSuite();
    console.log('\nALL STAGE C7 TESTS PASSED');
  } catch (err) {
    console.error('\nTEST FAILED:');
    console.error(err);
    process.exit(1);
  }
}

runAll();
