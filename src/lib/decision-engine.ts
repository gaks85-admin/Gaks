import { CompilerOutput } from './strategy-compiler/types';
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
} from './decision-engine/index';

export interface DecisionResult {
  decision_score: number;
  matched_rules: string[];
  failed_rules: string[];
  recommendation: 'PASS' | 'LIKELY_PASS' | 'AMBIGUOUS' | 'FAIL';
  requires_gemini: boolean;
  explanation: string;
}

/**
 * Pure, modular, synchronous, offline decision evaluation engine.
 * Determines whether the current market structure satisfies the user's compiled strategy.
 */
export function evaluateDecision(
  compiledStrategy: CompilerOutput,
  marketStructure: any
): DecisionResult {
  const rules = compiledStrategy.compiled_rules || {};
  const activeRules: { name: string; matched: boolean; reason: string }[] = [];

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

  // 1. Trendline Breakout
  if (rules.trendline_breakout === true) {
    const res = trendlineEval.evaluateBreakout(rules, marketStructure);
    activeRules.push({ name: "Trendline Breakout", matched: res.matched, reason: res.reason });
  }

  // 2. Break and Retest
  if (rules.break_and_retest === true) {
    const res = trendlineEval.evaluateRetest(rules, marketStructure);
    activeRules.push({ name: "Break and Retest", matched: res.matched, reason: res.reason });
  }

  // 3. BOS
  if (rules.bos === true) {
    const res = bosEval.evaluate(rules, marketStructure);
    activeRules.push({ name: "BOS", matched: res.matched, reason: res.reason });
  }

  // 4. CHOCH
  if (rules.choch === true) {
    const res = chochEval.evaluate(rules, marketStructure);
    activeRules.push({ name: "CHOCH", matched: res.matched, reason: res.reason });
  }

  // 5. EMA
  if (rules.ema && rules.ema.enabled === true) {
    const res = emaEval.evaluate(rules, marketStructure);
    activeRules.push({ name: "EMA Alignment", matched: res.matched, reason: res.reason });
  }

  // 6. RSI
  if (rules.rsi && rules.rsi.enabled === true) {
    const res = rsiEval.evaluate(rules, marketStructure);
    activeRules.push({ name: "RSI Filter", matched: res.matched, reason: res.reason });
  }

  // 7. MACD
  if (rules.macd && rules.macd.enabled === true) {
    const res = macdEval.evaluate(rules, marketStructure);
    activeRules.push({ name: "MACD Filter", matched: res.matched, reason: res.reason });
  }

  // 8. ATR
  if (rules.atr && rules.atr.enabled === true) {
    const res = atrEval.evaluate(rules, marketStructure);
    activeRules.push({ name: "ATR Volatility Filter", matched: res.matched, reason: res.reason });
  }

  // 9. Liquidity Sweep
  if (rules.liquidity_sweep === true) {
    const res = liqEval.evaluate(rules, marketStructure);
    activeRules.push({ name: "Liquidity Sweep", matched: res.matched, reason: res.reason });
  }

  // 10. Fair Value Gap
  if (rules.fair_value_gap === true) {
    const res = fvgEval.evaluate(rules, marketStructure);
    activeRules.push({ name: "Fair Value Gap", matched: res.matched, reason: res.reason });
  }

  // 11. Support Zone
  if (rules.support === true) {
    const res = supportEval.evaluateSupport(rules, marketStructure);
    activeRules.push({ name: "Support Zone", matched: res.matched, reason: res.reason });
  }

  // 12. Support Rejection
  if (rules.support_rejection === true) {
    const res = supportEval.evaluateSupportRejection(rules, marketStructure);
    activeRules.push({ name: "Support Rejection", matched: res.matched, reason: res.reason });
  }

  // 13. Resistance Zone
  if (rules.resistance === true) {
    const res = resistanceEval.evaluateResistance(rules, marketStructure);
    activeRules.push({ name: "Resistance Zone", matched: res.matched, reason: res.reason });
  }

  // 14. Resistance Rejection
  if (rules.resistance_rejection === true) {
    const res = resistanceEval.evaluateResistanceRejection(rules, marketStructure);
    activeRules.push({ name: "Resistance Rejection", matched: res.matched, reason: res.reason });
  }

  // 15. Volume Confirmation
  if (rules.volume_confirmation === true) {
    const res = volEval.evaluate(rules, marketStructure);
    activeRules.push({ name: "Volume Confirmation", matched: res.matched, reason: res.reason });
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
    activeRules.push({ name: friendlyName, matched: res.matched, reason: res.reason });
  }

  // 17. Timeframes
  if (rules.timeframes && rules.timeframes.length > 0) {
    const res = tfEval.evaluate(rules, marketStructure);
    let friendlyName = "Timeframe Filter";
    if (rules.timeframes.length === 1) {
      friendlyName = `${rules.timeframes[0]} Timeframe`;
    }
    activeRules.push({ name: friendlyName, matched: res.matched, reason: res.reason });
  }

  // 18. Risk Reward
  if (rules.risk_reward && rules.risk_reward.min_ratio !== undefined) {
    const res = rrEval.evaluate(rules, marketStructure);
    activeRules.push({ name: "Risk Reward", matched: res.matched, reason: res.reason });
  }

  // 19. Confirmation Candle
  if (rules.confirmation_candle === true) {
    const res = ccEval.evaluate(rules, marketStructure);
    activeRules.push({ name: "Confirmation Candle", matched: res.matched, reason: res.reason });
  }

  const matchedRulesObj = activeRules.filter(r => r.matched);
  const failedRulesObj = activeRules.filter(r => !r.matched);

  const matched_rules = matchedRulesObj.map(r => r.name);
  const failed_rules = failedRulesObj.map(r => r.name);

  const totalRules = activeRules.length;
  const matchedCount = matchedRulesObj.length;
  const decision_score = totalRules > 0 ? Math.round((matchedCount / totalRules) * 100) : 100;

  let recommendation: 'PASS' | 'LIKELY_PASS' | 'AMBIGUOUS' | 'FAIL';
  let requires_gemini = false;

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

  const explanation = totalRules > 0
    ? `Market satisfies ${matchedCount} of ${totalRules} strategy rules.`
    : "No active rules to evaluate.";

  // Structured Log Generation
  console.log(`\n========== DECISION ENGINE ==========`);
  console.log(`Strategy Mode:`);
  console.log(`${compiledStrategy.strategy_mode || 'RULE_ONLY'}`);
  console.log(`Decision Score:`);
  console.log(`${decision_score}%`);
  console.log(`Matched:`);
  if (matched_rules.length > 0) {
    matched_rules.forEach(r => console.log(r));
  } else {
    console.log("None");
  }
  console.log(`Failed:`);
  if (failed_rules.length > 0) {
    failed_rules.forEach(r => console.log(r));
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
    matched_rules,
    failed_rules,
    recommendation,
    requires_gemini,
    explanation
  };
}
