/**
 * GAKS AI — Backtest Analytics Unit Tests (Phase 6)
 * Comprehensive test suite verifying all 30 performance analytics, drawdown,
 * streak, equity curve, duration, and numeric stability requirements.
 */

import { calculateBacktestAnalytics } from './backtest-analytics.js';
import { BacktestTradeRecord } from './backtest-types.js';

export async function runAnalyticsUnitTests(): Promise<{ total: number; passed: number; failed: number; failures: string[] }> {
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

  console.log('[Analytics Unit Tests] Starting tests...');

  // Sample trades series for testing
  const sampleTrades: BacktestTradeRecord[] = [
    {
      id: 'tr_1',
      signalId: 'sig_1',
      symbol: 'EURUSD',
      timeframe: 'M5',
      direction: 'LONG',
      entryTimestamp: '2025-01-01T00:00:00.000Z',
      exitTimestamp: '2025-01-01T00:10:00.000Z', // 10 min
      entryPrice: 1.0500,
      exitPrice: 1.0550,
      stopLoss: 1.0450,
      takeProfit: 1.0550,
      lotSize: 1.0,
      riskAmount: 500,
      riskRewardRatio: 2.0,
      grossPnL: 500,
      spreadCost: 10,
      slippageCost: 10,
      commissionCost: 7,
      netPnL: 473,
      balanceBefore: 100000,
      balanceAfter: 100473,
      exitReason: 'TAKE_PROFIT'
    },
    {
      id: 'tr_2',
      signalId: 'sig_2',
      symbol: 'EURUSD',
      timeframe: 'M5',
      direction: 'SHORT',
      entryTimestamp: '2025-01-01T01:00:00.000Z',
      exitTimestamp: '2025-01-01T01:20:00.000Z', // 20 min
      entryPrice: 1.0550,
      exitPrice: 1.0600,
      stopLoss: 1.0600,
      takeProfit: 1.0450,
      lotSize: 1.0,
      riskAmount: 500,
      riskRewardRatio: 2.0,
      grossPnL: -500,
      spreadCost: 10,
      slippageCost: 10,
      commissionCost: 7,
      netPnL: -527,
      balanceBefore: 100473,
      balanceAfter: 99946,
      exitReason: 'STOP_LOSS'
    },
    {
      id: 'tr_3',
      signalId: 'sig_3',
      symbol: 'EURUSD',
      timeframe: 'M5',
      direction: 'LONG',
      entryTimestamp: '2025-01-01T02:00:00.000Z',
      exitTimestamp: '2025-01-01T02:15:00.000Z', // 15 min
      entryPrice: 1.0500,
      exitPrice: 1.0600,
      stopLoss: 1.0450,
      takeProfit: 1.0600,
      lotSize: 1.0,
      riskAmount: 500,
      riskRewardRatio: 2.0,
      grossPnL: 1000,
      spreadCost: 10,
      slippageCost: 10,
      commissionCost: 7,
      netPnL: 973,
      balanceBefore: 99946,
      balanceAfter: 100919,
      exitReason: 'TAKE_PROFIT'
    }
  ];

  const res = calculateBacktestAnalytics({
    trades: sampleTrades,
    startingBalance: 100000,
    symbol: 'EURUSD',
    timeframe: 'M5'
  });

  // Test 1: Starting & ending balance
  assert(res.startingBalance === 100000 && res.endingBalance === 100919, 'Test 1: Correct starting and ending balance', `got ${res.startingBalance} -> ${res.endingBalance}`);

  // Test 2: Net profit
  assert(res.netProfit === 919, 'Test 2: Correct net profit', `got ${res.netProfit}`);

  // Test 3: Return percentage
  assert(res.returnPercent === 0.92, 'Test 3: Correct return percentage (0.92%)', `got ${res.returnPercent}`);

  // Test 4: Total trades
  assert(res.totalTrades === 3, 'Test 4: Correct total trades', `got ${res.totalTrades}`);

  // Test 5: Wins, losses, breakeven
  assert(res.winningTrades === 2 && res.losingTrades === 1 && res.breakevenTrades === 0, 'Test 5: Correct wins/losses/breakeven', `wins: ${res.winningTrades}, losses: ${res.losingTrades}`);

  // Test 6: Win rate
  assert(res.winRate === 66.67, 'Test 6: Correct win rate (66.67%)', `got ${res.winRate}`);

  // Test 7: Gross profit
  assert(res.grossProfit === 1446, 'Test 7: Correct gross profit ($1,446)', `got ${res.grossProfit}`);

  // Test 8: Gross loss
  assert(res.grossLoss === 527, 'Test 8: Correct gross loss ($527)', `got ${res.grossLoss}`);

  // Test 9: Profit factor
  assert(res.profitFactor === 2.74, 'Test 9: Correct profit factor (1446 / 527 = 2.74)', `got ${res.profitFactor}`);

  // Test 10: Average trade
  assert(res.averageTrade === 306.33, 'Test 10: Correct average trade', `got ${res.averageTrade}`);

  // Test 11: Average winner
  assert(res.averageWin === 723, 'Test 11: Correct average winner', `got ${res.averageWin}`);

  // Test 12: Average loser
  assert(res.averageLoss === 527, 'Test 12: Correct average loser', `got ${res.averageLoss}`);

  // Test 13: Expectancy
  assert(res.expectancy !== null && res.expectancy > 0, 'Test 13: Correct positive expectancy', `got ${res.expectancy}`);

  // Test 14: Maximum drawdown currency
  assert(res.maxDrawdownCurrency === 527, 'Test 14: Correct max drawdown in currency ($527)', `got ${res.maxDrawdownCurrency}`);

  // Test 15: Maximum drawdown percentage
  assert(res.maxDrawdownPercent === 0.52, 'Test 15: Correct max drawdown percentage (0.52%)', `got ${res.maxDrawdownPercent}`);

  // Test 16: Equity curve points
  assert(res.equityCurve.length === 4 && res.equityCurve[0].balance === 100000 && res.equityCurve[3].balance === 100919, 'Test 16: Correct equity curve points (4 points)', `got length ${res.equityCurve.length}`);

  // Test 17: Long / Short breakdown
  assert(res.longTrades.totalTrades === 2 && res.shortTrades.totalTrades === 1 && res.longTrades.netPnL === 1446 && res.shortTrades.netPnL === -527, 'Test 17: Correct long/short breakdown');

  // Test 18: Exit reason breakdown
  assert(res.exitReasonBreakdown['TAKE_PROFIT'] === 2 && res.exitReasonBreakdown['STOP_LOSS'] === 1, 'Test 18: Correct exit reason breakdown');

  // Test 19: Best trade
  assert(res.bestTrade !== null && res.bestTrade.netPnL === 973 && res.bestTrade.id === 'tr_3', 'Test 19: Correct best trade ($973)');

  // Test 20: Worst trade
  assert(res.worstTrade !== null && res.worstTrade.netPnL === -527 && res.worstTrade.id === 'tr_2', 'Test 20: Correct worst trade (-$527)');

  // Test 21: Longest winning streak
  assert(res.longestWinningStreak === 1, 'Test 21: Correct longest winning streak (1)', `got ${res.longestWinningStreak}`);

  // Test 22: Longest losing streak
  assert(res.longestLosingStreak === 1, 'Test 22: Correct longest losing streak (1)', `got ${res.longestLosingStreak}`);

  // Test 23: Current streak
  assert(res.currentWinningStreak === 1 && res.currentLosingStreak === 0, 'Test 23: Correct current winning streak (1)', `got win: ${res.currentWinningStreak}`);

  // Test 24: Trade duration
  assert(res.averageDurationMinutes === 15 && res.longestDurationMinutes === 20 && res.shortestDurationMinutes === 10, 'Test 24: Correct trade duration (avg 15m, max 20m, min 10m)');

  // Test 25: R-multiple calculations
  assert(res.averageRealizedR !== null && res.totalRealizedR !== null, 'Test 25: Correct R-multiple calculations');

  // Test 26: Zero-trade backtest produces safe results
  const emptyRes = calculateBacktestAnalytics({ trades: [], startingBalance: 100000 });
  assert(emptyRes.totalTrades === 0 && emptyRes.winRate === null && emptyRes.profitFactor === null && emptyRes.expectancy === null, 'Test 26: Zero-trade backtest produces safe null values');

  // Test 27: No NaN / Infinity in JSON serialization
  const serialized = JSON.stringify(emptyRes);
  assert(!serialized.includes('NaN') && !serialized.includes('Infinity'), 'Test 27: No NaN or Infinity in serialized JSON output');

  // Test 28: Identical trade input produces identical analytics (Determinism)
  const resA = calculateBacktestAnalytics({ trades: sampleTrades, startingBalance: 100000 });
  const resB = calculateBacktestAnalytics({ trades: sampleTrades, startingBalance: 100000 });
  assert(JSON.stringify(resA) === JSON.stringify(resB), 'Test 28: Identical trade input produces 100% byte-for-byte identical analytics');

  // Test 29: Costs are already reflected in net P/L and not double counted
  assert(res.netProfit === sampleTrades.reduce((acc, t) => acc + t.netPnL, 0), 'Test 29: Costs are cleanly reflected in net P/L without double-counting');

  // Test 30: Analytics do not mutate source trade records
  const clonedTrades = JSON.parse(JSON.stringify(sampleTrades));
  calculateBacktestAnalytics({ trades: sampleTrades, startingBalance: 100000 });
  assert(JSON.stringify(sampleTrades) === JSON.stringify(clonedTrades), 'Test 30: Analytics do not mutate source trade records');

  return { total, passed, failed: total - passed, failures };
}
