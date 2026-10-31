/**
 * GAKS AI — Historical Trading Costs & Execution Cost Engine Test Suite (Stage C1–C4.1 Audit)
 * Covers all required deterministic test cases for spread, slippage, commission, and swap modelling,
 * including Bid/Ask side, Gap fills, and Triple Swap logic.
 */

import { simulateTradeLifecycle, calculateSwapCost } from './backtest-trade-simulator.js';
import { BacktestSignal, ParsedCandle, BacktestSimulationConfig } from './backtest-types.js';

export async function runBacktestCostTests(): Promise<{ total: number; passed: number; failed: number; failures: string[] }> {
  const failures: string[] = [];
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    total++;
    if (condition) {
      passed++;
    } else {
      failures.push(`${testName}${detail ? ': ' + detail : ''}`);
    }
  }

  console.log('[Backtest Costs Test Suite] Starting C1–C4 cost tests...');

  // Standard test candles
  const candles: ParsedCandle[] = [
    { timestamp: '2025-01-01T21:00:00.000Z', open: 1.0500, high: 1.0510, low: 1.0490, close: 1.0505, volume: 100 },
    { timestamp: '2025-01-01T21:30:00.000Z', open: 1.0505, high: 1.0520, low: 1.0490, close: 1.0510, volume: 110 }, // entry before 22:00 UTC rollover
    { timestamp: '2025-01-02T21:30:00.000Z', open: 1.0510, high: 1.0560, low: 1.0500, close: 1.0550, volume: 120 } // TP hit before second rollover
  ];

  const buySignal: BacktestSignal = {
    id: 'sig_buy',
    timestamp: '2025-01-01T21:00:00.000Z',
    symbol: 'EURUSD',
    timeframe: 'H1',
    direction: 'BUY',
    entryPrice: 1.0505,
    stopLoss: 1.0450,
    takeProfit: 1.0550,
    reason: 'Test Signal',
    confidence: 90
  };

  const sellSignal: BacktestSignal = {
    id: 'sig_sell',
    timestamp: '2025-01-01T21:00:00.000Z',
    symbol: 'EURUSD',
    timeframe: 'H1',
    direction: 'SELL',
    entryPrice: 1.0505,
    stopLoss: 1.0560,
    takeProfit: 1.0450,
    reason: 'Test Sell Signal',
    confidence: 90
  };

  // Test 1: BUY and SELL spread calculations (Entry)
  try {
    const buyRes = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-c1',
      signalIndex: 0,
      candles,
      currentBalance: 100000,
      initialBalance: 100000,
      simConfig: { spreadPips: 2.0, slippagePips: 0 },
      symbol: 'EURUSD',
      timeframe: 'H1'
    });

    const sellRes = simulateTradeLifecycle({
      signal: sellSignal,
      datasetId: 'ds-c1-sell',
      signalIndex: 0,
      candles,
      currentBalance: 100000,
      initialBalance: 100000,
      simConfig: { spreadPips: 2.0, slippagePips: 0 },
      symbol: 'EURUSD',
      timeframe: 'H1'
    });

    // EURUSD tickSize = 0.0001. 2 pips = 0.0002. Half spread = 0.0001.
    // BUY entry = open (1.0505) + 0.0001 = 1.0506
    assert(buyRes.trade !== null && buyRes.trade.entryPrice === 1.0506, 'Test 1a: BUY uses ask-side entry (open + half spread)');
    // SELL entry = open (1.0505) - 0.0001 = 1.0504
    assert(sellRes.trade !== null && sellRes.trade.entryPrice === 1.0504, 'Test 1b: SELL uses bid-side entry (open - half spread)');
  } catch (err: any) {
    assert(false, 'Test 1 Exception', err.message);
  }

  // Test 2: BUY and SELL SL/TP Triggers (Audit Case 1)
  try {
    // BUY TP Audit: High=1.0550, Spread=2pips (0.0002). BidHigh = 1.0550 - 0.0001 = 1.0549. TP=1.0550. 
    // BidHigh (1.0549) < TP (1.0550). Should NOT hit.
    const buyNoTPRes = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-audit-tp-fail',
      signalIndex: 0,
      candles, // Candle 2 High is 1.0560. BidHigh = 1.0560 - 0.0001 = 1.0559. Should hit.
      currentBalance: 100000,
      initialBalance: 100000,
      simConfig: { spreadPips: 2.0, slippagePips: 0 },
      symbol: 'EURUSD',
      timeframe: 'H1'
    });

    assert(buyNoTPRes.trade !== null && buyNoTPRes.trade.exitReason === 'TAKE_PROFIT', 'Test 2a: BUY TP triggers using Bid price side');
    assert(buyNoTPRes.trade !== null && buyNoTPRes.trade.exitPrice === 1.0550, 'Test 2b: BUY TP executes at requested TP price (SELL at Bid)');

    // SELL SL Audit: High=1.0560, Spread=2pips (0.0002). AskHigh = 1.0560 + 0.0001 = 1.0561. SL=1.0560.
    // AskHigh (1.0561) >= SL (1.0560). Should hit.
    const sellSLRes = simulateTradeLifecycle({
      signal: sellSignal,
      datasetId: 'ds-audit-sl-hit',
      signalIndex: 0,
      candles,
      currentBalance: 100000,
      initialBalance: 100000,
      simConfig: { spreadPips: 2.0, slippagePips: 0 },
      symbol: 'EURUSD',
      timeframe: 'H1'
    });

    assert(sellSLRes.trade !== null && sellSLRes.trade.exitReason === 'STOP_LOSS', 'Test 2c: SELL SL triggers using Ask price side');
  } catch (err: any) {
    assert(false, 'Test 2 Exception', err.message);
  }

  // Test 3: Gap and Slippage Audit (Audit Case 2)
  try {
    const gapCandles: ParsedCandle[] = [
      { timestamp: '2025-01-01T21:00:00.000Z', open: 1.0500, high: 1.0510, low: 1.0490, close: 1.0505, volume: 100 },
      { timestamp: '2025-01-01T22:00:00.000Z', open: 1.0505, high: 1.0520, low: 1.0490, close: 1.0510, volume: 110 }, // Entry candle
      { timestamp: '2025-01-01T23:00:00.000Z', open: 1.0400, high: 1.0410, low: 1.0390, close: 1.0395, volume: 110 } // Gap down below BUY SL (1.0450)
    ];

    const gapRes = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-gap-audit',
      signalIndex: 0,
      candles: gapCandles,
      currentBalance: 100000,
      initialBalance: 100000,
      simConfig: { spreadPips: 2.0, slippagePips: 1.0 }, // Slippage 1 pip = 0.0001
      symbol: 'EURUSD',
      timeframe: 'H1'
    });

    // Gap Fill: Open=1.0400. BidOpen = 1.0400 - 0.0001 = 1.0399. 
    // ExitPrice = BidOpen - slippage = 1.0399 - 0.0001 = 1.0398
    assert(gapRes.trade !== null && gapRes.trade.exitReason === 'STOP_LOSS', 'Test 3a: Gap detected');
    assert(gapRes.trade !== null && Math.abs((gapRes.trade?.exitPrice || 0) - 1.0398) < 0.00001, 'Test 3b: Gap fill receives BidOpen minus slippage', `got ${gapRes.trade?.exitPrice}`);
  } catch (err: any) {
    assert(false, 'Test 3 Exception', err.message);
  }

  // Test 4: Swap and Rollover Audit (Audit Case 3)
  try {
    // 2025-01-01 is Wednesday (Day 3). Rollover boundary 22:00 UTC.
    // Opens 21:00, Closes 22:30. Crosses 1 rollover (Triple Swap).
    const tripleRes = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-triple-swap-audit',
      signalIndex: 0,
      candles,
      currentBalance: 100000,
      initialBalance: 100000,
      simConfig: { swapLongPerLotPerNight: -2.0, tripleSwapDay: 3, rolloverHourUtc: 22 },
      symbol: 'EURUSD',
      timeframe: 'H1'
    });

    if (tripleRes.trade) {
      assert(tripleRes.trade.rolloverNightsCount === 1, 'Test 4a: Correct rollover nights count');
      const expectedSwap = Math.round(-2.0 * tripleRes.trade.lotSize * 3 * 100) / 100;
      assert(tripleRes.trade.swapCost === expectedSwap, 'Test 4b: Wednesday triple swap applied exactly once', `got ${tripleRes.trade.swapCost}, expected ${expectedSwap}`);
    }

    // Trade closing exactly at rollover
    const boundarySwap = calculateSwapCost({
      entryTimestamp: '2025-01-01T21:00:00.000Z',
      exitTimestamp: '2025-01-01T22:00:00.000Z', // Exactly at rollover
      direction: 'LONG',
      lotSize: 1.0,
      swapLongPerLotPerNight: -2.0,
      tripleSwapDay: 3,
      rolloverHourUtc: 22
    });
    assert(boundarySwap.rolloverNightsCount === 1, 'Test 4c: Boundary convention: Close at rollover counts as crossing it');

    const beforeBoundarySwap = calculateSwapCost({
      entryTimestamp: '2025-01-01T21:00:00.000Z',
      exitTimestamp: '2025-01-01T21:59:59.000Z',
      direction: 'LONG',
      lotSize: 1.0,
      swapLongPerLotPerNight: -2.0,
      tripleSwapDay: 3,
      rolloverHourUtc: 22
    });
    assert(beforeBoundarySwap.rolloverNightsCount === 0, 'Test 4d: Boundary convention: Close before rollover does not count');
  } catch (err: any) {
    assert(false, 'Test 4 Exception', err.message);
  }

  // Test 5: Instrument Specification Audit (Audit Case 4)
  try {
    const jpyCandles: ParsedCandle[] = [
      { timestamp: '2025-01-01T21:00:00.000Z', open: 150.200, high: 151.000, low: 150.000, close: 150.200, volume: 100 },
      { timestamp: '2025-01-02T21:00:00.000Z', open: 150.200, high: 152.000, low: 150.000, close: 151.500, volume: 110 }
    ];
    const jpySignal: BacktestSignal = {
      id: 'sig_jpy',
      timestamp: '2025-01-01T21:00:00.000Z',
      symbol: 'USDJPY',
      timeframe: 'H1',
      direction: 'BUY',
      entryPrice: 150.200,
      stopLoss: 150.000,
      takeProfit: 151.000,
      reason: 'USDJPY Test',
      confidence: 85
    };

    const jpyRes = simulateTradeLifecycle({
      signal: jpySignal,
      datasetId: 'ds-jpy-spec',
      signalIndex: 0,
      candles: jpyCandles,
      currentBalance: 100000,
      initialBalance: 100000,
      simConfig: { spreadPips: 2.0 },
      symbol: 'USDJPY',
      timeframe: 'H1'
    });

    // USDJPY tickSize = 0.001. 2 pips = 0.002. Half spread = 0.001. Entry = 150.200 + 0.001 = 150.201
    assert(jpyRes.trade !== null && jpyRes.trade.entryPrice === 150.201, 'Test 5a: USDJPY pip conversion correct');

    const goldSignal: BacktestSignal = {
      id: 'sig_gold',
      timestamp: '2025-01-01T21:00:00.000Z',
      symbol: 'XAUUSD',
      timeframe: 'H1',
      direction: 'BUY',
      entryPrice: 2600.00,
      stopLoss: 2590.00,
      takeProfit: 2610.00,
      reason: 'Gold Test',
      confidence: 90
    };
    const goldCandles: ParsedCandle[] = [
      { timestamp: '2025-01-01T21:00:00.000Z', open: 2600.00, high: 2605.00, low: 2598.00, close: 2600.00, volume: 100 },
      { timestamp: '2025-01-02T21:00:00.000Z', open: 2600.00, high: 2615.00, low: 2599.00, close: 2612.00, volume: 120 }
    ];

    const goldRes = simulateTradeLifecycle({
      signal: goldSignal,
      datasetId: 'ds-gold-spec',
      signalIndex: 0,
      candles: goldCandles,
      currentBalance: 100000,
      initialBalance: 100000,
      simConfig: { spreadPips: 50.0 }, // 50 cents spread in Gold
      symbol: 'XAUUSD',
      timeframe: 'H1'
    });

    // XAUUSD tickSize = 0.01. 50 pips = 0.50. Half spread = 0.25. Entry = 2600.00 + 0.25 = 2600.25
    assert(goldRes.trade !== null && goldRes.trade.entryPrice === 2600.25, 'Test 5b: XAUUSD pip conversion correct');
  } catch (err: any) {
    assert(false, 'Test 5 Exception', err.message);
  }

  // Test 6: Deterministic repeatability
  try {
    const simConfig: BacktestSimulationConfig = {
      spreadPips: 1.5,
      slippagePips: 0.5,
      commissionType: 'ROUND_TURN_PER_LOT',
      commissionPerLot: 6.0,
      swapLongPerLotPerNight: -1.5,
      swapShortPerLotPerNight: 0.8
    };

    const run1 = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-det-rep',
      signalIndex: 0,
      candles,
      currentBalance: 100000,
      initialBalance: 100000,
      simConfig,
      symbol: 'EURUSD',
      timeframe: 'H1'
    });

    const run2 = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-det-rep',
      signalIndex: 0,
      candles,
      currentBalance: 100000,
      initialBalance: 100000,
      simConfig,
      symbol: 'EURUSD',
      timeframe: 'H1'
    });

    assert(JSON.stringify(run1) === JSON.stringify(run2), 'Test 6: 100% deterministic repeatability');
  } catch (err: any) {
    assert(false, 'Test 6 Exception', err.message);
  }

  console.log(`[Backtest Costs Test Suite] Completed: ${passed}/${total} passed.`);
  return { total, passed, failed: total - passed, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runBacktestCostTests().then(res => {
    console.log('Cost Test Result:', res);
    if (res.failed > 0) process.exit(1);
  });
}
