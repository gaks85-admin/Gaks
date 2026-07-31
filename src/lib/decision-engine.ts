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
  const supportedDetectors = compiledStrategy.detector_validation?.supported_detectors || [];
  const deferred_rules: string[] = [];

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
    expected: string;
    actual: string;
    weight: number;
  }[] = [];

  // 1. Trendline Breakout
  if (rules.trendline_breakout === true) {
    if (supportedDetectors.includes('trendline_breakout')) {
      const res = trendlineEval.evaluateBreakout(rules, marketStructure);
      evaluatedRules.push({
        name: "Trendline Breakout",
        weightKey: "trendline_breakout",
        matched: res.matched,
        reason: res.reason,
        expected: "TRUE",
        actual: res.matched ? "TRUE" : "FALSE",
        weight: weights.trendline_breakout ?? 0
      });
    } else {
      deferred_rules.push("Trendline Breakout");
    }
  }

  // 2. Break and Retest
  if (rules.break_and_retest === true) {
    const res = trendlineEval.evaluateRetest(rules, marketStructure);
    evaluatedRules.push({
      name: "Break and Retest",
      weightKey: "break_and_retest",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.break_and_retest ?? 0
    });
  }

  // 3. BOS
  if (rules.bos === true) {
    const res = bosEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "BOS",
      weightKey: "bos",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.bos ?? 0
    });
  }

  // 4. CHOCH
  if (rules.choch === true) {
    const res = chochEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "CHOCH",
      weightKey: "choch",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.choch ?? 0
    });
  }

  // 5. EMA
  if (rules.ema && rules.ema.enabled === true) {
    const res = emaEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "EMA Alignment",
      weightKey: "ema",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.ema ?? 0
    });
  }

  // 6. RSI
  if (rules.rsi && rules.rsi.enabled === true) {
    const res = rsiEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "RSI Filter",
      weightKey: "rsi",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.rsi ?? 0
    });
  }

  // 7. MACD
  if (rules.macd && rules.macd.enabled === true) {
    const res = macdEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "MACD Filter",
      weightKey: "macd",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.macd ?? 0
    });
  }

  // 8. ATR
  if (rules.atr && rules.atr.enabled === true) {
    const res = atrEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "ATR Volatility Filter",
      weightKey: "atr",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.atr ?? 0
    });
  }

  // 9. Liquidity Sweep
  if (rules.liquidity_sweep === true) {
    const res = liqEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "Liquidity Sweep",
      weightKey: "liquidity_sweep",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.liquidity_sweep ?? 0
    });
  }

  // 10. Fair Value Gap
  if (rules.fair_value_gap === true) {
    const res = fvgEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "Fair Value Gap",
      weightKey: "fair_value_gap",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.fair_value_gap ?? 0
    });
  }

  // 11. Support Zone
  if (rules.support === true) {
    const res = supportEval.evaluateSupport(rules, marketStructure);
    evaluatedRules.push({
      name: "Support Zone",
      weightKey: "support",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.support ?? 0
    });
  }

  // 12. Support Rejection
  if (rules.support_rejection === true) {
    const res = supportEval.evaluateSupportRejection(rules, marketStructure);
    evaluatedRules.push({
      name: "Support Rejection",
      weightKey: "support",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.support ?? 0
    });
  }

  // 13. Resistance Zone
  if (rules.resistance === true) {
    const res = resistanceEval.evaluateResistance(rules, marketStructure);
    evaluatedRules.push({
      name: "Resistance Zone",
      weightKey: "resistance",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.resistance ?? 0
    });
  }

  // 14. Resistance Rejection
  if (rules.resistance_rejection === true) {
    const res = resistanceEval.evaluateResistanceRejection(rules, marketStructure);
    evaluatedRules.push({
      name: "Resistance Rejection",
      weightKey: "resistance",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.resistance ?? 0
    });
  }

  // 15. Volume Confirmation
  if (rules.volume_confirmation === true) {
    const res = volEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "Volume Confirmation",
      weightKey: "volume_confirmation",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.volume_confirmation ?? 0
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
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.session ?? 0
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
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.timeframe ?? 0
    });
  }

  // 18. Risk Reward
  if (rules.risk_reward && rules.risk_reward.min_ratio !== undefined) {
    const res = rrEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "Risk Reward",
      weightKey: "risk_reward",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.risk_reward ?? 0
    });
  }

  // 19. Confirmation Candle
  if (rules.confirmation_candle === true) {
    const res = ccEval.evaluate(rules, marketStructure);
    evaluatedRules.push({
      name: "Confirmation Candle",
      weightKey: "confirmation_candle",
      matched: res.matched,
      reason: res.reason,
      expected: "TRUE",
      actual: res.matched ? "TRUE" : "FALSE",
      weight: weights.confirmation_candle ?? 0
    });
  }

  // 20. Historical Probability
  if (sampleSize !== undefined && historicalProbability !== undefined) {
    const matched = historicalProbability >= 60.0;
    let otherPossibleWeight = 0;
    evaluatedRules.forEach(rule => {
      if (rule.name !== "Historical Probability") {
        otherPossibleWeight += weights[rule.weightKey] ?? 0;
      }
    });
    const histWeight = (sampleSize !== undefined && sampleSize >= 20)
      ? (otherPossibleWeight > 0 ? Math.round(0.25 * otherPossibleWeight) : 20)
      : 0;

    evaluatedRules.push({
      name: "Historical Probability",
      weightKey: "historical_probability" as any,
      matched,
      reason: `Historical Win Rate for similar setups is ${historicalProbability}% (Sample: ${sampleSize} trades, Confidence: ${sampleSize >= 100 ? 'HIGH' : sampleSize >= 20 ? 'MEDIUM' : 'LOW'}).`,
      expected: "TRUE",
      actual: matched ? "TRUE" : "FALSE",
      weight: histWeight
    });
  }

  const matchedRulesObj = evaluatedRules.filter(r => r.matched);
  const failedRulesObj = evaluatedRules.filter(r => !r.matched);

  const matched_rules = matchedRulesObj.map(r => r.name);
  const failed_rules = failedRulesObj.map(r => r.name);

  // Calculate weights
  let matched_weight = 0;
  let possible_weight = 0;

  let otherPossibleWeight = 0;
  evaluatedRules.forEach(rule => {
    if (rule.name !== "Historical Probability") {
      otherPossibleWeight += weights[rule.weightKey] ?? 0;
    }
  });

  evaluatedRules.forEach(rule => {
    let ruleWeight = 0;
    if (rule.name === "Historical Probability") {
      if (sampleSize !== undefined && sampleSize >= 20) {
        ruleWeight = otherPossibleWeight > 0 ? Math.round(0.25 * otherPossibleWeight) : 20;
      } else {
        ruleWeight = 0;
      }
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

  // === TEMPORARY DECISION ENGINE DEBUG MODE ===
  const pair = marketStructure.pair || "Unknown";
  const timeframe = marketStructure.timeframe || "Unknown";
  const latestCandles = marketStructure.latestCandles || [];
  const lastClosedCandleTimestamp = marketStructure.lastClosedCandleTimestamp || (latestCandles.length >= 2
    ? latestCandles[latestCandles.length - 2]?.timestamp
    : (latestCandles[latestCandles.length - 1]?.timestamp || "N/A"));
  const trend = marketStructure.trend || "SIDEWAYS";
  const bos = (marketStructure.BOS && marketStructure.BOS.some((b: any) => b.type === 'BULLISH_BOS' || b.type === 'BEARISH_BOS')) ? 'YES' : 'NO';
  const choch = (marketStructure.CHOCH && marketStructure.CHOCH.some((c: any) => c.type === 'BULLISH_CHOCH' || c.type === 'BEARISH_CHOCH')) ? 'YES' : 'NO';
  const trendlineBreakout = ((marketStructure.breakouts && marketStructure.breakouts.some((b: any) => b.type === 'UPPER_BREAKOUT' || b.type === 'LOWER_BREAKOUT')) || (marketStructure.trendlines && marketStructure.trendlines.length > 0)) ? 'YES' : 'NO';
  const breakAndRetest = (marketStructure.retests && marketStructure.retests.some((r: any) => r.confirmed === true)) ? 'YES' : 'NO';
  const liquiditySweep = (marketStructure.liquiditySweeps && marketStructure.liquiditySweeps.some((l: any) => l.type === 'HIGH_SWEEP' || l.type === 'LOW_SWEEP')) ? 'YES' : 'NO';
  const fairValueGap = (marketStructure.fairValueGaps && marketStructure.fairValueGaps.length > 0) ? 'YES' : 'NO';
  const support = (marketStructure.supportZones && marketStructure.supportZones.length > 0) ? 'YES' : 'NO';
  const resistance = (marketStructure.resistanceZones && marketStructure.resistanceZones.length > 0) ? 'YES' : 'NO';
  const volumeConfirmation = (marketStructure.volumeInformation?.volumeSpike) ? 'YES' : 'NO';
  const atr = marketStructure.volatilityInformation?.atr || 0;
  const session = (() => {
    const lastCandle = latestCandles[latestCandles.length - 1];
    const date = lastCandle && lastCandle.timestamp ? new Date(lastCandle.timestamp) : new Date();
    const hour = date.getUTCHours();
    if (hour >= 8 && hour < 13) return "London";
    if (hour >= 13 && hour < 17) return "London / NY";
    if (hour >= 17 && hour < 21) return "NY";
    if (hour >= 0 && hour < 8) return "Asia";
    return "Asia";
  })();
  const timeframeDetected = marketStructure.timeframe || "Unknown";

  console.log(`\n========================================`);
  console.log(`[DECISION ENGINE DEBUG MODE]`);
  console.log(`========================================`);
  console.log(`1. Pair: ${pair}`);
  console.log(`2. Timeframe: ${timeframe}`);
  console.log(`3. Last closed candle timestamp: ${lastClosedCandleTimestamp}`);
  console.log(`4. Trend: ${trend}`);
  console.log(`5. BOS: ${bos}`);
  console.log(`6. CHOCH: ${choch}`);
  console.log(`7. Trendline Breakout: ${trendlineBreakout}`);
  console.log(`8. Break & Retest: ${breakAndRetest}`);
  console.log(`9. Liquidity Sweep: ${liquiditySweep}`);
  console.log(`10. Fair Value Gap: ${fairValueGap}`);
  console.log(`11. Support: ${support}`);
  console.log(`12. Resistance: ${resistance}`);
  console.log(`13. Volume Confirmation: ${volumeConfirmation}`);
  console.log(`14. ATR: ${atr}`);
  console.log(`15. Session: ${session}`);
  console.log(`16. Timeframe detected by the Market Structure Engine: ${timeframeDetected}`);
  console.log(`========================================`);

  console.log(`\n--- Compiled Strategy Output ---`);
  console.log(JSON.stringify(compiledStrategy, null, 2));
  console.log(`========================================`);

  console.log(`\n--- Rule Evaluation Details ---`);
  for (const rule of evaluatedRules) {
    console.log(`\nRule: ${rule.name}`);
    console.log(`Expected: ${rule.expected}`);
    console.log(`Actual: ${rule.actual}`);
    console.log(`Match: ${rule.matched ? "YES" : "NO"}`);
    console.log(`Weight: ${rule.matched ? rule.weight : -rule.weight}`);
  }
  console.log(`========================================`);

  // Original Structured Log Generation (kept intact)
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
