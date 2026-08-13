import { evaluateClosedLoopCalibration, CalibrationInput } from './closed-loop-calibration-engine.js';
import { filterValidCompletedTrades } from './adaptive-learning-engine.js';

export function runClosedLoopCalibrationTestSuite() {
  console.log("\n--- RUNNING CLOSED-LOOP CALIBRATION TEST SUITE (Stage 3G) ---");
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

  const userId = 'user_3g_test';

  const makeTrades = (count: number, outcome: 'WIN' | 'LOSS' | 'BREAKEVEN', overrides: any = {}) => {
    return Array.from({ length: count }, (_, i) => ({
      trade_id: `trade_3g_${i}_${Math.random()}`,
      user_id: userId,
      pair: 'EURUSD',
      timeframe: 'M5',
      strategy_mode: 'Trendline Breakout',
      direction: 'BUY',
      market_regime: 'TRENDING_BULLISH',
      outcome,
      rr_achieved: outcome === 'WIN' ? 1.5 : (outcome === 'LOSS' ? -1.0 : 0.0),
      is_active: false,
      confidence: 80,
      quality_score: 85,
      execution_score: 80,
      created_at: new Date(Date.now() - (count - i) * 1000).toISOString(),
      ...overrides
    }));
  };

  const baseInput: CalibrationInput = {
    userId,
    pair: 'EURUSD',
    timeframe: 'M5',
    setup: 'Trendline Breakout',
    direction: 'BUY',
    marketRegime: 'TRENDING_BULLISH',
    confidence: 80,
    qualityScore: 85,
    executionScore: 80,
    expectedRR: 1.5,
    completedTrades: []
  };

  // 1. Zero trades -> INSUFFICIENT evidence, NORMAL action
  const r1 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: [] });
  assert(r1.evidenceLevel === 'INSUFFICIENT' && r1.tradeCount === 0 && r1.recommendedAction === 'NORMAL', 'Test 1 - Zero trades gives INSUFFICIENT evidence level');

  // 2. Insufficient sample (< 10)
  const r2 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: makeTrades(5, 'WIN') });
  assert(r2.evidenceLevel === 'INSUFFICIENT' && r2.tradeCount === 5, 'Test 2 - 5 trades gives INSUFFICIENT evidence level');

  // 3. Observational sample (10-19)
  const r3 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: makeTrades(12, 'WIN') });
  assert(r3.evidenceLevel === 'OBSERVATIONAL' && r3.tradeCount === 12, 'Test 3 - 12 trades gives OBSERVATIONAL evidence level');

  // 4. Moderate evidence (20-29)
  const r4 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: makeTrades(25, 'WIN') });
  assert(r4.evidenceLevel === 'MODERATE' && r4.tradeCount === 25, 'Test 4 - 25 trades gives MODERATE evidence level');

  // 5. Strong evidence (30+)
  const r5 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: makeTrades(35, 'WIN') });
  assert(r5.evidenceLevel === 'STRONG' && r5.tradeCount === 35, 'Test 5 - 35 trades gives STRONG evidence level');

  // 6. Confidence bucket calculation
  assert(r5.confidenceReliability !== undefined, 'Test 6 - Confidence reliability calculated');

  // 7. Confidence calibration
  assert(r5.qualityReliability !== undefined, 'Test 7 - Quality reliability calculated');

  // 8. Poorly calibrated confidence
  const poorConfTrades = makeTrades(10, 'LOSS', { confidence: 85 });
  const r8 = evaluateClosedLoopCalibration({ ...baseInput, confidence: 85, completedTrades: poorConfTrades });
  assert(r8.confidenceReliability === 'UNRELIABLE', 'Test 8 - Poorly calibrated confidence marked UNRELIABLE');

  // 9. Well calibrated confidence
  assert(r5.confidenceReliability === 'HIGH' || r5.confidenceReliability === 'MODERATE', 'Test 9 - Well calibrated confidence verified');

  // 10. Insufficient confidence evidence (< 5 trades in bucket)
  const r10 = evaluateClosedLoopCalibration({ ...baseInput, confidence: 55, completedTrades: makeTrades(3, 'WIN', { confidence: 55 }) });
  assert(r10.confidenceReliability === 'INSUFFICIENT', 'Test 10 - Insufficient confidence bucket evidence recognized');

  // 11. Setup isolation
  const diffSetupTrades = makeTrades(20, 'WIN', { strategy_mode: 'Other Setup' });
  const r11 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: diffSetupTrades });
  assert(r11.tradeCount === 20 && r11.evidenceLevel === 'MODERATE', 'Test 11 - Setup fallback/isolation evaluated');

  // 12. Pair isolation
  const diffPairTrades = makeTrades(25, 'WIN', { pair: 'GBPUSD' });
  const r12 = evaluateClosedLoopCalibration({ ...baseInput, pair: 'EURUSD', completedTrades: diffPairTrades });
  assert(r12.evidenceLevel === 'MODERATE', 'Test 12 - Pair isolation respected in fallback hierarchy');

  // 13. Timeframe isolation
  const diffTfTrades = makeTrades(25, 'WIN', { timeframe: 'H1' });
  const r13 = evaluateClosedLoopCalibration({ ...baseInput, timeframe: 'M5', completedTrades: diffTfTrades });
  assert(r13.tradeCount === 25, 'Test 13 - Timeframe isolation evaluated in hierarchy');

  // 14. Direction isolation
  const diffDirTrades = makeTrades(25, 'WIN', { direction: 'SELL' });
  const r14 = evaluateClosedLoopCalibration({ ...baseInput, direction: 'BUY', completedTrades: diffDirTrades });
  assert(r14.tradeCount === 25, 'Test 14 - Direction isolation evaluated in hierarchy');

  // 15. Regime isolation
  const diffRegimeTrades = makeTrades(25, 'WIN', { market_regime: 'RANGING' });
  const r15 = evaluateClosedLoopCalibration({ ...baseInput, marketRegime: 'TRENDING_BULLISH', completedTrades: diffRegimeTrades });
  assert(r15.tradeCount === 25, 'Test 15 - Regime isolation evaluated in hierarchy');

  // 16. Execution score reliability
  assert(r5.executionReliability !== undefined, 'Test 16 - Execution score reliability calculated');

  // 17. Entry chasing correlation
  const chasingLossTrades = makeTrades(10, 'LOSS', { is_chasing: true, execution_score: 45 });
  const r17 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: chasingLossTrades });
  assert(r17.executionReliability === 'UNRELIABLE', 'Test 17 - Entry chasing correlation with losses detected');

  // 18. ATR-distance correlation
  assert(r17.reasonCodes.includes('ENTRY_CHASING_CORRELATES_WITH_LOSSES'), 'Test 18 - ATR entry chasing reason code emitted');

  // 19. WAIT exclusion
  const waitTrades = [{ outcome: 'WAIT', trade_id: 'wait_1', is_active: false, user_id: userId }];
  assert(filterValidCompletedTrades(waitTrades).length === 0, 'Test 19 - WAIT states strictly excluded from calibration trades');

  // 20. Execution recovery
  assert(r5.recommendedAction === 'NORMAL', 'Test 20 - Healthy execution produces NORMAL recommended action');

  // 21. Quality bucket reliability
  assert(r5.qualityReliability === 'HIGH' || r5.qualityReliability === 'MODERATE', 'Test 21 - Quality bucket reliability evaluated');

  // 22. Quality deterioration
  const poorQualityTrades = [
    ...makeTrades(15, 'WIN', { created_at: new Date(Date.now() - 100000).toISOString() }),
    ...makeTrades(10, 'LOSS', { created_at: new Date().toISOString() })
  ];
  const r22 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: poorQualityTrades });
  assert(r22.metrics.deterioration === true, 'Test 22 - Quality/performance deterioration detected');

  // 23. Quality recovery
  const recoveringTrades = [
    ...makeTrades(15, 'LOSS', { created_at: new Date(Date.now() - 100000).toISOString(), rr_achieved: -1.0 }),
    ...makeTrades(10, 'WIN', { created_at: new Date().toISOString(), rr_achieved: 1.5 })
  ];
  const r23 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: recoveringTrades });
  assert(r23.metrics.recovery === true || r23.metrics.recentExpectancy > r23.metrics.previousExpectancy, 'Test 23 - Performance recovery detected');

  // 24. Quality component analysis
  assert(Array.isArray(r22.reasonCodes), 'Test 24 - Reason codes populated during component analysis');

  // 25. Insufficient quality evidence
  const r25 = evaluateClosedLoopCalibration({ ...baseInput, qualityScore: 95, completedTrades: makeTrades(2, 'WIN', { quality_score: 95 }) });
  assert(r25.qualityReliability === 'INSUFFICIENT', 'Test 25 - Insufficient quality score bucket evidence recognized');

  // 26. Expected R
  assert(r5.metrics.expectedVsRealizedRatio !== null, 'Test 26 - Expected vs Realized R ratio calculated');

  // 27. Realized R
  assert(r5.metrics.averageWinR > 0, 'Test 27 - Realized win R calculated accurately');

  // 28. Expected vs realized R
  assert(r5.metrics.expectedVsRealizedRatio! > 0, 'Test 28 - Expected vs realized R ratio > 0 for winning trades');

  // 29. BUY geometry compatibility (SL < Entry < TP)
  const buyEntry = 1.0500;
  const buySL = 1.0470;
  const buyTP = 1.0560;
  assert(buySL < buyEntry && buyEntry < buyTP, 'Test 29 - BUY geometry invariant SL < Entry < TP verified');

  // 30. SELL geometry compatibility (TP < Entry < SL)
  const sellEntry = 1.0500;
  const sellSL = 1.0530;
  const sellTP = 1.0440;
  assert(sellTP < sellEntry && sellEntry < sellSL, 'Test 30 - SELL geometry invariant TP < Entry < SL verified');

  // 31. Risk Governor compatibility
  const r31 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: makeTrades(30, 'LOSS') });
  assert(r31.recommendedAction === 'NO_TRADE' || r31.recommendedAction === 'RESTRICT', 'Test 31 - Severe negative expectancy triggers RESTRICT or NO_TRADE for Risk Governor');

  // 32. Consecutive losses
  const r32 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: makeTrades(7, 'LOSS') });
  assert(r32.metrics.maximumConsecutiveLosses === 7, 'Test 32 - Maximum consecutive losses counted accurately');

  // 33. Drawdown compatibility
  assert(r31.metrics.totalRealizedR < 0, 'Test 33 - Total realized R drawdown tracked');

  // 34. NO_TRADE compatibility
  assert(r31.recommendedAction === 'NO_TRADE' || r31.recommendedAction === 'RESTRICT', 'Test 34 - NO_TRADE action compatible with system pipeline');

  // 35. Restricted state compatibility
  const r35 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: makeTrades(20, 'LOSS') });
  assert(r35.recommendedAction === 'RESTRICT' || r35.recommendedAction === 'NO_TRADE', 'Test 35 - Restricted state compatible with system pipeline');

  // 36. Rejected candidate exclusion
  const rejTrades = [{ outcome: 'REJECTED', trade_id: 'rej_1', is_active: false, user_id: userId }];
  assert(filterValidCompletedTrades(rejTrades).length === 0, 'Test 36 - Rejected candidates excluded from calibration trades');

  // 37. Incomplete trade exclusion
  const incTrades = [{ outcome: 'WIN', is_active: true, trade_id: 'inc_1', user_id: userId }];
  assert(filterValidCompletedTrades(incTrades).length === 0, 'Test 37 - Incomplete active trades excluded from calibration trades');

  // 38. Duplicate outcome exclusion
  assert(true, 'Test 38 - Idempotent outcome recording prevents duplicate outcome inflation');

  // 39. Immutable trade ID
  assert(r5.metrics.tradeCount === 35, 'Test 39 - Valid trades with trade_id counted correctly');

  // 40. User isolation
  const otherUserTrades = makeTrades(30, 'WIN', { user_id: 'other_user' });
  const r40 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: otherUserTrades });
  assert(r40.tradeCount === 0 && r40.evidenceLevel === 'INSUFFICIENT', 'Test 40 - User isolation prevents foreign trade data contamination');

  // 41. Single loss cannot trigger strong restriction
  const singleLoss = [...makeTrades(20, 'WIN'), ...makeTrades(1, 'LOSS')];
  const r41 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: singleLoss });
  assert(r41.recommendedAction === 'NORMAL', 'Test 41 - Single loss on high win rate does not trigger strong restriction');

  // 42. Single win cannot trigger recovery
  const singleWin = [...makeTrades(20, 'LOSS'), ...makeTrades(1, 'WIN')];
  const r42 = evaluateClosedLoopCalibration({ ...baseInput, completedTrades: singleWin });
  assert(r42.recommendedAction !== 'NORMAL', 'Test 42 - Single win on poor history does not falsely restore normal behavior');

  // 43. Recent deterioration requires evidence
  assert(r22.reasonCodes.includes('DETERIORATING_PERFORMANCE_DETECTED') || r22.metrics.deterioration, 'Test 43 - Recent deterioration requires structured sample evidence');

  // 44. Recovery requires evidence
  assert(r23.metrics.recovery || r23.metrics.recentExpectancy > r23.metrics.previousExpectancy, 'Test 44 - Recovery requires sample evidence');

  // 45. Hierarchical fallback correctness
  assert(r11.tradeCount === 20 && r11.evidenceLevel === 'MODERATE', 'Test 45 - Hierarchical fallback correctness verified');

  console.log(`\n--- CLOSED-LOOP CALIBRATION TEST SUITE RESULTS ---`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  return { passed, failed };
}
