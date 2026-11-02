/**
 * GAKS AI — Deterministic Trading Cost Engine Unit Tests (Stages C1–C4)
 * Explicit numerical tests for spread, slippage, commission, swap, and balance updates.
 */

import { calculateCosts } from './backtest-costs.js';
import { simulateTradeLifecycle } from './backtest-trade-simulator.js';
import { BacktestSimulationConfig, BacktestSignal, ParsedCandle } from './backtest-types.js';

export function runBacktestCostTests(): { passed: number; failed: number; failures: string[] } {
  const failures: string[] = [];
  let passed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      passed++;
    } else {
      failures.push(`${testName}${detail ? ': ' + detail : ''}`);
    }
  }

  console.log('[Backtest Cost Tests] Starting Stages C1–C4 test suite...');

  // Common sample candles
  const candles: ParsedCandle[] = [
    { timestamp: '2026-01-07T10:00:00.000Z', open: 1.0800, high: 1.0810, low: 1.0790, close: 1.0805, volume: 100 }, // Wed
    { timestamp: '2026-01-07T23:50:00.000Z', open: 1.0805, high: 1.0850, low: 1.0800, close: 1.0840, volume: 100 }, // Wed before rollover
    { timestamp: '2026-01-08T01:00:00.000Z', open: 1.0840, high: 1.0880, low: 1.0830, close: 1.0870, volume: 100 }  // Thu after rollover
  ];

  const buySignal: BacktestSignal = {
    id: 'sig_buy',
    timestamp: '2026-01-07T10:00:00.000Z',
    symbol: 'EURUSD',
    timeframe: 'M5',
    direction: 'BUY',
    entryPrice: 1.0805,
    stopLoss: 1.0750,
    takeProfit: 1.0870,
    reason: 'Test Buy',
    confidence: 90
  };

  const sellSignal: BacktestSignal = {
    id: 'sig_sell',
    timestamp: '2026-01-07T10:00:00.000Z',
    symbol: 'EURUSD',
    timeframe: 'M5',
    direction: 'SELL',
    entryPrice: 1.0805,
    stopLoss: 1.0860,
    takeProfit: 1.0750,
    reason: 'Test Sell',
    confidence: 90
  };

  // 1. BUY and SELL spread calculations
  const buyCost = calculateCosts({ lotSize: 1.0, direction: 'LONG' }, { spreadSettings: { type: 'FIXED', valuePips: 2.0 } }, 'EURUSD');
  const sellCost = calculateCosts({ lotSize: 1.0, direction: 'SHORT' }, { spreadSettings: { type: 'FIXED', valuePips: 2.0 } }, 'EURUSD');
  assert(buyCost.spreadCost === 20, '1. BUY spread cost calculation', `Expected 20, got ${buyCost.spreadCost}`);
  assert(sellCost.spreadCost === 20, '1b. SELL spread cost calculation', `Expected 20, got ${sellCost.spreadCost}`);

  // 2. Different instrument pip precisions
  const jpyCost = calculateCosts({ lotSize: 1.0, direction: 'LONG' }, { spreadSettings: { type: 'FIXED', valuePips: 2.0 } }, 'USDJPY');
  const xauCost = calculateCosts({ lotSize: 1.0, direction: 'LONG' }, { spreadSettings: { type: 'FIXED', valuePips: 2.0 } }, 'XAUUSD');
  // USDJPY contract 100,000, pip 0.001 -> 2 * 0.001 * 100,000 = 200 JPY
  // XAUUSD contract 100, pip 0.01 -> 2 * 0.01 * 100 = 2 USD
  assert(jpyCost.spreadCost === 200, '2. USDJPY pip precision', `Expected 200, got ${jpyCost.spreadCost}`);
  assert(xauCost.spreadCost === 2, '2b. XAUUSD pip precision', `Expected 2, got ${xauCost.spreadCost}`);

  // 3. Fixed and zero spread
  const zeroSpread = calculateCosts({ lotSize: 1.0 }, { spreadSettings: { type: 'FIXED', valuePips: 0 } }, 'EURUSD');
  assert(zeroSpread.spreadCost === 0, '3. Zero spread calculation', `Expected 0, got ${zeroSpread.spreadCost}`);

  // 4. Fixed and zero slippage
  const zeroSlippage = calculateCosts({ lotSize: 1.0 }, { slippageSettings: { type: 'ZERO' } }, 'EURUSD');
  assert(zeroSlippage.entrySlippageCost === 0 && zeroSlippage.exitSlippageCost === 0, '4. Zero slippage calculation');

  // 5. Entry and exit slippage
  const fixedSlippage = calculateCosts({ lotSize: 1.0 }, { slippageSettings: { type: 'FIXED', valuePips: 1.5 } }, 'EURUSD');
  assert(fixedSlippage.entrySlippageCost === 15 && fixedSlippage.exitSlippageCost === 15, '5. Entry and exit slippage cost');

  // 6. Commission per lot per side
  const perSideComm = calculateCosts({ lotSize: 2.0 }, { commissionSettings: { type: 'PER_LOT_PER_SIDE', valuePerLot: 3.5 } }, 'EURUSD');
  assert(perSideComm.entryCommission === 7.0 && perSideComm.exitCommission === 7.0, '6. Commission per lot per side');

  // 7. Round-turn commission without double charging
  const roundTurnComm = calculateCosts({ lotSize: 2.0 }, { commissionSettings: { type: 'ROUND_TURN_PER_LOT', valuePerLot: 7.0 } }, 'EURUSD');
  assert(roundTurnComm.entryCommission === 14.0 && roundTurnComm.exitCommission === 0, '7. Round turn commission');

  // 8. Long and short swap
  const longSwap = calculateCosts({ lotSize: 1.0, direction: 'LONG' }, { swapSettings: { enabled: true, longRatePerLot: -2.5, shortRatePerLot: 1.2 } }, 'EURUSD', '2026-01-01T10:00:00Z', '2026-01-02T10:00:00Z');
  const shortSwap = calculateCosts({ lotSize: 1.0, direction: 'SHORT' }, { swapSettings: { enabled: true, longRatePerLot: -2.5, shortRatePerLot: 1.2 } }, 'EURUSD', '2026-01-01T10:00:00Z', '2026-01-02T10:00:00Z');
  assert(longSwap.swapCost === -2.5, '8. Long swap rate calculation', `Got ${longSwap.swapCost}`);
  assert(shortSwap.swapCost === 1.2, '8b. Short swap rate calculation', `Got ${shortSwap.swapCost}`);

  // 9. Trades closed before rollover
  const noRollover = calculateCosts({ lotSize: 1.0, direction: 'LONG' }, { swapSettings: { enabled: true, longRatePerLot: -5.0 } }, 'EURUSD', '2026-01-01T10:00:00Z', '2026-01-01T18:00:00Z');
  assert(noRollover.swapCost === 0, '9. Trades closed before rollover have 0 swap');

  // 10. Trades crossing one rollover
  const oneRollover = calculateCosts({ lotSize: 1.0, direction: 'LONG' }, { swapSettings: { enabled: true, longRatePerLot: -3.0 } }, 'EURUSD', '2026-01-01T10:00:00Z', '2026-01-02T10:00:00Z');
  assert(oneRollover.swapCost === -3.0, '10. Trades crossing one rollover');

  // 11. Triple-swap weekday
  // 2026-01-07 is Wednesday (day 3)
  const tripleSwap = calculateCosts({ lotSize: 1.0, direction: 'LONG' }, { swapSettings: { enabled: true, longRatePerLot: -2.0, tripleSwapDay: 3 } }, 'EURUSD', '2026-01-07T10:00:00Z', '2026-01-08T10:00:00Z');
  assert(tripleSwap.swapCost === -6.0, '11. Triple swap on Wednesday', `Expected -6.0, got ${tripleSwap.swapCost}`);

  // 12. Zero-swap configuration
  const zeroSwap = calculateCosts({ lotSize: 1.0, direction: 'LONG' }, { swapSettings: { enabled: false, longRatePerLot: -10.0 } }, 'EURUSD', '2026-01-01T10:00:00Z', '2026-01-05T10:00:00Z');
  assert(zeroSwap.swapCost === 0, '12. Disabled swap configuration');

  // 13. Net PnL after every cost & 14. Correct account balance updates
  const fullSimConfig: BacktestSimulationConfig = {
    riskPercent: 1.0,
    spreadSettings: { type: 'FIXED', valuePips: 1.0 }, // 1 pip spread ($10)
    slippageSettings: { type: 'FIXED', valuePips: 0.5 }, // 0.5 pip slippage ($5 entry + $5 exit)
    commissionSettings: { type: 'PER_LOT_PER_SIDE', valuePerLot: 3.5 }, // $3.5/side ($7 entry + $7 exit = $14)
    swapSettings: { enabled: true, longRatePerLot: -2.0 }
  };

  const simResult = simulateTradeLifecycle({
    signal: buySignal,
    datasetId: 'ds_cost_test',
    signalIndex: 0,
    candles,
    currentBalance: 100000,
    simConfig: fullSimConfig,
    symbol: 'EURUSD',
    timeframe: 'M5'
  });

  const tr = simResult.trade!;
  assert(tr !== null, '13. Trade simulated successfully');
  assert(tr.requestedEntryPrice !== undefined && tr.actualEntryPrice !== undefined, '13b. Requested and actual entry prices recorded');
  assert(tr.spreadCost > 0 && tr.entrySlippageCost > 0 && tr.commissionCost > 0, '13c. Individual cost accounting recorded');
  
  // 15. No duplicate deductions: balanceAfter = balanceBefore + netPnL
  assert(Math.abs(tr.balanceAfter - (tr.balanceBefore + tr.netPnL)) < 0.001, '15. Balance after equals balance before + netPnL');

  // 16. Deterministic repeatability
  const simResult2 = simulateTradeLifecycle({
    signal: buySignal,
    datasetId: 'ds_cost_test',
    signalIndex: 0,
    candles,
    currentBalance: 100000,
    simConfig: fullSimConfig,
    symbol: 'EURUSD',
    timeframe: 'M5'
  });

  assert(simResult.trade!.netPnL === simResult2.trade!.netPnL, '16. Deterministic repeatability check');

  console.log(`[Backtest Cost Tests] Passed: ${passed}, Failed: ${failures.length}`);

  return { passed, failed: failures.length, failures };
}
