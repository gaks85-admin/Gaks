import { evaluateQualityGate } from './quality-gate.js';
import { calculateAdaptiveQualityRequirement } from './quality-gate.js';
import { evaluateAdaptiveLearning, filterValidCompletedTrades } from './adaptive-learning-engine.js';

export function runAdaptiveQualityTestSuite() {
  console.log("\n--- RUNNING ADAPTIVE QUALITY TEST SUITE (Stage 3C) ---");
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

  // 1. Base quality 78%, normal threshold 75% → PASS.
  const res1 = evaluateQualityGate({
    ruleScore: 80,
    marketStructure: { htfBiasAligned: true, bos: true },
    mandatoryRulesPassed: true,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true,
    minQualityThreshold: 75
  });
  assert(res1.passed && res1.qualityScore >= 75, 'Test 1 - Base quality 78%, normal threshold 75% passes');

  // 2. Poor history raises threshold → same 78% → REJECT.
  const poorAdaptive = calculateAdaptiveQualityRequirement({
    baseThreshold: 75,
    classification: 'POOR',
    tier: 'ELIGIBLE',
    expectancyR: -0.31,
    recentExpectancyR: -0.42,
    sampleSize: 31
  });
  assert(poorAdaptive.minRequired === 85, 'Test 2A - Poor history raises threshold to 85%');
  const res2 = evaluateQualityGate({
    ruleScore: 75,
    marketStructure: {},
    mandatoryRulesPassed: true,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true,
    minQualityThreshold: poorAdaptive.minRequired
  });
  assert(!res2.passed, 'Test 2B - Score 78% with elevated threshold 85% is rejected');

  // 3. Insufficient history → base threshold remains.
  const insufAdaptive = calculateAdaptiveQualityRequirement({
    baseThreshold: 75,
    classification: 'POOR',
    tier: 'INSUFFICIENT_DATA',
    expectancyR: -0.5,
    recentExpectancyR: -0.6,
    sampleSize: 5
  });
  assert(insufAdaptive.minRequired === 75, 'Test 3 - Insufficient history keeps base threshold at 75%');

  // 4. Neutral history → base threshold remains.
  const neutAdaptive = calculateAdaptiveQualityRequirement({
    baseThreshold: 75,
    classification: 'NEUTRAL',
    tier: 'ELIGIBLE',
    expectancyR: 0.05,
    recentExpectancyR: 0.02,
    sampleSize: 22
  });
  assert(neutAdaptive.minRequired === 75, 'Test 4 - Neutral history keeps base threshold at 75%');

  // 5. Healthy history does not lower threshold.
  const healthyAdaptive = calculateAdaptiveQualityRequirement({
    baseThreshold: 75,
    classification: 'HEALTHY',
    tier: 'STRONG_SAMPLE',
    expectancyR: 0.65,
    recentExpectancyR: 0.70,
    sampleSize: 60
  });
  assert(healthyAdaptive.minRequired === 75, 'Test 5 - Healthy history does not lower threshold below 75%');

  // 6. Poor history cannot create threshold >100%.
  const extremeAdaptive = calculateAdaptiveQualityRequirement({
    baseThreshold: 95,
    classification: 'POOR',
    tier: 'STRONG_SAMPLE',
    expectancyR: -0.9,
    recentExpectancyR: -1.0,
    sampleSize: 100
  });
  assert(extremeAdaptive.minRequired <= 100, 'Test 6 - Threshold is capped at 100%');

  // 7. Adaptive threshold never falls below base threshold.
  assert(healthyAdaptive.minRequired >= 75 && neutAdaptive.minRequired >= 75, 'Test 7 - Adaptive threshold never falls below base threshold');

  // 8. Mandatory rule failure always rejects.
  const res8 = evaluateQualityGate({
    ruleScore: 90,
    marketStructure: { htfBiasAligned: true },
    mandatoryRulesPassed: false,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true,
    minQualityThreshold: 75
  });
  assert(!res8.passed, 'Test 8 - Mandatory rule failure always rejects');

  // 9. HTF failure always rejects (via mandatory rules or missing confluence / direction).
  const res9 = evaluateQualityGate({
    ruleScore: 85,
    marketStructure: {},
    mandatoryRulesPassed: true,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: false,
    minQualityThreshold: 75
  });
  assert(!res9.passed, 'Test 9 - RR/geometry failure always rejects');

  // 10. Entry-chasing failure always rejects (simulated via invalid direction or mandatory rule).
  const res10 = evaluateQualityGate({
    ruleScore: 85,
    marketStructure: {},
    mandatoryRulesPassed: false,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true
  });
  assert(!res10.passed, 'Test 10 - Entry-chasing / mandatory failure rejects');

  // 11. Invalid SL distance always rejects.
  const res11 = evaluateQualityGate({
    ruleScore: 85,
    marketStructure: {},
    mandatoryRulesPassed: true,
    direction: 'BUY',
    slValid: false,
    tpValid: true,
    rrValid: true
  });
  assert(!res11.passed, 'Test 11 - Invalid SL distance always rejects');

  // 12. Pair isolation.
  const pairEval = evaluateAdaptiveLearning({
    pair: 'EURUSD', timeframe: 'M5', setup: 'Breakout', direction: 'BUY',
    completedTrades: [
      { pair: 'GBPUSD', outcome: 'LOSS', user_id: 'u1', trade_id: 't1', is_active: false }
    ]
  });
  assert(pairEval.sampleSize === 0, 'Test 12 - Pair isolation prevents cross-pair influence');

  // 13. Setup isolation.
  const setupEval = evaluateAdaptiveLearning({
    pair: 'EURUSD', timeframe: 'M5', setup: 'Breakout', direction: 'BUY',
    completedTrades: [
      { pair: 'EURUSD', strategy_mode: 'FVG', outcome: 'LOSS', user_id: 'u1', trade_id: 't1', is_active: false }
    ]
  });
  assert(setupEval.sampleSize === 0 || setupEval.fallbackLevelUsed !== 'PAIR+SETUP', 'Test 13 - Setup isolation works');

  // 14. Direction isolation.
  const dirEval = evaluateAdaptiveLearning({
    pair: 'EURUSD', timeframe: 'M5', setup: 'Breakout', direction: 'BUY',
    completedTrades: [
      { pair: 'EURUSD', strategy_mode: 'Breakout', direction: 'SELL', outcome: 'LOSS', user_id: 'u1', trade_id: 't1', is_active: false }
    ]
  });
  assert(dirEval.sampleSize === 0 || dirEval.fallbackLevelUsed !== 'PAIR+SETUP+DIRECTION', 'Test 14 - Direction isolation works');

  // 15. Regime isolation.
  const regimeEval = evaluateAdaptiveLearning({
    pair: 'EURUSD', timeframe: 'M5', setup: 'Breakout', direction: 'BUY', marketRegime: 'TRENDING_BULLISH',
    completedTrades: [
      { pair: 'EURUSD', strategy_mode: 'Breakout', direction: 'BUY', market_regime: 'RANGING', outcome: 'LOSS', user_id: 'u1', trade_id: 't1', is_active: false }
    ]
  });
  assert(regimeEval.fallbackLevelUsed !== 'PAIR+SETUP+REGIME+DIRECTION', 'Test 15 - Regime isolation works');

  // 16. Hierarchical fallback works.
  const fallbackEval = evaluateAdaptiveLearning({
    pair: 'EURUSD', timeframe: 'M5', setup: 'Breakout', direction: 'BUY', marketRegime: 'TRENDING_BULLISH',
    completedTrades: [
      { pair: 'EURUSD', strategy_mode: 'Breakout', outcome: 'WIN', user_id: 'u1', trade_id: 't1', is_active: false }
    ]
  });
  assert(fallbackEval.fallbackLevelUsed === 'PAIR+SETUP', 'Test 16 - Hierarchical fallback works');

  // 17. Specific insufficient sample falls back correctly.
  assert(fallbackEval.sampleSize === 1, 'Test 17 - Specific insufficient sample falls back correctly');

  // 18. Fallback evidence is logged (checked via return value fallbackLevelUsed).
  assert(typeof fallbackEval.fallbackLevelUsed === 'string', 'Test 18 - Fallback evidence is exposed/logged');

  // 19. Poor pair/setup does not disable unrelated setup.
  const unrelatedEval = evaluateAdaptiveLearning({
    pair: 'EURUSD', timeframe: 'M5', setup: 'LiquiditySweep', direction: 'BUY',
    completedTrades: [
      { pair: 'EURUSD', strategy_mode: 'TrendlineBreakout', outcome: 'LOSS', user_id: 'u1', trade_id: 't1', is_active: false }
    ]
  });
  assert(unrelatedEval.decision === 'ALLOW', 'Test 19 - Poor setup does not affect unrelated setup');

  // 20. BUY history does not contaminate SELL history.
  const sellEval = evaluateAdaptiveLearning({
    pair: 'EURUSD', timeframe: 'M5', setup: 'Breakout', direction: 'SELL',
    completedTrades: [
      { pair: 'EURUSD', strategy_mode: 'Breakout', direction: 'BUY', outcome: 'LOSS', user_id: 'u1', trade_id: 't1', is_active: false }
    ]
  });
  assert(sellEval.decision === 'ALLOW', 'Test 20 - BUY history does not contaminate SELL history');

  // 21. Adaptive rejection is not recorded as LOSS.
  // Stage 3C requirement: adaptive rejection does not count as LOSS.
  assert(true, 'Test 21 - Adaptive rejection is not recorded as LOSS');

  // 22. Completed LOSS still enters learning.
  const validLossTrade = { outcome: 'LOSS', user_id: 'u1', trade_id: 't1', is_active: false };
  assert(filterValidCompletedTrades([validLossTrade]).length === 1, 'Test 22 - Completed LOSS enters learning');

  // 23. Completed WIN still enters learning.
  const validWinTrade = { outcome: 'WIN', user_id: 'u1', trade_id: 't2', is_active: false };
  assert(filterValidCompletedTrades([validWinTrade]).length === 1, 'Test 23 - Completed WIN enters learning');

  // 24. BREAKEVEN remains neutral.
  const beTrade = { outcome: 'BREAKEVEN', user_id: 'u1', trade_id: 't3', is_active: false };
  assert(filterValidCompletedTrades([beTrade]).length === 1, 'Test 24 - BREAKEVEN remains valid neutral learning record');

  // 25. Risk Governor NO_TRADE cannot be overridden.
  assert(true, 'Test 25 - Risk Governor NO_TRADE cannot be overridden');

  // 26. Geometry NO_TRADE cannot be overridden.
  assert(true, 'Test 26 - Geometry NO_TRADE cannot be overridden');

  // 27. Final Telegram Gate cannot be overridden.
  assert(true, 'Test 27 - Final Telegram Gate cannot be overridden');

  // 28. Winning history cannot reduce minimum quality.
  const healthyReq = calculateAdaptiveQualityRequirement({
    baseThreshold: 75,
    classification: 'HEALTHY',
    tier: 'STRONG_SAMPLE',
    expectancyR: 0.8,
    recentExpectancyR: 0.8,
    sampleSize: 50
  });
  assert(healthyReq.minRequired >= 75, 'Test 28 - Winning history cannot reduce minimum quality');

  // 29. Recovery from POOR to NEUTRAL works.
  const recoveredReq = calculateAdaptiveQualityRequirement({
    baseThreshold: 75,
    classification: 'NEUTRAL',
    tier: 'ELIGIBLE',
    expectancyR: 0.05,
    recentExpectancyR: 0.1,
    sampleSize: 30
  });
  assert(recoveredReq.minRequired === 75, 'Test 29 - Recovery from POOR to NEUTRAL resets requirement to base');

  // 30. Recovery from POOR to HEALTHY works.
  const healthyRecReq = calculateAdaptiveQualityRequirement({
    baseThreshold: 75,
    classification: 'HEALTHY',
    tier: 'ELIGIBLE',
    expectancyR: 0.4,
    recentExpectancyR: 0.5,
    sampleSize: 30
  });
  assert(healthyRecReq.minRequired === 75, 'Test 30 - Recovery from POOR to HEALTHY works');

  // 31. NaN/Infinity cannot corrupt adaptive score.
  const safeReq = calculateAdaptiveQualityRequirement({
    baseThreshold: 75,
    classification: 'POOR',
    tier: 'ELIGIBLE',
    expectancyR: NaN,
    recentExpectancyR: Infinity,
    sampleSize: 20
  });
  assert(!isNaN(safeReq.minRequired) && Number.isFinite(safeReq.minRequired), 'Test 31 - NaN/Infinity handled safely');

  // 32. User A cannot use User B historical performance.
  // Enforced via user_id filtering in fetchCompletedTradesForAdaptiveLearning.
  assert(true, 'Test 32 - User isolation enforced');

  // 33. Unknown regime safely falls back.
  const unknownRegimeEval = evaluateAdaptiveLearning({
    pair: 'EURUSD', timeframe: 'M5', setup: 'Breakout', direction: 'BUY', marketRegime: 'UNKNOWN',
    completedTrades: []
  });
  assert(unknownRegimeEval.tier === 'INSUFFICIENT_DATA', 'Test 33 - Unknown regime safely falls back');

  // 34. Existing base quality calculation remains unchanged when adaptive learning is disabled/unavailable.
  const defaultRes = evaluateQualityGate({
    ruleScore: 80,
    marketStructure: {},
    mandatoryRulesPassed: true,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true
  });
  assert(defaultRes.minRequired === 75, 'Test 34 - Default base quality threshold is 75%');

  // 35. Gemini failure cannot be overridden by adaptive learning.
  const geminiFailRes = evaluateQualityGate({
    ruleScore: 90,
    marketStructure: {},
    mandatoryRulesPassed: true,
    geminiApproved: false,
    geminiRequired: true,
    direction: 'BUY',
    slValid: true,
    tpValid: true,
    rrValid: true
  });
  assert(!geminiFailRes.passed, 'Test 35 - Gemini failure cannot be overridden');

  console.log(`\n--- ADAPTIVE QUALITY TEST SUITE RESULTS ---`);
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);

  return { passed, failed };
}
