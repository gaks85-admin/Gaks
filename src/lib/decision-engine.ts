import { CompilerOutput } from './strategy-compiler/types.js';
import { RULE_WEIGHTS } from './rule-weight-engine.js';
import {
  TrendlineEvaluator,
  BosEvaluator,
  ChochEvaluator,
  EmaEvaluator,
  RsiEvaluator,
  MacdEvaluator,
  AtrEvaluator,
  LiquidityEvaluator,
  FvgEvaluator,
  SupportEvaluator,
  ResistanceEvaluator,
  VolumeEvaluator,
  SessionEvaluator,
  TimeframeEvaluator,
  RiskRewardEvaluator,
  ConfirmationCandleEvaluator
} from './decision-engine/index.js';

export interface DecisionResult {
  decision_score: number;
  matched_weight: number;
  possible_weight: number;
  matched_rules: string[];
  failed_rules: string[];
  mandatory_rules_passed: boolean;
  recommendation: 'PASS' | 'LIKELY_PASS' | 'AMBIGUOUS' | 'FAIL';
  requires_gemini: boolean;
  explanation: string;
}

/**
 * Pure, modular, synchronous, offline decision evaluation engine.
 * Determines whether the current market structure satisfies the user's compiled strategy using weighted scoring.
 */
export function evaluateDecision(
  compiledStrategy: CompilerOutput,
  marketStructure: any,
  customWeights?: Record<string, number>,
  historicalProbability?: number,
  sampleSize?: number
): DecisionResult {
  const rules = compiledStrategy.compiled_rules || {};
  const weights = customWeights || RULE_WEIGHTS;

  // Initialize evaluators
  const trendlineEval = new TrendlineEvaluator();
  const bosEval = new BosEvaluator();
  const chochEval = new ChochEvaluator();
  const emaEval = new EmaEvaluator();
  const rsiEval = new RsiEvaluator();
  const macdEval = new MacdEvaluator();
  const atrEval = new AtrEvaluator();
  const liqEval = new LiquidityEvaluator();
  const fvgEval = new FvgEvaluator();
  const supportEval = new SupportEvaluator();
  const resistanceEval = new ResistanceEvaluator();
  const volEval = new VolumeEvaluator();
  const sessionEval = new SessionEvaluator();
  const tfEval = new TimeframeEvaluator();
  const rrEval = new RiskRewardEvaluator();
  const ccEval = new ConfirmationCandleEvaluator();

  const evaluatedRules: {
    name: string;
    weightKey: keyof typeof RULE_WEIGHTS;
    matched: boolean;
    reason: string;
  }[] = [];

  // 1. Trendline Breakout
  if (rules.trendline_breakout === true) {
    const res = trendlineEval.evaluateBreakout(rules, marketStructure);
    evaluatedRules.push({
      name: "Trendline Breakout",
      weightKey: "trendline_breakout",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 2. Break and Retest
  if (rules.break_and_retest === true) {
    const res = trendlineEval.evaluateRetest(rules, marketStructure);
    evaluatedRules.push({
      name: "Break and Retest",
      weightKey: "break_and_retest",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 3. BOS
  if (rules.bos === true) {
    const res = bosEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "BOS",
      weightKey: "bos",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 4. CHOCH
  if (rules.choch === true) {
    const res = chochEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "CHOCH",
      weightKey: "choch",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 5. EMA
  if (rules.ema && rules.ema.enabled === true) {
    const res = emaEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "EMA Alignment",
      weightKey: "ema",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 6. RSI
  if (rules.rsi && rules.rsi.enabled === true) {
    const res = rsiEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "RSI Filter",
      weightKey: "rsi",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 7. MACD
  if (rules.macd && rules.macd.enabled === true) {
    const res = macdEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "MACD Filter",
      weightKey: "macd",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 8. ATR
  if (rules.atr && rules.atr.enabled === true) {
    const res = atrEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "ATR Volatility Filter",
      weightKey: "atr",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 9. Liquidity Sweep
  if (rules.liquidity_sweep === true) {
    const res = liqEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "Liquidity Sweep",
      weightKey: "liquidity_sweep",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 10. Fair Value Gap
  if (rules.fair_value_gap === true) {
    const res = fvgEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "Fair Value Gap",
      weightKey: "fair_value_gap",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 11. Support Zone
  if (rules.support === true) {
    const res = supportEval.evaluateSupport(rules, marketStructure);
    evaluatedRules.push({
      name: "Support Zone",
      weightKey: "support",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 12. Support Rejection
  if (rules.support_rejection === true) {
    const res = supportEval.evaluateSupportRejection(rules, marketStructure);
    evaluatedRules.push({
      name: "Support Rejection",
      weightKey: "support",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 13. Resistance Zone
  if (rules.resistance === true) {
    const res = resistanceEval.evaluateResistance(rules, marketStructure);
    evaluatedRules.push({
      name: "Resistance Zone",
      weightKey: "resistance",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 14. Resistance Rejection
  if (rules.resistance_rejection === true) {
    const res = resistanceEval.evaluateResistanceRejection(rules, marketStructure);
    evaluatedRules.push({
      name: "Resistance Rejection",
      weightKey: "resistance",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 15. Volume Confirmation
  if (rules.volume_confirmation === true) {
    const res = volEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "Volume Confirmation",
      weightKey: "volume_confirmation",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 16. Sessions
  if (rules.session && rules.session.length > 0) {
    const res = sessionEval.evaluate(rules, marketStructure);
    let friendlyName = "Session Filter";
    if (rules.session.includes("London")) {
      friendlyName = "London Session";
    } else if (rules.session.includes("NY") || rules.session.includes("New York")) {
      friendlyName = "New York Session";
    } else if (rules.session.includes("Asian") || rules.session.includes("Tokyo")) {
      friendlyName = "Asian Session";
    }
    evaluatedRules.push({
      name: friendlyName,
      weightKey: "session",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 17. Timeframes
  if (rules.timeframes && rules.timeframes.length > 0) {
    const res = tfEval.evaluate(rules, marketStructure);
    let friendlyName = "Timeframe Filter";
    if (rules.timeframes.length === 1) {
      friendlyName = `${rules.timeframes[0]} Timeframe`;
    }
    evaluatedRules.push({
      name: friendlyName,
      weightKey: "timeframe",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 18. Risk Reward
  if (rules.risk_reward && rules.risk_reward.min_ratio !== undefined) {
    const res = rrEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "Risk Reward",
      weightKey: "risk_reward",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 19. Confirmation Candle
  if (rules.confirmation_candle === true) {
    const res = ccEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "Confirmation Candle",
      weightKey: "confirmation_candle",
      matched: res.matched,
      reason: res.reason
    });
  }

  // 20. Historical Probability
  if (sampleSize !== undefined && sampleSize >= 30 && historicalProbability !== undefined) {
    const matched = historicalProbability >= 60.0;
    evaluatedRules.push({
      name: "Historical Probability",
      weightKey: "historical_probability" as any,
      matched,
      reason: `Historical Win Rate for this rule combination is ${historicalProbability}% (Sample: ${sampleSize} trades).`
    });
  }

  const matchedRulesObj = evaluatedRules.filter(r => r.matched);
  const failedRulesObj = evaluatedRules.filter(r => !r.matched);

  const matched_rules = matchedRulesObj.map(r => r.name);
  const failed_rules = failedRulesObj.map(r => r.name);

  // Calculate weights
  let matched_weight = 0;
  let possible_weight = 0;

  evaluatedRules.forEach(rule => {
    let ruleWeight = 0;
    if (rule.name === "Historical Probability") {
      ruleWeight = 20;
    } else {
      ruleWeight = weights[rule.weightKey] ?? 0;
    }
    possible_weight += ruleWeight;
    if (rule.matched) {
      matched_weight += ruleWeight;
    }
  });

  const decision_score = possible_weight > 0 ? Math.round((matched_weight / possible_weight) * 100) : 100;

  // Mandatory Rules check
  // Trendline Breakout OR BOS OR CHOCH
  const isAIOnly = compiledStrategy.strategy_mode === 'AI_ONLY';
  const totalRules = evaluatedRules.length;

  const matchedMandatoryRules = evaluatedRules.filter(
    r => (r.name === "Trendline Breakout" || r.name === "BOS" || r.name === "CHOCH") && r.matched
  );
  const mandatory_rules_passed = isAIOnly || totalRules === 0 || matchedMandatoryRules.length > 0;

  let recommendation: 'PASS' | 'LIKELY_PASS' | 'AMBIGUOUS' | 'FAIL';
  let requires_gemini = false;

  if (!mandatory_rules_passed) {
    recommendation = 'FAIL';
    requires_gemini = false;
  } else {
    if (decision_score >= 90) {
      recommendation = 'PASS';
      requires_gemini = false;
    } else if (decision_score >= 80) {
      recommendation = 'LIKELY_PASS';
      requires_gemini = true;
    } else if (decision_score >= 60) {
      recommendation = 'AMBIGUOUS';
      requires_gemini = true;
    } else {
      recommendation = 'FAIL';
      requires_gemini = false;
    }

    // Override requires_gemini if strategy_mode is AI_ONLY or HYBRID, unless it's a hard FAIL
    const hasSubjective = (rules.subjective_elements && rules.subjective_elements.length > 0) ||
                          (rules.ai_only_elements && rules.ai_only_elements.length > 0);
    const isHybridOrAI = compiledStrategy.strategy_mode === 'AI_ONLY' || compiledStrategy.strategy_mode === 'HYBRID';

    if ((isHybridOrAI || hasSubjective) && recommendation !== 'FAIL') {
      requires_gemini = true;
    }
  }

  const explanation = !mandatory_rules_passed
    ? "No structural confirmation."
    : (totalRules > 0
        ? `Market satisfies ${matched_weight} of ${possible_weight} possible weights (${decision_score}%).`
        : "No active rules to evaluate.");

  // Structured Log Generation
  console.log(`\n========== WEIGHTED DECISION ==========`);
  console.log(`Strategy Mode:`);
  console.log(`${compiledStrategy.strategy_mode || 'RULE_ONLY'}`);
  console.log(`Matched Weight:`);
  console.log(`${matched_weight}`);
  console.log(`Possible Weight:`);
  console.log(`${possible_weight}`);
  console.log(`Decision Score:`);
  console.log(`${decision_score}%`);
  console.log(`Mandatory Rules:`);
  console.log(`${mandatory_rules_passed ? 'PASSED' : 'FAILED'}`);
  console.log(`Matched:`);
  if (matched_rules.length > 0) {
    evaluatedRules.filter(r => r.matched).forEach(r => {
      console.log(`${r.name} (+${weights[r.weightKey] ?? 0})`);
    });
  } else {
    console.log("None");
  }
  console.log(`Failed:`);
  if (failed_rules.length > 0) {
    evaluatedRules.filter(r => !r.matched).forEach(r => {
      console.log(`${r.name} (-${weights[r.weightKey] ?? 0})`);
    });
  } else {
    console.log("None");
  }
  console.log(`Recommendation:`);
  console.log(`${recommendation}`);
  console.log(`Gemini Required:`);
  console.log(`${requires_gemini ? 'YES' : 'NO'}`);
  console.log(`====================================\n`);

  return {
    decision_score,
    matched_weight,
    possible_weight,
    matched_rules,
    failed_rules,
    mandatory_rules_passed,
    recommendation,
    requires_gemini,
    explanation
  };
}
