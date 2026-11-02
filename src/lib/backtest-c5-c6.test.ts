/**
 * GAKS AI — Stage C5 & C6 Unit Tests
 * Verifies intrabar execution (collisions, LTF refinement) and position sizing (instrument specs).
 */

import { simulateTradeLifecycle } from './backtest-trade-simulator.js';
import { calculatePositionSize, resolveInstrumentSpec } from './risk-engine.js';
import { runBacktest } from './backtest-engine.js';
import { BacktestConfig, BacktestSignal } from './backtest-types.js';
import { ParsedCandle } from './backtest-csv.js';

export async function runC5C6Tests() {
  console.log('\n--- Running Stage C5 & C6 Tests ---');
  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, message: string) => {
    if (condition) {
      passed++;
    } else {
      failed++;
      console.error(`[FAIL] ${message}`);
    }
  };

  // 1. C5: SL/TP Collision Policy (Conservative SL-first)
  const collisionCandles: ParsedCandle[] = [
    { timestamp: '2025-01-01T00:00:00Z', open: 1.1000, high: 1.1000, low: 1.1000, close: 1.1000, volume: 100 },
    { timestamp: '2025-01-01T00:01:00Z', open: 1.1000, high: 1.1100, low: 1.0900, close: 1.1000, volume: 100 } // Big candle hits both
  ];

  const collisionSignal: BacktestSignal = {
    id: 'sig1',
    timestamp: '2025-01-01T00:00:00Z',
    symbol: 'EURUSD',
    timeframe: 'M1',
    direction: 'BUY',
    entryPrice: 1.1000,
    stopLoss: 1.0950,
    takeProfit: 1.1050,
    reason: 'Test Collision',
    confidence: 1.0
  };

  const simResult = simulateTradeLifecycle({
    signal: collisionSignal,
    datasetId: 'test-dataset',
    signalIndex: 0,
    candles: collisionCandles,
    startIndex: 0,
    currentBalance: 10000,
    initialBalance: 10000,
    simConfig: { sameCandlePolicy: 'STOP_LOSS_FIRST' },
    symbol: 'EURUSD',
    timeframe: 'M1'
  });

  assert(simResult.trade !== null, 'Simulator should produce a trade');
  if (simResult.trade) {
    assert(simResult.trade.exitReason === 'SAME_CANDLE_STOP_LOSS', 'Conservative policy should hit SL first');
    assert(simResult.trade.collisionPolicyApplied === true, 'Collision should be recorded');
    assert(simResult.trade.collisionPolicy === 'STOP_LOSS_FIRST', 'Collision policy used should be recorded');
  }

  // 2. C6: Instrument Specifications Enforcement
  const nasSpec = resolveInstrumentSpec('NAS100');
  assert(nasSpec.assetClass === 'Indices', 'NAS100 should be an Index');
  assert(nasSpec.minLot === 0.1, 'NAS100 should have 0.1 min lot');
  assert(nasSpec.lotStep === 0.1, 'NAS100 should have 0.1 lot step');

  const goldSpec = resolveInstrumentSpec('XAUUSD');
  assert(goldSpec.assetClass === 'Gold', 'XAUUSD should be Gold');
  assert(goldSpec.contractSize === 100, 'Gold should have 100 contract size');

  // 3. C6: Position Sizing Parity & Rounding
  const posSize = calculatePositionSize({
    accountSize: 10000,
    riskPercentage: 1,
    entryPrice: 1.1000,
    stopLoss: 1.0900,
    symbol: 'EURUSD'
  });

  // Risk = 1% of 10000 = 100
  // Distance = 1.1000 - 1.0900 = 0.01
  // Contract = 100000
  // Loss per lot = 0.01 * 100000 = 1000
  // Lots = 100 / 1000 = 0.1
  assert(posSize.lots === 0.1, `Calculated lots should be 0.1, got ${posSize.lots}`);

  // 4. C6: Min Lot Rejection (Budget too small)
  const tinyAccountPos = calculatePositionSize({
    accountSize: 100,
    riskPercentage: 1, // $1 risk budget
    entryPrice: 1.1000,
    stopLoss: 1.0900, // $1000 loss per lot, $10 loss per 0.01 lot
    symbol: 'EURUSD'
  });
  assert(tinyAccountPos.accepted === false, 'Should reject trade if min lot exceeds budget');
  assert(tinyAccountPos.reason?.includes('exceeds your 1% budget'), 'Rejection reason should mention budget');

  return { passed, failed };
}
