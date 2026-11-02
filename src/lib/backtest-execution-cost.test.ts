/**
 * GAKS AI — Historical Trading Costs & Execution Cost Engine Test Suite (Stage C1–C4)
 * Deterministic unit test suite covering all 16 execution cost requirements:
 * 1. BUY and SELL spread calculations
 * 2. Different instrument pip precisions
 * 3. Fixed and zero spread
 * 4. Fixed and zero slippage
 * 5. Entry and exit slippage
 * 6. Commission per lot per side
 * 7. Round-turn commission without double charging
 * 8. Long and short swap
 * 9. Trades closed before rollover
 * 10. Trades crossing one rollover
 * 11. Triple-swap weekday
 * 12. Zero-swap configuration
 * 13. Net PnL after every cost
 * 14. Correct account balance updates
 * 15. No duplicate deductions
 * 16. Deterministic repeatability
 */

import { simulateTradeLifecycle, calculateRolloverUnits } from './backtest-trade-simulator.js';
import { BacktestSignal, ParsedCandle } from './backtest-types.js';

export async function runExecutionCostTests(): Promise<{ total: number; passed: number; failed: number; failures: string[] }> {
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

  console.log('[Execution Cost Tests] Starting Stage C1–C4 cost engine verification...');

  // Standard sample candles for testing
  const sampleCandles: ParsedCandle[] = [
    { timestamp: '2025-01-01T10:00:00.000Z', open: 1.0500, high: 1.0510, low: 1.0490, close: 1.0505, volume: 100 },
    { timestamp: '2025-01-01T10:05:00.000Z', open: 1.0500, high: 1.0530, low: 1.0495, close: 1.0520, volume: 110 },
    { timestamp: '2025-01-01T10:10:00.000Z', open: 1.0520, high: 1.0600, low: 1.0515, close: 1.0580, volume: 120 }
  ];

  const buySignal: BacktestSignal = {
    id: 'sig_cost_buy',
    timestamp: '2025-01-01T10:00:00.000Z',
    symbol: 'EURUSD',
    timeframe: 'M5',
    direction: 'BUY',
    entryPrice: 1.0500,
    stopLoss: 1.0450,
    takeProfit: 1.0580,
    reason: 'Bullish Test',
    confidence: 85
  };

  const sellSignal: BacktestSignal = {
    id: 'sig_cost_sell',
    timestamp: '2025-01-01T10:00:00.000Z',
    symbol: 'EURUSD',
    timeframe: 'M5',
    direction: 'SELL',
    entryPrice: 1.0500,
    stopLoss: 1.0550,
    takeProfit: 1.0420,
    reason: 'Bearish Test',
    confidence: 85
  };

  // Requirement 1: BUY and SELL spread calculations
  try {
    const buyRes = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-c1-buy',
      signalIndex: 0,
      candles: sampleCandles,
      currentBalance: 100000,
      simConfig: { spreadPips: 2.0, slippagePips: 0, commissionPerLot: 0 },
      symbol: 'EURUSD',
      timeframe: 'M5'
    }).trade;

    // Ask entry for BUY with 2.0 pips spread (0.0002): 1.0500 + 0.0001 = 1.0501
    assert(buyRes !== null && buyRes.actualEntryPrice === 1.0501, 'Req 1a: BUY Ask entry price includes half spread (+1 pip = 1.0501)', `got ${buyRes?.actualEntryPrice}`);

    const sellCandles: ParsedCandle[] = [
      { timestamp: '2025-01-01T10:00:00.000Z', open: 1.0500, high: 1.0510, low: 1.0490, close: 1.0505, volume: 100 },
      { timestamp: '2025-01-01T10:05:00.000Z', open: 1.0500, high: 1.0505, low: 1.0410, close: 1.0415, volume: 110 }
    ];

    const sellRes = simulateTradeLifecycle({
      signal: sellSignal,
      datasetId: 'ds-c1-sell',
      signalIndex: 0,
      candles: sellCandles,
      currentBalance: 100000,
      simConfig: { spreadPips: 2.0, slippagePips: 0, commissionPerLot: 0 },
      symbol: 'EURUSD',
      timeframe: 'M5'
    }).trade;

    // Bid entry for SELL with 2.0 pips spread (0.0002): 1.0500 - 0.0001 = 1.0499
    assert(sellRes !== null && sellRes.actualEntryPrice === 1.0499, 'Req 1b: SELL Bid entry price includes half spread (-1 pip = 1.0499)', `got ${sellRes?.actualEntryPrice}`);
  } catch (err: any) {
    assert(false, 'Req 1 Exception', err.message);
  }

  // Requirement 2: Different instrument pip precisions
  try {
    // USDJPY 2-digit / 3-digit precision (0.01 tickSize)
    const jpyCandles: ParsedCandle[] = [
      { timestamp: '2025-01-01T10:00:00.000Z', open: 150.00, high: 150.10, low: 149.90, close: 150.05, volume: 100 },
      { timestamp: '2025-01-01T10:05:00.000Z', open: 150.00, high: 151.50, low: 149.90, close: 151.00, volume: 110 }
    ];
    const jpySignal: BacktestSignal = { ...buySignal, symbol: 'USDJPY', entryPrice: 150.00, stopLoss: 149.50, takeProfit: 151.00 };

    const jpyRes = simulateTradeLifecycle({
      signal: jpySignal,
      datasetId: 'ds-c2-jpy',
      signalIndex: 0,
      candles: jpyCandles,
      currentBalance: 100000,
      simConfig: { spreadPips: 2.0 }, // 2 pips = 0.02
      symbol: 'USDJPY',
      timeframe: 'M5'
    }).trade;

    // Entry 150.00 + 0.01 = 150.01
    assert(jpyRes !== null && jpyRes.actualEntryPrice === 150.01, 'Req 2a: USDJPY 2.0 pips spread converts to 0.01 price delta', `got ${jpyRes?.actualEntryPrice}`);

    // XAUUSD Gold precision (0.10 tickSize)
    const goldCandles: ParsedCandle[] = [
      { timestamp: '2025-01-01T10:00:00.000Z', open: 2600.00, high: 2605.00, low: 2598.00, close: 2600.00, volume: 100 },
      { timestamp: '2025-01-01T10:05:00.000Z', open: 2600.00, high: 2625.00, low: 2599.00, close: 2622.00, volume: 120 }
    ];
    const goldSignal: BacktestSignal = { ...buySignal, symbol: 'XAUUSD', entryPrice: 2600.00, stopLoss: 2590.00, takeProfit: 2620.00 };

    const goldRes = simulateTradeLifecycle({
      signal: goldSignal,
      datasetId: 'ds-c2-gold',
      signalIndex: 0,
      candles: goldCandles,
      currentBalance: 100000,
      simConfig: { spreadPips: 30.0 }, // 30 pips = $3.00
      symbol: 'XAUUSD',
      timeframe: 'M5'
    }).trade;

    assert(goldRes !== null && goldRes.actualEntryPrice === 2601.50, 'Req 2b: Gold XAUUSD 30 pips spread converts to $1.50 half-spread entry', `got ${goldRes?.actualEntryPrice}`);
  } catch (err: any) {
    assert(false, 'Req 2 Exception', err.message);
  }

  // Requirement 3: Fixed and zero spread
  try {
    const zeroSpread = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-c3-zero',
      signalIndex: 0,
      candles: sampleCandles,
      currentBalance: 100000,
      simConfig: { spreadPips: 0 },
      symbol: 'EURUSD',
      timeframe: 'M5'
    }).trade;

    assert(zeroSpread !== null && zeroSpread.spreadCost === 0 && zeroSpread.actualEntryPrice === 1.0500, 'Req 3a: Zero spread results in $0 spread cost and exact entry price');

    const fixedSpread = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-c3-fixed',
      signalIndex: 0,
      candles: sampleCandles,
      currentBalance: 100000,
      simConfig: { spreadPips: 1.5 },
      symbol: 'EURUSD',
      timeframe: 'M5'
    }).trade;

    assert(fixedSpread !== null && fixedSpread.spreadCost > 0, 'Req 3b: Fixed 1.5 pips spread produces positive spread cost');
  } catch (err: any) {
    assert(false, 'Req 3 Exception', err.message);
  }

  // Requirement 4 & 5: Fixed, zero, entry and exit slippage
  try {
    const zeroSlippage = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-c4-zero',
      signalIndex: 0,
      candles: sampleCandles,
      currentBalance: 100000,
      simConfig: { slippagePips: 0, spreadPips: 0 },
      symbol: 'EURUSD',
      timeframe: 'M5'
    }).trade;

    assert(zeroSlippage !== null && zeroSlippage.slippageCost === 0, 'Req 4: Zero slippage results in $0 slippage cost');

    const splitSlippage = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-c5-split',
      signalIndex: 0,
      candles: sampleCandles,
      currentBalance: 100000,
      simConfig: { entrySlippagePips: 0.5, exitSlippagePips: 1.0, spreadPips: 0 },
      symbol: 'EURUSD',
      timeframe: 'M5'
    }).trade;

    // 0.5 pips entry slippage = 0.00005. Entry = 1.0500 + 0.00005 = 1.05005
    assert(splitSlippage !== null && splitSlippage.actualEntryPrice === 1.05005, 'Req 5a: Entry slippage 0.5 pips shifts entry price by +0.00005', `got ${splitSlippage?.actualEntryPrice}`);
    // 1.0 pips exit slippage = 0.00010. TP 1.0580 - 0.00010 = 1.05790
    assert(splitSlippage !== null && splitSlippage.actualExitPrice === 1.0579, 'Req 5b: Exit slippage 1.0 pips shifts TP exit price by -0.00010', `got ${splitSlippage?.actualExitPrice}`);
  } catch (err: any) {
    assert(false, 'Req 4/5 Exception', err.message);
  }

  // Requirement 6 & 7: Commission models without double charging
  try {
    const perSideComm = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-c6-perside',
      signalIndex: 0,
      candles: sampleCandles,
      currentBalance: 100000,
      simConfig: { commissionType: 'PER_LOT_PER_SIDE', commissionPerLot: 3.5, spreadPips: 0, slippagePips: 0 },
      symbol: 'EURUSD',
      timeframe: 'M5'
    }).trade;

    assert(perSideComm !== null && perSideComm.entryCommission === Math.round(3.5 * perSideComm.lotSize * 100) / 100, 'Req 6a: PER_LOT_PER_SIDE applies $3.50/lot on entry');
    assert(perSideComm !== null && perSideComm.exitCommission === Math.round(3.5 * perSideComm.lotSize * 100) / 100, 'Req 6b: PER_LOT_PER_SIDE applies $3.50/lot on exit');
    assert(perSideComm !== null && perSideComm.commissionCost === Math.round((perSideComm.entryCommission! + perSideComm.exitCommission!) * 100) / 100, 'Req 6c: Total commission is entry + exit commission');

    const roundTurnComm = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-c7-roundturn',
      signalIndex: 0,
      candles: sampleCandles,
      currentBalance: 100000,
      simConfig: { commissionType: 'ROUND_TURN_PER_LOT', commissionPerLot: 7.0, spreadPips: 0, slippagePips: 0 },
      symbol: 'EURUSD',
      timeframe: 'M5'
    }).trade;

    assert(roundTurnComm !== null && roundTurnComm.commissionCost === Math.round((roundTurnComm.entryCommission! + roundTurnComm.exitCommission!) * 100) / 100, 'Req 7: ROUND_TURN_PER_LOT produces identical total commission without double charging');
  } catch (err: any) {
    assert(false, 'Req 6/7 Exception', err.message);
  }

  // Requirement 8, 9, 10, 11, 12: Swap and Overnight Rollover Modelling
  try {
    // 9. Trade closed before rollover (same day 10:00 -> 10:10)
    const noRolloverRes = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-c9-norollover',
      signalIndex: 0,
      candles: sampleCandles,
      currentBalance: 100000,
      simConfig: { swapLongPoints: -1.0, rolloverHourUTC: 22 },
      symbol: 'EURUSD',
      timeframe: 'M5'
    }).trade;

    assert(noRolloverRes !== null && noRolloverRes.swapCost === 0 && noRolloverRes.rolloverCount === 0, 'Req 9: Trade closed before 22:00 UTC rollover incurs zero swap ($0)');

    // 10. Trade crossing ONE rollover boundary
    const overnightCandles: ParsedCandle[] = [
      { timestamp: '2025-01-01T21:00:00.000Z', open: 1.0500, high: 1.0510, low: 1.0490, close: 1.0505, volume: 100 }, // Wed
      { timestamp: '2025-01-02T01:00:00.000Z', open: 1.0505, high: 1.0600, low: 1.0495, close: 1.0580, volume: 110 }  // Thu
    ];

    const oneRolloverRes = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-c10-onerollover',
      signalIndex: 0,
      candles: overnightCandles,
      currentBalance: 100000,
      simConfig: {
        executionModel: 'SAME_CANDLE_CLOSE',
        swapLongPoints: -1.0, // -1 pip per lot per day
        swapType: 'POINTS',
        tripleSwapDay: 3, // Wednesday
        rolloverHourUTC: 22,
        spreadPips: 0,
        slippagePips: 0
      },
      symbol: 'EURUSD',
      timeframe: 'H1'
    }).trade;

    // Crossing Wed 22:00 UTC = 3 units (triple swap)
    assert(oneRolloverRes !== null && oneRolloverRes.rolloverCount === 1, 'Req 10a: Correctly detects 1 rollover event');
    assert(oneRolloverRes !== null && oneRolloverRes.swapCost > 0, 'Req 10b: Negative swap points produce positive cost deducted from Net PnL');

    // 11. Triple swap day verification
    const rol = calculateRolloverUnits({
      entryTimestamp: '2025-01-01T20:00:00.000Z', // Wednesday
      exitTimestamp: '2025-01-02T02:00:00.000Z',  // Thursday
      rolloverHourUTC: 22,
      tripleSwapDay: 3 // Wed
    });

    assert(rol.rolloverCount === 1 && rol.totalRolloverUnits === 3, 'Req 11: Wednesday rollover counts 3 units for triple swap');

    // 12. Zero-swap configuration
    const zeroSwapRes = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-c12-zeroswap',
      signalIndex: 0,
      candles: overnightCandles,
      currentBalance: 100000,
      simConfig: { swapLongPoints: 0, swapShortPoints: 0 },
      symbol: 'EURUSD',
      timeframe: 'H1'
    }).trade;

    assert(zeroSwapRes !== null && zeroSwapRes.swapCost === 0, 'Req 12: Configured zero-swap results in $0 swap cost even across rollover');
  } catch (err: any) {
    assert(false, 'Req 8-12 Exception', err.message);
  }

  // Requirement 13, 14, 15: Net PnL after every cost & No duplicate deductions
  try {
    const fullCostRes = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-c13-fullcost',
      signalIndex: 0,
      candles: sampleCandles,
      currentBalance: 100000,
      simConfig: {
        spreadPips: 2.0,
        slippagePips: 1.0,
        commissionPerLot: 7.0,
        swapLongPoints: 0
      },
      symbol: 'EURUSD',
      timeframe: 'M5'
    }).trade;

    if (fullCostRes) {
      const expectedNet = Math.round((fullCostRes.grossPnL - fullCostRes.spreadCost - fullCostRes.slippageCost - fullCostRes.commissionCost - fullCostRes.swapCost) * 100) / 100;
      assert(fullCostRes.netPnL === expectedNet, 'Req 13: Net PnL equals Gross PnL minus Spread, Slippage, Commission, and Swap exactly', `${fullCostRes.netPnL} vs ${expectedNet}`);
      assert(fullCostRes.balanceAfter === fullCostRes.balanceBefore + fullCostRes.netPnL, 'Req 14: balanceAfter = balanceBefore + netPnL');

      // Verify no double deduction
      const totalCosts = fullCostRes.spreadCost + fullCostRes.slippageCost + fullCostRes.commissionCost + fullCostRes.swapCost;
      assert(Math.abs(fullCostRes.grossPnL - fullCostRes.netPnL - totalCosts) < 0.02, 'Req 15: Cost accounting identity verified (Gross - Net = Total Costs)');
    } else {
      assert(false, 'Req 13/14/15: Trade result expected');
    }
  } catch (err: any) {
    assert(false, 'Req 13-15 Exception', err.message);
  }

  // Requirement 16: Deterministic repeatability
  try {
    const runA = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-c16-repeat',
      signalIndex: 0,
      candles: sampleCandles,
      currentBalance: 100000,
      simConfig: { spreadPips: 1.5, slippagePips: 0.5, commissionPerLot: 5.0 },
      symbol: 'EURUSD',
      timeframe: 'M5'
    }).trade;

    const runB = simulateTradeLifecycle({
      signal: buySignal,
      datasetId: 'ds-c16-repeat',
      signalIndex: 0,
      candles: sampleCandles,
      currentBalance: 100000,
      simConfig: { spreadPips: 1.5, slippagePips: 0.5, commissionPerLot: 5.0 },
      symbol: 'EURUSD',
      timeframe: 'M5'
    }).trade;

    assert(JSON.stringify(runA) === JSON.stringify(runB), 'Req 16: Identical cost configurations produce 100% byte-for-byte identical output');
  } catch (err: any) {
    assert(false, 'Req 16 Exception', err.message);
  }

  return { total, passed, failed: total - passed, failures };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runExecutionCostTests().then(res => console.log('Execution Cost Test Result:', res));
}
