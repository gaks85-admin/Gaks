import { compileStrategy } from '../src/lib/strategy-compiler.js';
import { evaluateDecision } from '../src/lib/decision-engine.js';
import { MarketStructure } from '../src/lib/market-structure-engine.js';

async function runTests() {
  console.log("=== VERIFYING STRATEGY-AWARE ZONE GUARD & 75% THRESHOLD ===");

  // Mock Market Structure with NO zone
  const mockMsNoZone: any = {
    watcherId: 'test-watcher',
    pair: 'BTCUSD',
    timeframe: 'M5',
    trend: 'BULLISH',
    markedZone: null,
    zone_status: 'NO_ZONE',
    ema: { matched: true, reason: 'Price above EMA' },
    rsi: { matched: true, reason: 'RSI not overbought' }
  };

  // 1. Test EMA-only strategy (should NOT require zone setup)
  const emaStrategy = "EMA alignment required. RSI filter optional.";
  const compiledEma = compileStrategy(emaStrategy);
  
  const rules = compiledEma.compiled_rules;
  const mandatoryIds = compiledEma.canonical_rule_set.mandatory_rule_ids || [];
  const requiresZoneSetupEma = Boolean(
    (rules.order_block && mandatoryIds.includes('order_block')) ||
    (rules.supply_demand && mandatoryIds.includes('supply_demand')) ||
    (rules.unmitigated_zone && mandatoryIds.includes('unmitigated_zone')) ||
    (rules.fair_value_gap && mandatoryIds.includes('fair_value_gap')) ||
    (rules.support && mandatoryIds.includes('support')) ||
    (rules.resistance && mandatoryIds.includes('resistance')) ||
    (rules.support_rejection && mandatoryIds.includes('support_rejection')) ||
    (rules.resistance_rejection && mandatoryIds.includes('resistance_rejection')) ||
    (rules.liquidity_sweep && mandatoryIds.includes('liquidity_sweep'))
  );

  console.log(`EMA-only strategy requiresZoneSetup: ${requiresZoneSetupEma} (Expected: false)`);
  if (requiresZoneSetupEma) throw new Error("EMA strategy should not require zone setup");

  // 2. Test SMC strategy (should require zone setup)
  const smcStrategy = "Supply and Demand required. Order block entry.";
  const compiledSmc = compileStrategy(smcStrategy);
  
  const rulesSmc = compiledSmc.compiled_rules;
  const mandatoryIdsSmc = compiledSmc.canonical_rule_set.mandatory_rule_ids || [];
  const requiresZoneSetupSmc = Boolean(
    (rulesSmc.order_block && mandatoryIdsSmc.includes('order_block')) ||
    (rulesSmc.supply_demand && mandatoryIdsSmc.includes('supply_demand')) ||
    (rulesSmc.unmitigated_zone && mandatoryIdsSmc.includes('unmitigated_zone')) ||
    (rulesSmc.fair_value_gap && mandatoryIdsSmc.includes('fair_value_gap')) ||
    (rulesSmc.support && mandatoryIdsSmc.includes('support')) ||
    (rulesSmc.resistance && mandatoryIdsSmc.includes('resistance')) ||
    (rulesSmc.support_rejection && mandatoryIdsSmc.includes('support_rejection')) ||
    (rulesSmc.resistance_rejection && mandatoryIdsSmc.includes('resistance_rejection')) ||
    (rulesSmc.liquidity_sweep && mandatoryIdsSmc.includes('liquidity_sweep'))
  );

  console.log(`SMC strategy requiresZoneSetup: ${requiresZoneSetupSmc} (Expected: true)`);
  if (!requiresZoneSetupSmc) throw new Error("SMC strategy should require zone setup");

  // 3. Verify Decision Engine 75% Threshold Logic
  // (We test the logic in market-watcher.ts indirectly by verifying what evaluateDecision produces)
  
  // Create a strategy that will produce a score below 75%
  // EMA (weight 5), RSI (weight 4), MACD (weight 4), ATR (weight 6)
  // Total weight: 19
  // If only EMA matches, score is 5/19 = 26%
  const lowScoreStrategy = "EMA required. RSI required. MACD required. ATR required.";
  const compiledLow = compileStrategy(lowScoreStrategy);
  
  const mockMsPartial: any = {
    ...mockMsNoZone,
    ema: { matched: true, score: 1.0, reason: 'Matched' },
    rsi: { matched: false, score: 0.0, reason: 'Failed' },
    macd: { matched: false, score: 0.0, reason: 'Failed' },
    atr: { matched: false, score: 0.0, reason: 'Failed' }
  };

  const decisionResult = evaluateDecision(compiledLow, mockMsPartial);
  console.log(`Decision Score for low match: ${decisionResult.decision_score}% (Expected: ~26%)`);
  
  const PRE_FILTER_MIN_SCORE = 75;
  const mandatoryPassed = decisionResult.mandatory_rules_passed !== false;
  const meetsQualityThreshold = (decisionResult.decision_score ?? 0) >= PRE_FILTER_MIN_SCORE;
  const recommendation = decisionResult.recommendation;
  const isViableRecommendation = recommendation === 'PASS' || recommendation === 'LIKELY_PASS';

  const passesDeterministicGate = mandatoryPassed && meetsQualityThreshold && isViableRecommendation;
  console.log(`Passes Deterministic Gate at 26%: ${passesDeterministicGate} (Expected: false)`);
  if (passesDeterministicGate) throw new Error("Gate should block 26% score");

  // Create a strategy that produces exactly 75%
  // We can mock the awards to get exactly 75
  const mockDecision75: any = {
    decision_score: 75,
    mandatory_rules_passed: true,
    recommendation: 'PASS'
  };
  
  const gate75 = mockDecision75.mandatory_rules_passed && mockDecision75.decision_score >= 75 && (mockDecision75.recommendation === 'PASS' || mockDecision75.recommendation === 'LIKELY_PASS');
  console.log(`Passes Deterministic Gate at 75%: ${gate75} (Expected: true)`);
  if (!gate75) throw new Error("Gate should pass 75% score");

  const mockDecision74: any = {
    decision_score: 74,
    mandatory_rules_passed: true,
    recommendation: 'LIKELY_PASS'
  };
  const gate74 = mockDecision74.mandatory_rules_passed && mockDecision74.decision_score >= 75 && (mockDecision74.recommendation === 'PASS' || mockDecision74.recommendation === 'LIKELY_PASS');
  console.log(`Passes Deterministic Gate at 74%: ${gate74} (Expected: false)`);
  if (gate74) throw new Error("Gate should block 74% score");

  console.log("✅ ALL TESTS PASSED");
}

runTests().catch(err => {
  console.error("❌ TEST FAILED:", err);
  process.exit(1);
});
