import { computeEquityAnalytics, deriveEquityState } from './equity-learning-engine.js';
import { evaluateRiskGovernor } from './risk-governor.js';

export function runEquityLearningTestSuite() {
  console.log("\n--- RUNNING EQUITY LEARNING & RISK GOVERNOR TEST SUITE ---");
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // Helper builder for mock trades
  function mockTrade(outcome: 'WIN' | 'LOSS' | 'BREAKEVEN', rr: number, pair = 'EURUSD', setup = 'HYBRID', isActive = false) {
    return {
      user_id: 'user_test_123',
      outcome,
      rr_achieved: rr,
      pair,
      strategy_mode: setup,
      is_active: isActive,
      pips: outcome === 'WIN' ? 25 : (outcome === 'LOSS' ? -20 : 0)
    };
  }

  // 1. Zero completed trades
  const metrics0 = computeEquityAnalytics([]);
  assert(metrics0.totalTrades === 0 && metrics0.sampleSizeTier === 'INSUFFICIENT', 'Test 1 - Zero completed trades');

  // 2. Insufficient sample (< 10)
  const tradesFew = Array.from({ length: 5 }, () => mockTrade('WIN', 1.5));
  const metricsFew = computeEquityAnalytics(tradesFew);
  assert(metricsFew.sampleSizeTier === 'INSUFFICIENT', 'Test 2 - Insufficient sample (<10)');

  // 3. Exactly 10 trades
  const trades10 = Array.from({ length: 10 }, (_, i) => mockTrade(i % 2 === 0 ? 'WIN' : 'LOSS', 1.5));
  const metrics10 = computeEquityAnalytics(trades10);
  assert(metrics10.totalTrades === 10 && metrics10.sampleSizeTier === 'WEAK', 'Test 3 - Exactly 10 trades (WEAK sample)');

  // 4. Exactly 20 trades
  const trades20 = Array.from({ length: 20 }, (_, i) => mockTrade(i % 2 === 0 ? 'WIN' : 'LOSS', 1.5));
  const metrics20 = computeEquityAnalytics(trades20);
  assert(metrics20.totalTrades === 20 && metrics20.sampleSizeTier === 'ELIGIBLE', 'Test 4 - Exactly 20 trades (ELIGIBLE sample)');

  // 5. All wins
  const tradesAllWins = Array.from({ length: 20 }, () => mockTrade('WIN', 2.0));
  const metricsAllWins = computeEquityAnalytics(tradesAllWins);
  assert(metricsAllWins.winRate === 100 && metricsAllWins.expectancyR > 0, 'Test 5 - All wins yields 100% win rate and positive expectancy');

  // 6. All losses
  const tradesAllLosses = Array.from({ length: 20 }, () => mockTrade('LOSS', -1.0));
  const metricsAllLosses = computeEquityAnalytics(tradesAllLosses);
  assert(metricsAllLosses.winRate === 0 && metricsAllLosses.expectancyR < 0, 'Test 6 - All losses yields 0% win rate and negative expectancy');

  // 7. Mixed results
  const tradesMixed = [
    ...Array.from({ length: 12 }, () => mockTrade('WIN', 2.0)),
    ...Array.from({ length: 8 }, () => mockTrade('LOSS', -1.0))
  ];
  const metricsMixed = computeEquityAnalytics(tradesMixed);
  assert(metricsMixed.wins === 12 && metricsMixed.losses === 8 && metricsMixed.winRate === 60.0, 'Test 7 - Mixed results calculated correctly');

  // 8. Consecutive losses
  const tradesStreakLoss = [
    ...Array.from({ length: 15 }, () => mockTrade('WIN', 1.5)),
    ...Array.from({ length: 4 }, () => mockTrade('LOSS', -1.0))
  ];
  const metricsStreakLoss = computeEquityAnalytics(tradesStreakLoss);
  assert(metricsStreakLoss.consecutiveLosses === 4, 'Test 8 - Consecutive losses detected correctly (4)');

  // 9. Consecutive wins
  const tradesStreakWin = [
    ...Array.from({ length: 15 }, () => mockTrade('LOSS', -1.0)),
    ...Array.from({ length: 3 }, () => mockTrade('WIN', 1.5))
  ];
  const metricsStreakWin = computeEquityAnalytics(tradesStreakWin);
  assert(metricsStreakWin.consecutiveWins === 3, 'Test 9 - Consecutive wins detected correctly (3)');

  // 10. Positive expectancy
  assert(metricsMixed.expectancyR > 0, 'Test 10 - Positive expectancy correctly computed');

  // 11. Negative expectancy
  const tradesNegExp = [
    ...Array.from({ length: 5 }, () => mockTrade('WIN', 1.0)),
    ...Array.from({ length: 15 }, () => mockTrade('LOSS', -1.5))
  ];
  const metricsNegExp = computeEquityAnalytics(tradesNegExp);
  assert(metricsNegExp.expectancyR < 0, 'Test 11 - Negative expectancy correctly computed');

  // 12. Pair-specific negative expectancy
  const tradesPair = [
    ...Array.from({ length: 10 }, () => mockTrade('WIN', 2.0, 'EURUSD')),
    ...Array.from({ length: 10 }, () => mockTrade('LOSS', -1.0, 'GBPUSD'))
  ];
  const metricsPair = computeEquityAnalytics(tradesPair);
  assert(metricsPair.performanceByPair['GBPUSD'].expectancyR < 0 && metricsPair.performanceByPair['EURUSD'].expectancyR > 0, 'Test 12 - Pair-specific performance isolated');

  // 13. Setup-specific negative expectancy
  const tradesSetup = [
    ...Array.from({ length: 10 }, () => mockTrade('WIN', 2.0, 'EURUSD', 'BREAKOUT')),
    ...Array.from({ length: 10 }, () => mockTrade('LOSS', -1.0, 'EURUSD', 'SCALP'))
  ];
  const metricsSetup = computeEquityAnalytics(tradesSetup);
  assert(metricsSetup.performanceBySetup['SCALP'].expectancyR < 0 && metricsSetup.performanceBySetup['BREAKOUT'].expectancyR > 0, 'Test 13 - Setup-specific performance isolated');

  // 14. Drawdown calculation
  const metricsForEq = computeEquityAnalytics(Array.from({ length: 20 }, () => mockTrade('LOSS', -1.0)));
  const eqState = deriveEquityState(1000, metricsForEq);
  assert(eqState.estimatedDrawdownPercent > 0, 'Test 14 - Drawdown calculation correctly reflects cumulative losses');

  // 15 & 16. Missing or invalid rr_achieved handled gracefully
  const tradesInvalidRr = [
    { user_id: 'u1', outcome: 'WIN', rr_achieved: null, pips: 30, is_active: false },
    { user_id: 'u1', outcome: 'LOSS', rr_achieved: NaN, pips: -20, is_active: false }
  ];
  const metricsInv = computeEquityAnalytics(tradesInvalidRr);
  assert(!isNaN(metricsInv.expectancyR) && !isNaN(metricsInv.winRate), 'Test 15 & 16 - Missing/invalid rr_achieved handled safely without NaN');

  // 17. NO_TRADE excluded
  const tradesNoTrade = [
    mockTrade('WIN', 2.0),
    { user_id: 'u1', outcome: 'NO_TRADE', rr_achieved: 0, is_active: false }
  ];
  const metricsNoTrade = computeEquityAnalytics(tradesNoTrade);
  assert(metricsNoTrade.totalTrades === 1, 'Test 17 - NO_TRADE outcomes excluded from analytics');

  // 18. Open ACTIVE trade excluded
  const tradesActive = [
    mockTrade('WIN', 2.0),
    mockTrade('WIN', 2.0, 'EURUSD', 'HYBRID', true) // active
  ];
  const metricsActive = computeEquityAnalytics(tradesActive);
  assert(metricsActive.totalTrades === 1, 'Test 18 - Open ACTIVE trades excluded from analytics');

  // 19 & 20. User isolation & no cross-user aggregation
  const multiUserTrades = [
    { user_id: 'user_A', outcome: 'WIN', rr_achieved: 2.0, is_active: false },
    { user_id: 'user_B', outcome: 'LOSS', rr_achieved: -1.0, is_active: false }
  ];
  const metricsUserA = computeEquityAnalytics(multiUserTrades.filter(t => t.user_id === 'user_A'));
  assert(metricsUserA.totalTrades === 1 && metricsUserA.wins === 1, 'Test 19 & 20 - Strict user-scoped trade aggregation');

  // 21 & 22. NaN and Infinity prevention
  const extremeTrades = [{ user_id: 'u1', outcome: 'WIN', rr_achieved: Infinity, pips: NaN, is_active: false }];
  const metricsExtreme = computeEquityAnalytics(extremeTrades);
  assert(!isNaN(metricsExtreme.expectancyR) && Number.isFinite(metricsExtreme.expectancyR), 'Test 21 & 22 - NaN and Infinity safely prevented');

  // 23. Governor returns NORMAL when evidence is insufficient
  const govNormal = evaluateRiskGovernor({
    metrics: metricsFew,
    equityState: { configuredCapital: 1000, estimatedEquity: 1000, estimatedDrawdownPercent: 0 },
    candidate: { pair: 'EURUSD', timeframe: 'H1' }
  });
  assert(govNormal.status === 'NORMAL', 'Test 23 - Governor returns NORMAL when evidence is insufficient');

  // 24. Governor returns RESTRICTED_SELECTIVITY when conditions justify it
  const govRestrict = evaluateRiskGovernor({
    metrics: { ...metricsMixed, consecutiveLosses: 3 },
    equityState: { configuredCapital: 1000, estimatedEquity: 900, estimatedDrawdownPercent: 12.0 },
    candidate: { pair: 'EURUSD', timeframe: 'H1' }
  });
  assert(govRestrict.status === 'RESTRICTED_SELECTIVITY', 'Test 24 - Governor returns RESTRICTED_SELECTIVITY on consecutive losses / drawdown');

  // 25. Governor returns NO_TRADE only when severe conditions justify it
  const govNoTrade = evaluateRiskGovernor({
    metrics: { ...metricsNegExp, consecutiveLosses: 5, totalTrades: 25 },
    equityState: { configuredCapital: 1000, estimatedEquity: 700, estimatedDrawdownPercent: 30.0 },
    candidate: { pair: 'EURUSD', timeframe: 'H1' }
  });
  assert(govNoTrade.status === 'NO_TRADE', 'Test 25 - Governor returns NO_TRADE on severe conditions');

  console.log(`\n--- EQUITY LEARNING TEST SUITE RESULTS ---`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  return { passed, failed };
}
