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
  deferred_rules: string[];
  mandatory_rules_passed: boolean;
  failed_mandatory_rules: string[];
  recommendation: 'PASS' | 'LIKELY_PASS' | 'AMBIGUOUS' | 'FAIL';
  requires_gemini: boolean;
  explanation: string;
  no_trade_reason?: string;
  trace: string[];
}

/**
 * Pure, modular, synchronous, offline decision evaluation engine.
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
  const supportedDetectors = compiledStrategy.detector_validation?.supported_detectors || [];
  const deferred_rules: string[] = [];
  const trace: string[] = [];

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
    canonicalName: string;
    matched: boolean;
    reason: string;
    weight: number;
  }[] = [];

  // Rule Mapping Helper
  const processRule = (name: string, canonicalName: string, weightKey: keyof typeof RULE_WEIGHTS, evalFn: () => any) => {
    const res = evalFn();
    const weight = weights[weightKey] ?? 0;
    evaluatedRules.push({
      name,
      canonicalName,
      matched: res.matched,
      reason: res.reason,
      weight
    });
    trace.push(`[RULE] ${name}: ${res.matched ? 'MATCHED' : 'FAILED'} - ${res.reason}`);
  };

  // 1. Trendline Breakout
  if (rules.trendline_breakout === true) {
    if (supportedDetectors.includes('trendline_breakout')) {
      processRule("Trendline Breakout", "trendline_breakout", "trendline_breakout", () => trendlineEval.evaluateBreakout(rules, marketStructure));
    } else {
      deferred_rules.push("Trendline Breakout");
    }
  }

  // 2. Break and Retest
  if (rules.break_and_retest === true) {
    processRule("Break and Retest", "break_and_retest", "break_and_retest", () => trendlineEval.evaluateRetest(rules, marketStructure));
  }

  // 3. BOS
  if (rules.bos === true) {
    processRule("BOS", "bos", "bos", () => bosEval.evaluate(rules, marketStructure));
  }

  // 4. CHOCH
  if (rules.choch === true) {
    processRule("CHOCH", "choch", "choch", () => chochEval.evaluate(rules, marketStructure));
  }

  // 5. EMA
  if (rules.ema && rules.ema.enabled === true) {
    processRule("EMA Alignment", "ema", "ema", () => emaEval.evaluate(rules, marketStructure));
  }

  // 6. RSI
  if (rules.rsi && rules.rsi.enabled === true) {
    processRule("RSI Filter", "rsi", "rsi", () => rsiEval.evaluate(rules, marketStructure));
  }

  // 7. MACD
  if (rules.macd && rules.macd.enabled === true) {
    processRule("MACD Filter", "macd", "macd", () => macdEval.evaluate(rules, marketStructure));
  }

  // 8. ATR
  if (rules.atr && rules.atr.enabled === true) {
    processRule("ATR Volatility Filter", "atr", "atr", () => atrEval.evaluate(rules, marketStructure));
  }

  // 9. Liquidity Sweep
  if (rules.liquidity_sweep === true) {
    processRule("Liquidity Sweep", "liquidity_sweep", "liquidity_sweep", () => liqEval.evaluate(rules, marketStructure));
  }

  // 10. Fair Value Gap
  if (rules.fair_value_gap === true) {
    processRule("Fair Value Gap", "fair_value_gap", "fair_value_gap", () => fvgEval.evaluate(rules, marketStructure));
  }

  // 11. Support Zone
  if (rules.support === true) {
    processRule("Support Zone", "support", "support", () => supportEval.evaluateSupport(rules, marketStructure));
  }

  // 12. Support Rejection
  if (rules.support_rejection === true) {
    processRule("Support Rejection", "support_rejection", "support", () => supportEval.evaluateSupportRejection(rules, marketStructure));
  }

  // 13. Resistance Zone
  if (rules.resistance === true) {
    processRule("Resistance Zone", "resistance", "resistance", () => resistanceEval.evaluateResistance(rules, marketStructure));
  }

  // 14. Resistance Rejection
  if (rules.resistance_rejection === true) {
    processRule("Resistance Rejection", "resistance_rejection", "resistance", () => resistanceEval.evaluateResistanceRejection(rules, marketStructure));
  }

  // 15. Volume Confirmation
  if (rules.volume_confirmation === true) {
    processRule("Volume Confirmation", "volume_confirmation", "volume_confirmation", () => volEval.evaluate(rules, marketStructure));
  }

  // 16. Sessions
  if (rules.session && rules.session.length > 0) {
    processRule("Session Filter", "session", "session", () => sessionEval.evaluate(rules, marketStructure));
  }

  // 17. Timeframes
  if (rules.timeframes && rules.timeframes.length > 0) {
    processRule("Timeframe Filter", "timeframes", "timeframe", () => tfEval.evaluate(rules, marketStructure));
  }

  // 18. Risk Reward
  if (rules.risk_reward && rules.risk_reward.min_ratio !== undefined) {
    processRule("Risk Reward", "risk_reward", "risk_reward", () => rrEval.evaluate(rules, marketStructure));
  }

  // 19. Confirmation Candle
  if (rules.confirmation_candle === true) {
    processRule("Confirmation Candle", "confirmation_candle", "confirmation_candle", () => ccEval.evaluate(rules, marketStructure));
  }

  // Mandatory Rules check
  const mandatoryRulesList = compiledStrategy.mandatory_rules || [];
  const failedMandatory = evaluatedRules.filter(r => mandatoryRulesList.includes(r.canonicalName) && !r.matched);
  const mandatory_rules_passed = failedMandatory.length === 0;

  // Calculate scores
  let matched_weight = 0;
  let possible_weight = 0;
  evaluatedRules.forEach(r => {
    possible_weight += r.weight;
    if (r.matched) matched_weight += r.weight;
  });

  const decision_score = possible_weight > 0 ? Math.round((matched_weight / possible_weight) * 100) : 100;

  let recommendation: 'PASS' | 'LIKELY_PASS' | 'AMBIGUOUS' | 'FAIL' = 'FAIL';
  let requires_gemini = false;
  let no_trade_reason = undefined;

  if (!mandatory_rules_passed) {
    recommendation = 'FAIL';
    requires_gemini = false;
    no_trade_reason = `Mandatory rules failed: ${failedMandatory.map(r => r.name).join(', ')}`;
    trace.push(`[FAILURE] Mandatory rules failed. Rejecting setup.`);
  } else if (decision_score < 60) {
    recommendation = 'FAIL';
    requires_gemini = false;
    no_trade_reason = `Decision score too low: ${decision_score}% (Required: 60%)`;
    trace.push(`[FAILURE] Score ${decision_score}% below threshold.`);
  } else {
    if (decision_score >= 90) {
      recommendation = 'PASS';
    } else if (decision_score >= 80) {
      recommendation = 'LIKELY_PASS';
      requires_gemini = true;
    } else {
      recommendation = 'AMBIGUOUS';
      requires_gemini = true;
    }

    // Forced Gemini for Hybrid/AI modes
    if (compiledStrategy.strategy_mode !== 'RULE_ONLY') {
      requires_gemini = true;
      trace.push(`[GEMINI] Required by strategy mode: ${compiledStrategy.strategy_mode}`);
    }
  }

  const explanation = no_trade_reason || `Market satisfies ${decision_score}% of strategy rules.`;

  return {
    decision_score,
    matched_weight,
    possible_weight,
    matched_rules: evaluatedRules.filter(r => r.matched).map(r => r.name),
    failed_rules: evaluatedRules.filter(r => !r.matched).map(r => r.name),
    deferred_rules,
    mandatory_rules_passed,
    failed_mandatory_rules: failedMandatory.map(r => r.name),
    recommendation,
    requires_gemini,
    explanation,
    no_trade_reason,
    trace
  };
}
