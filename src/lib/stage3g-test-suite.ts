import { getUserPerformanceSnapshot, getEvidenceTier, getPerformanceState } from './performance-snapshot.js';
import { getLearningStatus } from './learning-status.js';

export async function runStage3GTestSuite(): Promise<{ success: boolean; passed: number; total: number; logs: string[] }> {
  const logs: string[] = [];
  let passed = 0;
  let total = 0;

  function assert(condition: boolean, message: string) {
    total++;
    if (condition) {
      passed++;
      logs.push(`[PASS] ${message}`);
    } else {
      logs.push(`[FAIL] ${message}`);
      console.error(`[STAGE 3G TEST FAIL] ${message}`);
    }
  }

  logs.push('=== STARTING STAGE 3G PERFORMANCE VISIBILITY TEST SUITE ===');

  try {
    // Mock user dataset
    const userA_Trades = [
      {
        id: 't1',
        trade_id: 'TR-A-101',
        user_id: 'user_a',
        pair: 'EURUSD',
        timeframe: 'H1',
        direction: 'BUY',
        strategy_mode: 'TRENDLINE_BREAKOUT',
        market_regime: 'TRENDING_BULLISH',
        execution_score: 85,
        outcome: 'WIN',
        pnl_r: 2.0,
        is_active: false,
        created_at: '2026-06-01T10:00:00Z'
      },
      {
        id: 't2',
        trade_id: 'TR-A-102',
        user_id: 'user_a',
        pair: 'EURUSD',
        timeframe: 'H1',
        direction: 'SELL',
        strategy_mode: 'TRENDLINE_BREAKOUT',
        market_regime: 'TRENDING_BEARISH',
        execution_score: 90,
        outcome: 'WIN',
        pnl_r: 1.5,
        is_active: false,
        created_at: '2026-06-02T10:00:00Z'
      },
      {
        id: 't3',
        trade_id: 'TR-A-103',
        user_id: 'user_a',
        pair: 'GBPUSD',
        timeframe: 'M15',
        direction: 'BUY',
        strategy_mode: 'LIQUIDITY_SWEEP',
        market_regime: 'VOLATILE',
        execution_score: 40,
        outcome: 'LOSS',
        pnl_r: -1.0,
        is_active: false,
        created_at: '2026-06-03T10:00:00Z'
      },
      {
        id: 't4',
        trade_id: 'TR-A-104',
        user_id: 'user_a',
        pair: 'GBPUSD',
        timeframe: 'M15',
        direction: 'BUY',
        strategy_mode: 'LIQUIDITY_SWEEP',
        market_regime: 'VOLATILE',
        execution_score: 55,
        outcome: 'BREAKEVEN',
        pnl_r: 0.0,
        is_active: false,
        created_at: '2026-06-04T10:00:00Z'
      }
    ];

    const userB_Trades = [
      {
        id: 'tb1',
        trade_id: 'TR-B-999',
        user_id: 'user_b',
        pair: 'XAUUSD',
        timeframe: 'M5',
        direction: 'BUY',
        strategy_mode: 'SCALP',
        market_regime: 'RANGE',
        execution_score: 95,
        outcome: 'LOSS',
        pnl_r: -5.0,
        is_active: false,
        created_at: '2026-06-05T10:00:00Z'
      }
    ];

    const uncompletedTrades = [
      {
        id: 't_active',
        trade_id: 'TR-A-ACTIVE',
        user_id: 'user_a',
        pair: 'EURUSD',
        timeframe: 'H1',
        direction: 'BUY',
        outcome: 'ACTIVE',
        pnl_r: 0,
        is_active: true
      },
      {
        id: 't_rejected',
        trade_id: 'TR-A-REJECTED',
        user_id: 'user_a',
        pair: 'EURUSD',
        timeframe: 'H1',
        direction: 'BUY',
        outcome: 'NO_TRADE',
        pnl_r: 0,
        is_active: false
      }
    ];

    const combinedTrades = [...userA_Trades, ...userB_Trades, ...uncompletedTrades];

    // Test 1: Evidence Tier Helpers
    assert(getEvidenceTier(5) === 'INSUFFICIENT', 'getEvidenceTier(5) should return INSUFFICIENT');
    assert(getEvidenceTier(15) === 'WEAK', 'getEvidenceTier(15) should return WEAK');
    assert(getEvidenceTier(25) === 'MODERATE', 'getEvidenceTier(25) should return MODERATE');
    assert(getEvidenceTier(35) === 'STRONG', 'getEvidenceTier(35) should return STRONG');

    // Test 2: Performance State Helper
    assert(getPerformanceState(5, 0.5, 60) === 'INSUFFICIENT_DATA', 'Small sample should yield INSUFFICIENT_DATA');
    assert(getPerformanceState(15, 0.3, 55) === 'HEALTHY', 'Good metrics with N>=10 should yield HEALTHY');
    assert(getPerformanceState(15, -0.2, 30) === 'POOR', 'Negative metrics with N>=10 should yield POOR');

    // Test 3: Snapshot Generation & Strict User Isolation
    const snapshotA = await getUserPerformanceSnapshot('user_a', { completedTrades: combinedTrades });
    assert(snapshotA.userId === 'user_a', 'Snapshot userId matches user_a');
    assert(snapshotA.totalCompletedTrades === 4, 'Snapshot user_a excludes user_b and active/rejected trades');
    assert(snapshotA.wins === 2, 'user_a wins count is 2');
    assert(snapshotA.losses === 1, 'user_a losses count is 1');
    assert(snapshotA.breakevens === 1, 'user_a breakevens count is 1');
    assert(snapshotA.winRate === 50, 'user_a win rate is 50%');
    assert(snapshotA.totalRealizedR === 2.5, 'user_a total realized R is 2.5R (+2 +1.5 -1 +0)');

    // Test 4: Dynamic Breakdown by Pair
    assert(Boolean(snapshotA.breakdownByPair['EURUSD']), 'EURUSD exists in pair breakdown');
    assert(snapshotA.breakdownByPair['EURUSD'].sampleSize === 2, 'EURUSD trade count is 2');
    assert(snapshotA.breakdownByPair['EURUSD'].wins === 2, 'EURUSD wins count is 2');
    assert(Boolean(snapshotA.breakdownByPair['GBPUSD']), 'GBPUSD exists in pair breakdown');
    assert(snapshotA.breakdownByPair['GBPUSD'].sampleSize === 2, 'GBPUSD trade count is 2');
    assert(snapshotA.breakdownByPair['XAUUSD'] === undefined, 'XAUUSD (belonging to user_b) is absent from user_a breakdown');

    // Test 5: Dynamic Breakdown by Setup
    assert(Boolean(snapshotA.breakdownBySetup['TRENDLINE_BREAKOUT']), 'TRENDLINE_BREAKOUT setup exists in breakdown');
    assert(snapshotA.breakdownBySetup['TRENDLINE_BREAKOUT'].sampleSize === 2, 'TRENDLINE_BREAKOUT sample size is 2');

    // Test 6: Dynamic Breakdown by Direction
    assert(Boolean(snapshotA.breakdownByDirection['BUY']), 'BUY direction exists');
    assert(Boolean(snapshotA.breakdownByDirection['SELL']), 'SELL direction exists');

    // Test 7: Dynamic Breakdown by Execution Timing
    assert(Boolean(snapshotA.breakdownByExecutionTiming['GOOD']), 'GOOD execution timing exists (score >= 80)');
    assert(snapshotA.breakdownByExecutionTiming['GOOD'].sampleSize === 2, 'GOOD execution count is 2 (scores 85, 90)');

    // Test 8: Risk Governor Visibility
    assert(snapshotA.riskGovernorVisibility !== undefined, 'Risk governor visibility block is populated');
    assert(snapshotA.riskGovernorVisibility.status === 'NORMAL', 'Governor status is NORMAL for positive expectancy user_a');

    // Test 9: Learning Status Explanations
    const learningStatusA = await getLearningStatus('user_a', { completedTrades: combinedTrades });
    assert(learningStatusA.userId === 'user_a', 'LearningStatus userId matches user_a');
    assert(typeof learningStatusA.summary === 'string' && learningStatusA.summary.length > 0, 'Summary is a non-empty string');
    assert(learningStatusA.keyInsights.length > 0, 'Key insights populated');
    assert(learningStatusA.pairInsights.length > 0, 'Pair insights populated');
    assert(learningStatusA.governorInsight.length > 0, 'Governor insight populated');

    // Test 10: Empty User Profile Safety
    const snapshotEmpty = await getUserPerformanceSnapshot('user_empty', { completedTrades: [] });
    assert(snapshotEmpty.totalCompletedTrades === 0, 'Empty user yields 0 total completed trades');
    assert(snapshotEmpty.winRate === 0, 'Empty user yields 0% win rate');
    assert(snapshotEmpty.evidenceTier === 'INSUFFICIENT', 'Empty user evidence tier is INSUFFICIENT');

    const learningEmpty = await getLearningStatus('user_empty', { completedTrades: [] });
    assert(learningEmpty.summary.includes('Insufficient completed trades'), 'Empty user learning status indicates insufficient trades');

    logs.push(`=== STAGE 3G TEST SUITE PASSED (${passed}/${total} assertions) ===`);
    return { success: passed === total, passed, total, logs };
  } catch (err: any) {
    logs.push(`[CRITICAL ERROR] ${err.message || String(err)}`);
    return { success: false, passed, total: total + 1, logs };
  }
}
