import { recordCompletedTrade, clearStatsCache, calculateRuleStatistics, calculatePairStatistics } from './learning-engine.js';
import { computeEquityAnalytics, deriveEquityState } from './equity-learning-engine.js';
import { evaluateAdaptiveLearning, filterValidCompletedTrades } from './adaptive-learning-engine.js';
import { evaluateAdaptiveExecution } from './adaptive-execution-engine.js';
import { evaluateClosedLoopCalibration } from './closed-loop-calibration-engine.js';
import { evaluateRiskGovernor } from './risk-governor.js';
import { resolveAuthoritativeDecision, DecisionGateResult } from './decision-attribution.js';
import { calculatePositionSize } from './risk-engine.js';

export async function runFinalLearningLoopHardeningTestSuite() {
  console.log('===============================================================');
  console.log('🚀 RUNNING FINAL PRODUCTION LEARNING LOOP HARDENING TEST SUITE');
  console.log('===============================================================');

  let passed = 0;
  let failed = 0;
  const testResults: { name: string; status: 'PASS' | 'FAIL'; reason?: string }[] = [];

  function assert(condition: boolean, testName: string, failureReason?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
      testResults.push({ name: testName, status: 'PASS' });
    } else {
      console.error(`❌ [FAIL] ${testName} - ${failureReason || 'Assertion failed'}`);
      failed++;
      testResults.push({ name: testName, status: 'FAIL', reason: failureReason });
    }
  }

  // --- SECTION 1: STRICT OUTCOME VALIDATION & IDEMPOTENCY ---
  console.log('\n--- SECTION 1: STRICT OUTCOME VALIDATION & IDEMPOTENCY ---');

  // In-memory mock supabase store
  const mockDb: Record<string, any[]> = {
    trade_learning: [],
    watcher_evaluations: []
  };

  const mockSupabase = {
    from: (table: string) => {
      return {
        select: (_cols?: string) => {
          return {
            eq: (field: string, val: any) => {
              return {
                maybeSingle: async () => {
                  const rows = (mockDb[table] || []).filter(r => r[field] === val);
                  return { data: rows[0] || null, error: null };
                },
                in: (inField: string, inVals: any[]) => {
                  return {
                    order: (_orderCol: string, _opts: any) => {
                      const rows = (mockDb[table] || []).filter(r => r[field] === val && inVals.includes(r[inField]));
                      return { data: rows, error: null };
                    }
                  };
                },
                order: (_orderCol: string, _opts: any) => {
                  const rows = (mockDb[table] || []).filter(r => r[field] === val);
                  return { data: rows, error: null };
                }
              };
            }
          };
        },
        insert: (row: any) => {
          return {
            select: () => {
              return {
                single: async () => {
                  if (!mockDb[table]) mockDb[table] = [];
                  const saved = { ...row, id: `db_id_${mockDb[table].length + 1}` };
                  mockDb[table].push(saved);
                  return { data: saved, error: null };
                }
              };
            }
          };
        }
      };
    }
  };

  // Test 1.1: Missing user_id rejected
  const resNoUser = await recordCompletedTrade(mockSupabase, {
    user_id: '',
    watcher_id: 'w1',
    pair: 'EURUSD',
    timeframe: 'H1',
    strategy_mode: 'HYBRID',
    entry_price: 1.0500,
    exit_price: 1.0600,
    direction: 'BUY',
    opened_at: new Date(Date.now() - 3600000).toISOString(),
    closed_at: new Date().toISOString()
  });
  assert(resNoUser === null, 'Test 1.1 - Trade without user_id is rejected');

  // Test 1.2: Valid WIN trade recorded with trade_id
  const testTradeId = `TR-TEST-123`;
  const resWin = await recordCompletedTrade(mockSupabase, {
    user_id: 'user_audit_1',
    watcher_id: 'w1',
    trade_id: testTradeId,
    pair: 'EURUSD',
    timeframe: 'H1',
    strategy_mode: 'HYBRID',
    entry_price: 1.0500,
    stop_loss: 1.0450,
    take_profit: 1.0600,
    exit_price: 1.0600,
    direction: 'BUY',
    outcome: 'WIN',
    opened_at: new Date(Date.now() - 3600000).toISOString(),
    closed_at: new Date().toISOString(),
    decision_score: 85,
    matched_rules: ['RuleA', 'RuleB']
  });
  assert(resWin !== null && resWin.outcome === 'WIN' && resWin.trade_id === testTradeId, 'Test 1.2 - Valid WIN trade recorded with trade_id');

  // Test 1.3: Idempotent recording with same trade_id returns existing record without duplicate
  const resWinDup = await recordCompletedTrade(mockSupabase, {
    user_id: 'user_audit_1',
    watcher_id: 'w1',
    trade_id: testTradeId,
    pair: 'EURUSD',
    timeframe: 'H1',
    strategy_mode: 'HYBRID',
    entry_price: 1.0500,
    exit_price: 1.0600,
    direction: 'BUY',
    opened_at: new Date(Date.now() - 3600000).toISOString(),
    closed_at: new Date().toISOString()
  });
  assert(resWinDup !== null && resWinDup.id === resWin?.id && mockDb.trade_learning.length === 1, 'Test 1.3 - Idempotency check prevents duplicate insertion');

  // Test 1.4: Invalid / non-terminal outcome sanitized strictly
  const resInvalidOutcome = await recordCompletedTrade(mockSupabase, {
    user_id: 'user_audit_1',
    watcher_id: 'w1',
    trade_id: `TR-TEST-456`,
    pair: 'EURUSD',
    timeframe: 'H1',
    strategy_mode: 'HYBRID',
    entry_price: 1.0500,
    exit_price: 1.0400,
    direction: 'BUY',
    outcome: 'WAIT', // invalid non-terminal outcome
    opened_at: new Date(Date.now() - 3600000).toISOString(),
    closed_at: new Date().toISOString()
  });
  assert(resInvalidOutcome !== null && resInvalidOutcome.outcome === 'LOSS', 'Test 1.4 - Invalid non-terminal outcome ("WAIT") sanitized to LOSS based on price difference');

  // --- SECTION 2: EXCLUSION OF UNRESOLVED & ACTIVE TRADES ---
  console.log('\n--- SECTION 2: EXCLUSION OF UNRESOLVED & ACTIVE TRADES ---');

  const mixedTrades = [
    { id: '1', trade_id: 't1', user_id: 'u1', outcome: 'WIN', rr_achieved: 2.0, is_active: false },
    { id: '2', trade_id: 't2', user_id: 'u1', outcome: 'LOSS', rr_achieved: -1.0, is_active: false },
    { id: '3', trade_id: 't3', user_id: 'u1', outcome: 'BREAKEVEN', rr_achieved: 0.0, is_active: false },
    { id: '4', trade_id: 't4', user_id: 'u1', outcome: 'NO_TRADE', rr_achieved: 0, is_active: false },
    { id: '5', trade_id: 't5', user_id: 'u1', outcome: 'WAIT', rr_achieved: 0, is_active: false },
    { id: '6', trade_id: 't6', user_id: 'u1', outcome: 'PENDING', rr_achieved: 0, is_active: false },
    { id: '7', trade_id: 't7', user_id: 'u1', outcome: 'WIN', rr_achieved: 2.0, is_active: true } // ACTIVE trade
  ];

  const filtered = filterValidCompletedTrades(mixedTrades);
  assert(filtered.length === 3, 'Test 2.1 - filterValidCompletedTrades allows exactly WIN, LOSS, BREAKEVEN and excludes ACTIVE/NO_TRADE/WAIT');

  const analytics = computeEquityAnalytics(mixedTrades);
  assert(analytics.totalTrades === 3 && analytics.wins === 1 && analytics.losses === 1 && analytics.breakevens === 1, 'Test 2.2 - computeEquityAnalytics calculates stats on completed trades only');

  // --- SECTION 3: USER ISOLATION ---
  console.log('\n--- SECTION 3: USER ISOLATION ---');

  const userATrades = Array.from({ length: 20 }, (_, i) => ({
    id: `ua_${i}`,
    trade_id: `tr_ua_${i}`,
    user_id: 'USER_A',
    outcome: 'WIN',
    rr_achieved: 2.0,
    is_active: false
  }));

  const userBTrades = Array.from({ length: 20 }, (_, i) => ({
    id: `ub_${i}`,
    trade_id: `tr_ub_${i}`,
    user_id: 'USER_B',
    outcome: 'LOSS',
    rr_achieved: -1.0,
    is_active: false
  }));

  const metricsA = computeEquityAnalytics(userATrades);
  const metricsB = computeEquityAnalytics(userBTrades);

  assert(metricsA.winRate === 100 && metricsA.expectancyR > 0, 'Test 3.1 - User A performance reflects 100% win rate');
  assert(metricsB.winRate === 0 && metricsB.expectancyR < 0, 'Test 3.2 - User B performance reflects 0% win rate');

  // Governor evaluation for user A vs user B
  const govA = evaluateRiskGovernor({
    metrics: metricsA,
    equityState: deriveEquityState(1000, metricsA),
    candidate: { pair: 'EURUSD', timeframe: 'H1' }
  });
  const govB = evaluateRiskGovernor({
    metrics: metricsB,
    equityState: deriveEquityState(1000, metricsB),
    candidate: { pair: 'EURUSD', timeframe: 'H1' }
  });

  assert(govA.status === 'NORMAL', 'Test 3.3 - User A governor is NORMAL');
  assert(govB.status === 'NO_TRADE', 'Test 3.4 - User B governor is NO_TRADE due to accumulated losses');

  // --- SECTION 4: HIERARCHICAL ADAPTIVE LEARNING ---
  console.log('\n--- SECTION 4: HIERARCHICAL ADAPTIVE LEARNING ---');

  const historyTrades = [
    // 25 losses on EURUSD H1 HYBRID BUY TRENDING_BULLISH
    ...Array.from({ length: 25 }, (_, i) => ({
      id: `h_${i}`,
      trade_id: `tr_h_${i}`,
      user_id: 'USER_HIST',
      pair: 'EURUSD',
      timeframe: 'H1',
      strategy_mode: 'HYBRID',
      direction: 'BUY',
      market_regime: 'TRENDING_BULLISH',
      outcome: 'LOSS',
      rr_achieved: -1.0,
      is_active: false
    })),
    // 25 wins on GBPUSD H1 HYBRID BUY TRENDING_BULLISH
    ...Array.from({ length: 25 }, (_, i) => ({
      id: `gbp_${i}`,
      trade_id: `tr_gbp_${i}`,
      user_id: 'USER_HIST',
      pair: 'GBPUSD',
      timeframe: 'H1',
      strategy_mode: 'HYBRID',
      direction: 'BUY',
      market_regime: 'TRENDING_BULLISH',
      outcome: 'WIN',
      rr_achieved: 2.0,
      is_active: false
    }))
  ];

  const adaptEur = evaluateAdaptiveLearning({
    pair: 'EURUSD',
    timeframe: 'H1',
    setup: 'HYBRID',
    direction: 'BUY',
    marketRegime: 'TRENDING_BULLISH',
    completedTrades: historyTrades
  });

  const adaptGbp = evaluateAdaptiveLearning({
    pair: 'GBPUSD',
    timeframe: 'H1',
    setup: 'HYBRID',
    direction: 'BUY',
    marketRegime: 'TRENDING_BULLISH',
    completedTrades: historyTrades
  });

  assert(adaptEur.decision === 'REJECT', 'Test 4.1 - Adaptive learning REJECTS chronically losing EURUSD configuration');
  assert(adaptGbp.decision === 'ALLOW', 'Test 4.2 - Adaptive learning ALLOWS healthy winning GBPUSD configuration');

  // --- SECTION 5: FIXED-LOT SIZING PRESERVATION & RISK SAFETY ---
  console.log('\n--- SECTION 5: FIXED-LOT SIZING PRESERVATION & RISK SAFETY ---');

  // Test 5.1: Fixed lot mode within capital risk limits
  const posFixed = calculatePositionSize({
    accountSize: 20000,
    riskPercentage: 1.0,
    entryPrice: 1.0500,
    stopLoss: 1.0450,
    takeProfit: 1.0600,
    symbol: 'EURUSD',
    direction: 'BUY',
    riskRewardStr: '1:2',
    positionMode: 'FIXED_LOT',
    preferredLotSize: 0.25
  });

  assert(posFixed.accepted === true && posFixed.calculatedLotSize === 0.25 && posFixed.exactLotSize === 0.25, 'Test 5.1 - Fixed lot mode is strictly authoritative and outputs configured lot size (0.25)');

  // Test 5.2: Fixed lot mode exceeding capital risk limits is safely rejected
  const posFixedOverRisk = calculatePositionSize({
    accountSize: 1000,
    riskPercentage: 1.0,
    entryPrice: 1.0500,
    stopLoss: 1.0450,
    takeProfit: 1.0600,
    symbol: 'EURUSD',
    direction: 'BUY',
    riskRewardStr: '1:2',
    positionMode: 'FIXED_LOT',
    preferredLotSize: 0.25
  });

  assert(posFixedOverRisk.accepted === false && posFixedOverRisk.skipReason?.includes('exceeds maximum allowed risk'), 'Test 5.2 - Fixed lot exceeding maximum risk is safely halted by risk gate');

  // --- SECTION 6: 12-GATE CANONICAL PIPELINE & ATTRIBUTION ---
  console.log('\n--- SECTION 6: 12-GATE CANONICAL PIPELINE & ATTRIBUTION ---');

  const canonicalGates: DecisionGateResult[] = [
    { gate: 'MARKET_DATA', status: 'PASS', reasonCode: 'MARKET_DATA_VALID', reason: 'Market data valid', timestamp: new Date().toISOString() },
    { gate: 'STRATEGY', status: 'PASS', reasonCode: 'STRATEGY_PASSED', reason: 'Strategy valid', timestamp: new Date().toISOString() },
    { gate: 'GEMINI', status: 'PASS', reasonCode: 'GEMINI_PASSED', reason: 'Gemini confirmed', timestamp: new Date().toISOString() },
    { gate: 'QUALITY', status: 'PASS', reasonCode: 'QUALITY_PASSED', reason: 'Quality threshold met', timestamp: new Date().toISOString() },
    { gate: 'ADAPTIVE_LEARNING', status: 'PASS', reasonCode: 'ADAPTIVE_LEARNING_PASS', reason: 'Adaptive learning passed', timestamp: new Date().toISOString() },
    { gate: 'ADAPTIVE_QUALITY', status: 'PASS', reasonCode: 'ADAPTIVE_QUALITY_PASSED', reason: 'Adaptive quality passed', timestamp: new Date().toISOString() },
    { gate: 'ADAPTIVE_EXECUTION', status: 'PASS', reasonCode: 'ADAPTIVE_TIMING_PASS', reason: 'Timing valid', timestamp: new Date().toISOString() },
    { gate: 'CLOSED_LOOP_CALIBRATION', status: 'PASS', reasonCode: 'CALIBRATION_PASS', reason: 'Calibration confirmed', timestamp: new Date().toISOString() },
    { gate: 'RISK_GOVERNOR', status: 'PASS', reasonCode: 'RISK_GOVERNOR_PASS', reason: 'Capital safe', timestamp: new Date().toISOString() },
    { gate: 'POSITION_SIZING', status: 'PASS', reasonCode: 'POSITION_SIZING_PASS', reason: 'Position size valid', timestamp: new Date().toISOString() },
    { gate: 'TRADE_GEOMETRY', status: 'PASS', reasonCode: 'GEOMETRY_VALID', reason: 'Geometry valid', timestamp: new Date().toISOString() },
    { gate: 'FINAL_TELEGRAM', status: 'PASS', reasonCode: 'TELEGRAM_AUTHORIZED', reason: 'Telegram alert authorized', timestamp: new Date().toISOString() }
  ];

  const attrExecute = resolveAuthoritativeDecision({
    userId: 'u_final',
    watcherId: 'w_final',
    pair: 'EURUSD',
    timeframe: 'H1',
    direction: 'BUY',
    tradeId: 'TR-FINAL-EXECUTE-1',
    gates: canonicalGates
  });

  assert(attrExecute.finalDecision === 'EXECUTE' && attrExecute.tradeId === 'TR-FINAL-EXECUTE-1' && attrExecute.decisionChain.length === 12, 'Test 6.1 - Full 12-gate pipeline approves EXECUTE with immutable trade_id');

  // Rejection in geometry gate
  const geometryRejGates = canonicalGates.map(g => g.gate === 'TRADE_GEOMETRY' ? { ...g, status: 'REJECT' as const, reasonCode: 'GEOMETRY_INVALID', reason: 'Invalid Stop Distance' } : g);
  const attrGeoRej = resolveAuthoritativeDecision({
    userId: 'u_final',
    watcherId: 'w_final',
    pair: 'EURUSD',
    timeframe: 'H1',
    direction: 'BUY',
    tradeId: 'TR-FINAL-EXECUTE-1',
    gates: geometryRejGates
  });

  assert(attrGeoRej.finalDecision === 'NO_TRADE' && attrGeoRej.rejectedGate === 'TRADE_GEOMETRY' && attrGeoRej.tradeId === null, 'Test 6.2 - Rejection at TRADE_GEOMETRY cleanly halts trade with NO_TRADE and strips tradeId');

  // WAIT in adaptive execution gate
  const waitGates = canonicalGates.map(g => g.gate === 'ADAPTIVE_EXECUTION' ? { ...g, status: 'WAIT' as const, reasonCode: 'ADAPTIVE_TIMING_WAIT', reason: 'Wait for pullback' } : g);
  const attrWait = resolveAuthoritativeDecision({
    userId: 'u_final',
    watcherId: 'w_final',
    pair: 'EURUSD',
    timeframe: 'H1',
    direction: 'BUY',
    tradeId: 'TR-FINAL-EXECUTE-1',
    gates: waitGates
  });

  assert(attrWait.finalDecision === 'WAIT' && attrWait.rejectedGate === 'ADAPTIVE_EXECUTION' && attrWait.tradeId === null, 'Test 6.3 - WAIT state in ADAPTIVE_EXECUTION properly results in finalDecision WAIT and strips tradeId');

  console.log('\n===============================================================');
  console.log(`📊 FINAL HARDENING TEST SUITE COMPLETE: ${passed}/${passed + failed} PASSED`);
  console.log('===============================================================');

  return { passed, failed, total: passed + failed, testResults };
}
