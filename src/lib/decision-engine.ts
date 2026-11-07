import { CompilerOutput, CanonicalRuleSet } from './strategy-compiler/types.js';
import { normalizeRuleId } from './strategy-compiler/normalizer.js';
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
  ConfirmationCandleEvaluator,
  OrderBlockEvaluator
} from './decision-engine/index.js';

export interface EvaluatedRuleDetail {
  name: string;
  canonicalName: string;
  matched: boolean;
  status: 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE';
  weight: number;
  awarded: number;
  possible: number;
  scoreOutOf10: number;
  reason: string;
}

export interface DecisionResult {
  decision_score: number;
  matched_weight: number;
  possible_weight: number;
  matched_rules: string[];
  failed_rules: string[];
  deferred_rules: string[];
  mandatory_rules_passed: boolean;
  failed_mandatory_rules: string[];
  failed_optional_rules: string[];
  recommendation: 'PASS' | 'LIKELY_PASS' | 'AMBIGUOUS' | 'FAIL';
  requires_gemini: boolean;
  explanation: string;
  no_trade_reason?: string;
  trace: string[];
  rule_details: EvaluatedRuleDetail[];
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
  const hasDetectorValidation = Boolean(compiledStrategy.detector_validation);
  const supportedDetectors = compiledStrategy.detector_validation?.supported_detectors || [];
  const isSupportedDetector = (detectorName: string) => !hasDetectorValidation || supportedDetectors.includes(detectorName);
  const deferred_rules: string[] = [];
  const trace: string[] = [];

  // Extract or build Canonical Rule Set
  const explicitMandatory = compiledStrategy.canonical_rule_set?.mandatory_rule_ids ?? compiledStrategy.mandatory_rules;
  const structuralRules = ['trendline_breakout', 'bos', 'choch'];
  const activeKeys = Object.keys(compiledStrategy.compiled_rules || {});
  const hasStructuralRule = activeKeys.some(k => structuralRules.includes(k));

  let compilerMandatoryIds: string[] = [];
  let isExplicitlyNoMandatory = false;

  if (explicitMandatory !== undefined) {
    compilerMandatoryIds = explicitMandatory.map(id => normalizeRuleId(id)).sort();
    if (compilerMandatoryIds.length === 0 && activeKeys.length > 0 && !hasStructuralRule && compiledStrategy.strategy_mode !== 'AI_ONLY') {
      isExplicitlyNoMandatory = true;
    } else {
      isExplicitlyNoMandatory = false;
    }
  } else if (activeKeys.length > 0 && !hasStructuralRule && compiledStrategy.strategy_mode !== 'AI_ONLY') {
    isExplicitlyNoMandatory = true;
  } else {
    compilerMandatoryIds = [];
    isExplicitlyNoMandatory = false;
  }

  const explicitOptional = compiledStrategy.canonical_rule_set?.optional_rule_ids ?? compiledStrategy.optional_rules;
  const compilerOptionalIds = (explicitOptional || []).map(id => normalizeRuleId(id)).sort();

  // Evaluator's rule IDs based on compiled_rules state and supported engine catalog
  const knownRuleIds = [
    'trendline_breakout', 'break_and_retest', 'confirmation_candle', 'bos', 'choch',
    'liquidity_sweep', 'fair_value_gap', 'order_block', 'supply_demand', 'unmitigated_zone',
    'demand_zone', 'supply_zone', 'support', 'resistance', 'support_rejection',
    'resistance_rejection', 'tap_and_rejection', 'ema', 'rsi', 'macd', 'atr', 'volume_confirmation',
    'session', 'timeframes', 'risk_reward'
  ];
  const evaluatorMandatoryIds = compilerMandatoryIds.filter(id => knownRuleIds.includes(id)).sort();
  const evaluatorOptionalIds = compilerOptionalIds.filter(id => knownRuleIds.includes(id)).sort();

  // Diagnostic Log 2: Evaluator Rule Set Output
  console.log(`\n[EVALUATOR RULE SET]`);
  console.log(`Mandatory: [${evaluatorMandatoryIds.join(', ')}]`);
  console.log(`Optional: [${evaluatorOptionalIds.join(', ')}]\n`);

  // Assertion: Check that evaluator mandatory rule IDs match compiler mandatory rule IDs
  const isMatch = evaluatorMandatoryIds.length === compilerMandatoryIds.length &&
    evaluatorMandatoryIds.every((id, idx) => id === compilerMandatoryIds[idx]);

  if (!isMatch) {
    const mismatchMsg = `[RULE SET MISMATCH] Evaluator mandatory rules [${evaluatorMandatoryIds.join(', ')}] do not match compiler mandatory rules [${compilerMandatoryIds.join(', ')}]`;
    console.warn(mismatchMsg);
    return {
      decision_score: 0,
      matched_weight: 0,
      possible_weight: 0,
      matched_rules: [],
      failed_rules: [],
      deferred_rules: [],
      mandatory_rules_passed: false,
      failed_mandatory_rules: compilerMandatoryIds,
      failed_optional_rules: [],
      recommendation: 'FAIL',
      requires_gemini: false,
      explanation: mismatchMsg,
      no_trade_reason: mismatchMsg,
      trace: [mismatchMsg],
      rule_details: []
    };
  }

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
  const obEval = new OrderBlockEvaluator();

  const evaluatedRules: EvaluatedRuleDetail[] = [];

  // Rule Mapping Helper
  const processRule = (name: string, canonicalName: string, weightKey: keyof typeof RULE_WEIGHTS, evalFn: () => any) => {
    let res: any;
    try {
      res = evalFn();
    } catch (err: any) {
      res = { matched: false, reason: `Evaluation error: ${err.message || 'Unknown error'}` };
    }

    const weight = weights[weightKey] ?? 0;
    let status: 'PASS' | 'FAIL' | 'UNKNOWN' | 'NOT_APPLICABLE' = 'FAIL';

    if (res.status) {
      status = res.status;
    } else if (res.matched === true) {
      status = 'PASS';
    } else if (res.reason && (
      res.reason.toLowerCase().includes('missing') ||
      res.reason.toLowerCase().includes('insufficient') ||
      res.reason.toLowerCase().includes('n/a') ||
      res.reason.toLowerCase().includes('unknown') ||
      res.reason.toLowerCase().includes('not configured')
    )) {
      status = 'UNKNOWN';
    } else {
      status = 'FAIL';
    }

    // Determine 0 to 10 score for continuous confluence scoring
    let scoreOutOf10 = 0;
    if (typeof res.scoreOutOf10 === 'number') {
      scoreOutOf10 = Math.min(10, Math.max(0, res.scoreOutOf10));
    } else if (typeof res.score === 'number' && res.score > 0) {
      if (res.score <= 1) {
        scoreOutOf10 = Math.round(res.score * 10);
      } else {
        scoreOutOf10 = Math.min(10, Math.max(0, Math.round(res.score)));
      }
    } else if (res.matched === true || status === 'PASS') {
      scoreOutOf10 = 10;
    } else if (status === 'UNKNOWN') {
      scoreOutOf10 = 5;
    } else {
      scoreOutOf10 = 0;
    }

    if (res.matched === true || scoreOutOf10 >= 6 || res.status === 'WAITING_FOR_TAP') {
      status = 'PASS';
    } else if (status === 'UNKNOWN') {
      status = 'UNKNOWN';
    } else {
      status = 'FAIL';
    }

    const awarded = Math.round((scoreOutOf10 / 10) * weight * 10) / 10;

    evaluatedRules.push({
      name,
      canonicalName,
      matched: status === 'PASS',
      status,
      weight,
      awarded,
      possible: weight,
      scoreOutOf10,
      reason: res.reason || (status === 'PASS' ? `Rule condition satisfied (${scoreOutOf10}/10 pts)` : `Rule condition partial/failed (${scoreOutOf10}/10 pts)`)
    });

    trace.push(`[RULE] ${name}: ${status} (${scoreOutOf10}/10 pts -> ${awarded}/${weight} pts) - ${res.reason}`);
  };

  // 1. Trendline Breakout
  if (rules.trendline_breakout === true) {
    if (isSupportedDetector('trendline_breakout')) {
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

  // 20. Order Block / Supply & Demand
  if (rules.order_block === true) {
    processRule("Order Block", "order_block", "order_block", () => obEval.evaluate(rules, marketStructure));
  }
  if (rules.supply_demand === true) {
    processRule("Supply and Demand", "supply_demand", "supply_demand", () => obEval.evaluate(rules, marketStructure));
  }
  if (rules.unmitigated_zone === true) {
    processRule("Unmitigated Zone", "unmitigated_zone", "unmitigated_zone", () => obEval.evaluate(rules, marketStructure));
  }
  if (rules.demand_zone === true) {
    processRule("Demand Zone", "demand_zone", "demand_zone", () => obEval.evaluate(rules, marketStructure));
  }
  if (rules.supply_zone === true) {
    processRule("Supply Zone", "supply_zone", "supply_zone", () => obEval.evaluate(rules, marketStructure));
  }

  // 21. Tap & Rejection (Default Confirmation Mode when no explicit confirmation rule is defined)
  if (rules.tap_and_rejection === true) {
    processRule("Tap & Rejection", "tap_and_rejection", "tap_and_rejection", () => {
      const ms = marketStructure as any;
      const isRejected = ms.zone_rejected === true || ms.rejectionConfirmed === true;
      const isTapped = ms.zone_tapped === true || ms.zone_status === 'ZONE_TAPPED' || ms.zone_status === 'CONFIRMED';
      const zone = ms.markedZone;
      const activeStatus = ms.zone_status;

      if (isRejected && isTapped) {
        return {
          matched: true,
          score: 1.0,
          scoreOutOf10: 10,
          reason: `Default Confirmation: Price tapped marked ${zone?.type || 'structural'} zone [${zone?.low ?? ''} - ${zone?.high ?? ''}] and confirmed rejection bounce (10/10).`
        };
      }

      if (isTapped) {
        return {
          matched: true,
          score: 0.9,
          scoreOutOf10: 9,
          reason: `Default Confirmation: Price tapped marked ${zone?.type || 'structural'} zone [${zone?.low ?? ''} - ${zone?.high ?? ''}]. Rejection bounce active (9/10).`
        };
      }

      if (activeStatus === 'WAITING_FOR_TAP' || zone) {
        return {
          matched: false,
          score: 0,
          scoreOutOf10: 0,
          reason: `Default Confirmation: Waiting for price to tap marked ${zone?.type || 'structural'} zone [${zone?.low ?? ''} - ${zone?.high ?? ''}] (0/10).`
        };
      }

      return {
        matched: false,
        score: 0,
        scoreOutOf10: 0,
        reason: "Default Confirmation: No active marked zone identified to evaluate tap & rejection (0/10)."
      };
    });
  }

  // Handle directional pairs: If both opposing directional rules (e.g. support & resistance)
  // are mandatory, satisfying EITHER one satisfies the directional zone requirement
  // for the active trade setup.
  const directionalPairs: [string, string][] = [
    ['support', 'resistance'],
    ['demand_zone', 'supply_zone'],
    ['support_rejection', 'resistance_rejection']
  ];

  for (const [pairA, pairB] of directionalPairs) {
    if (evaluatorMandatoryIds.includes(pairA) && evaluatorMandatoryIds.includes(pairB)) {
      const resA = evaluatedRules.find(r => r.canonicalName === pairA);
      const resB = evaluatedRules.find(r => r.canonicalName === pairB);
      if (resA && resB) {
        if (resA.status === 'PASS' && resB.status === 'FAIL') {
          resB.status = 'NOT_APPLICABLE';
          resB.reason += ' (Opposing directional zone not applicable for active setup)';
        } else if (resB.status === 'PASS' && resA.status === 'FAIL') {
          resA.status = 'NOT_APPLICABLE';
          resA.reason += ' (Opposing directional zone not applicable for active setup)';
        }
      }
    }
  }

  // Context-aware reconciliation for mutually exclusive structural conditions (BOS vs CHOCH)
  // BOS is trend continuation; CHOCH is trend reversal. They represent mutually exclusive structural modes.
  // When both rules are configured (e.g. Default Gaks Strategy), they must not inflate the scoring denominator.
  const resBos = evaluatedRules.find(r => r.canonicalName === 'bos');
  const resChoch = evaluatedRules.find(r => r.canonicalName === 'choch');

  if (resBos || resChoch) {
    const rawContext = (marketStructure?.structuralContext || marketStructure?.setupType || '').toString().toUpperCase();
    let structuralMode: 'CONTINUATION' | 'REVERSAL' | 'NEITHER' | 'UNDETERMINED' = 'UNDETERMINED';

    if (rawContext === 'CONTINUATION') {
      structuralMode = 'CONTINUATION';
    } else if (rawContext === 'REVERSAL') {
      structuralMode = 'REVERSAL';
    } else if (rawContext === 'NEITHER' || rawContext === 'NONE') {
      structuralMode = 'NEITHER';
    } else {
      // Deduce from detected structural events
      const hasBosPass = resBos?.status === 'PASS';
      const hasChochPass = resChoch?.status === 'PASS';

      if (hasBosPass && !hasChochPass) {
        structuralMode = 'CONTINUATION';
      } else if (hasChochPass && !hasBosPass) {
        structuralMode = 'REVERSAL';
      } else {
        // Fallback to trend vs trade direction if available
        const trend = (marketStructure?.trend || '').toString().toUpperCase();
        const dir = (marketStructure?.direction || marketStructure?.markedZone?.direction || '').toString().toUpperCase();
        if (trend === 'BULLISH' && dir === 'BUY') {
          structuralMode = 'CONTINUATION';
        } else if (trend === 'BEARISH' && dir === 'SELL') {
          structuralMode = 'CONTINUATION';
        } else if (trend === 'BULLISH' && dir === 'SELL') {
          structuralMode = 'REVERSAL';
        } else if (trend === 'BEARISH' && dir === 'BUY') {
          structuralMode = 'REVERSAL';
        } else if (!hasBosPass && !hasChochPass && (rawContext === '' || trend === 'SIDEWAYS')) {
          if (resBos && resChoch) {
            structuralMode = 'NEITHER';
          }
        }
      }
    }

    if (structuralMode === 'CONTINUATION') {
      if (resChoch) {
        resChoch.status = 'NOT_APPLICABLE';
        resChoch.reason = 'BOS continuation setup; CHOCH reversal not applicable';
      }
    } else if (structuralMode === 'REVERSAL') {
      if (resBos) {
        resBos.status = 'NOT_APPLICABLE';
        resBos.reason = 'CHOCH reversal setup; BOS continuation not applicable';
      }
    } else if (structuralMode === 'NEITHER') {
      if (resBos) {
        resBos.status = 'NOT_APPLICABLE';
        resBos.reason = 'Neither BOS nor CHOCH applicable to current market context';
      }
      if (resChoch) {
        resChoch.status = 'NOT_APPLICABLE';
        resChoch.reason = 'Neither BOS nor CHOCH applicable to current market context';
      }
    }
  }

  // Mandatory Rules check: strictly match canonical IDs. 
  // Any mandatory rule that is FAIL or UNKNOWN (missing data) must block the trade.
  const failedMandatory = evaluatedRules.filter(
    r => evaluatorMandatoryIds.includes(r.canonicalName) && (r.status === 'FAIL' || r.status === 'UNKNOWN')
  );
  const failedOptional = evaluatedRules.filter(
    r => evaluatorOptionalIds.includes(r.canonicalName) && r.status === 'FAIL'
  );
  const mandatory_rules_passed = !isExplicitlyNoMandatory && failedMandatory.length === 0;

  // Calculate scores
  let matched_weight = 0;
  let possible_weight = 0;
  evaluatedRules.forEach(r => {
    if (r.status !== 'NOT_APPLICABLE') {
      possible_weight += r.weight;
      matched_weight += r.awarded;
    }
  });

  const decision_score = possible_weight > 0 ? Math.round((matched_weight / possible_weight) * 100) : 100;

  let recommendation: 'PASS' | 'LIKELY_PASS' | 'AMBIGUOUS' | 'FAIL' = 'FAIL';
  let requires_gemini = false;
  let no_trade_reason = undefined;

  if (!mandatory_rules_passed) {
    recommendation = 'FAIL';
    requires_gemini = false;
    no_trade_reason = `Mandatory rules failed: ${failedMandatory.map(r => r.name).join(', ')}.`;
    trace.push(`[FAILURE] Mandatory rules failed. Rejecting setup.`);
  } else if (decision_score < 50) {
    recommendation = 'FAIL';
    requires_gemini = false;
    no_trade_reason = `Decision score too low: ${decision_score}% (Required: 50% for high-speed evaluation).`;
    trace.push(`[FAILURE] Score ${decision_score}% below evaluation threshold.`);
  } else {
    if (decision_score >= 75) {
      recommendation = 'PASS';
    } else {
      recommendation = 'LIKELY_PASS'; // 50% - 74.9% marked as LIKELY_PASS for immediate zone marking & execution
    }
    requires_gemini = false; // Rule-only high-speed execution mode bypasses external AI roundtrips
  }

  // Forced Gemini for Hybrid/AI modes regardless of score (if score >= 60)
  if (compiledStrategy.strategy_mode !== 'RULE_ONLY' && decision_score >= 60) {
    requires_gemini = true;
    trace.push(`[GEMINI] Required by strategy mode: ${compiledStrategy.strategy_mode}`);
  }

  const explanation = no_trade_reason || `Market satisfies ${decision_score}% of strategy rules.`;



  return {
    decision_score,
    matched_weight,
    possible_weight,
    matched_rules: evaluatedRules.filter(r => r.status === 'PASS').map(r => r.name),
    failed_rules: evaluatedRules.filter(r => r.status === 'FAIL').map(r => r.name),
    deferred_rules,
    mandatory_rules_passed,
    failed_mandatory_rules: failedMandatory.map(r => r.name),
    failed_optional_rules: failedOptional.map(r => r.name),
    recommendation,
    requires_gemini,
    explanation,
    no_trade_reason,
    trace,
    rule_details: evaluatedRules
  };
}
