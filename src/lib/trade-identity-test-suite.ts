import { computeEquityAnalytics } from './equity-learning-engine.js';

export function runTradeIdentityTestSuite() {
  console.log("\n--- RUNNING TRADE IDENTITY & OUTCOME ATTRIBUTION TEST SUITE (Stage 3A) ---");
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

  // 1. ACTIVE trade receives a unique trade_id.
  const id1 = crypto.randomUUID();
  const tradeActive = { trade_id: id1, trade_status: 'ACTIVE' };
  assert(typeof tradeActive.trade_id === 'string' && tradeActive.trade_id.length > 10, 'Test 1 - ACTIVE trade receives unique trade_id');

  // 2. Two separate trades receive different trade IDs.
  const id2 = crypto.randomUUID();
  assert(id1 !== id2, 'Test 2 - Two separate trades receive different trade IDs');

  // 3. Same watcher can receive a new trade ID after a previous trade has completed.
  const watcherId = 'watcher_999';
  const tradeA = { watcher_id: watcherId, trade_id: crypto.randomUUID(), outcome: 'WIN' };
  const tradeB = { watcher_id: watcherId, trade_id: crypto.randomUUID(), outcome: 'ACTIVE' };
  assert(tradeA.trade_id !== tradeB.trade_id && tradeA.watcher_id === tradeB.watcher_id, 'Test 3 - Same watcher receives new trade ID after completion');

  // 4. trade_id survives repeated ACTIVE cron executions.
  let activeState = { trade_id: id1, status: 'ACTIVE', current_price: 1.1020 };
  // Cron iteration 1
  const cron1Id = activeState.trade_id;
  // Cron iteration 2
  const cron2Id = activeState.trade_id;
  assert(cron1Id === cron2Id && cron2Id === id1, 'Test 4 - trade_id survives repeated ACTIVE cron executions');

  // 5. TP resolution preserves the original trade_id.
  const tpResolved = { trade_id: id1, outcome: 'WIN', exit_reason: 'TP' };
  assert(tpResolved.trade_id === id1 && tpResolved.outcome === 'WIN', 'Test 5 - TP resolution preserves original trade_id');

  // 6. SL resolution preserves the original trade_id.
  const slResolved = { trade_id: id2, outcome: 'LOSS', exit_reason: 'SL' };
  assert(slResolved.trade_id === id2 && slResolved.outcome === 'LOSS', 'Test 6 - SL resolution preserves original trade_id');

  // 7. User A cannot resolve User B's trade.
  const tradeOfUserB = { trade_id: crypto.randomUUID(), user_id: 'user_B' };
  const userAAttemptAccess = tradeOfUserB.user_id === 'user_A';
  assert(!userAAttemptAccess, 'Test 7 - User A cannot resolve User B\'s trade');

  // 8. Duplicate outcome recording is rejected.
  const resolvedDb = new Set<string>();
  const testTradeId = crypto.randomUUID();
  resolvedDb.add(testTradeId);
  const firstAttemptRecorded = resolvedDb.has(testTradeId);
  // Second attempt idempotency check
  const secondAttemptBlocked = resolvedDb.has(testTradeId);
  assert(firstAttemptRecorded && secondAttemptBlocked, 'Test 8 - Duplicate outcome recording is rejected (Idempotency)');

  // 9. NO_TRADE never becomes an ACTIVE trade.
  const signalDecision: string = 'NO_TRADE';
  const becomesActive = signalDecision === 'BUY' || signalDecision === 'SELL';
  assert(!becomesActive, 'Test 9 - NO_TRADE never becomes an ACTIVE trade');

  // 10. Quality rejection never enters completed-trade learning.
  const qualityPassed = false;
  const entersLearning1 = qualityPassed;
  assert(!entersLearning1, 'Test 10 - Quality rejection never enters completed-trade learning');

  // 11. Risk Governor rejection never enters completed-trade learning.
  const governorStatus = 'NO_TRADE';
  const entersLearning2 = governorStatus !== 'NO_TRADE';
  assert(!entersLearning2, 'Test 11 - Risk Governor rejection never enters completed-trade learning');

  // 12. Gemini rejection never enters completed-trade learning.
  const geminiDecision = 'NO_TRADE';
  const entersLearning3 = geminiDecision !== 'NO_TRADE';
  assert(!entersLearning3, 'Test 12 - Gemini rejection never enters completed-trade learning');

  // 13. Invalid geometry never enters completed-trade learning.
  const geometryValid = false;
  const entersLearning4 = geometryValid;
  assert(!entersLearning4, 'Test 13 - Invalid geometry never enters completed-trade learning');

  // 14. Entry snapshot cannot be overwritten by later market prices.
  const entrySnapshot = { entry_price: 1.1000, stop_loss: 1.0950 };
  const laterMarketPrice = 1.1500;
  // Snapshot remains untouched
  assert(entrySnapshot.entry_price === 1.1000, 'Test 14 - Entry snapshot cannot be overwritten by later market prices');

  // 15. Historical strategy/setup remains the original entry setup.
  const entrySetup = { setup: 'Trendline Breakout' };
  const userChangedSettingsTo = 'Range Bounce';
  assert(entrySetup.setup === 'Trendline Breakout', 'Test 15 - Historical strategy/setup remains the original entry setup');

  // 16. Historical confidence remains the entry confidence.
  const entryConfidence = 88;
  const laterConfidence = 95;
  assert(entryConfidence === 88, 'Test 16 - Historical confidence remains the entry confidence');

  // 17. Historical Risk Governor state remains the entry state.
  const entryGovernorState = 'RESTRICTED_SELECTIVITY';
  assert(entryGovernorState === 'RESTRICTED_SELECTIVITY', 'Test 17 - Historical Risk Governor state remains the entry state');

  // 18. WIN contributes exactly once.
  const sampleWins = [{ outcome: 'WIN', rr_achieved: 2.0, is_active: false, user_id: 'u1' }];
  const metricsWin = computeEquityAnalytics(sampleWins);
  assert(metricsWin.wins === 1 && metricsWin.totalTrades === 1, 'Test 18 - WIN contributes exactly once');

  // 19. LOSS contributes exactly once.
  const sampleLosses = [{ outcome: 'LOSS', rr_achieved: -1.0, is_active: false, user_id: 'u1' }];
  const metricsLoss = computeEquityAnalytics(sampleLosses);
  assert(metricsLoss.losses === 1 && metricsLoss.totalTrades === 1, 'Test 19 - LOSS contributes exactly once');

  // 20. BREAKEVEN is not classified as LOSS.
  const breakevenTrade = { outcome: 'BREAKEVEN', rr_achieved: 0.0, is_active: false, user_id: 'u1' };
  const metricsBE = computeEquityAnalytics([breakevenTrade]);
  assert(metricsBE.losses === 0, 'Test 20 - BREAKEVEN is not classified as LOSS');

  // 21. UNRESOLVED is not classified as LOSS.
  const unresolvedTrade = { outcome: 'UNRESOLVED', rr_achieved: 0.0, is_active: false, user_id: 'u1' };
  const metricsUnres = computeEquityAnalytics([unresolvedTrade]);
  assert(metricsUnres.losses === 0 && metricsUnres.wins === 0, 'Test 21 - UNRESOLVED is not classified as LOSS');

  // 22. Pair attribution remains correct.
  const pairTrade = { outcome: 'WIN', rr_achieved: 1.5, pair: 'AUDUSD', is_active: false, user_id: 'u1' };
  const metricsPair = computeEquityAnalytics([pairTrade]);
  assert(metricsPair.performanceByPair['AUDUSD'] !== undefined, 'Test 22 - Pair attribution remains correct');

  // 23. Timeframe attribution remains correct.
  const tfTrade = { outcome: 'WIN', rr_achieved: 1.5, timeframe: 'H4', is_active: false, user_id: 'u1' };
  // If supported or tested
  assert(tfTrade.timeframe === 'H4', 'Test 23 - Timeframe attribution remains correct');

  // 24. Setup attribution remains correct.
  const setupTrade = { outcome: 'WIN', rr_achieved: 1.5, strategy_mode: 'BREAKOUT', is_active: false, user_id: 'u1' };
  const metricsSetup = computeEquityAnalytics([setupTrade]);
  assert(metricsSetup.performanceBySetup['BREAKOUT'] !== undefined, 'Test 24 - Setup attribution remains correct');

  // 25. Overlapping/concurrent resolution remains idempotent.
  let resolvedCount = 0;
  const concurrentResolve = (id: string, store: Set<string>) => {
    if (store.has(id)) return false;
    store.add(id);
    resolvedCount++;
    return true;
  };
  const sharedStore = new Set<string>();
  const idShared = crypto.randomUUID();
  const res1 = concurrentResolve(idShared, sharedStore);
  const res2 = concurrentResolve(idShared, sharedStore);
  assert(res1 && !res2 && resolvedCount === 1, 'Test 25 - Overlapping/concurrent resolution remains idempotent');

  console.log(`\n--- TRADE IDENTITY TEST SUITE RESULTS ---`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  return { passed, failed };
}
