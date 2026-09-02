import { CompilerOutput, CompiledRules, CanonicalRuleDef, CanonicalRuleSet } from './strategy-compiler/types.js';
import { TrendlineParser } from './strategy-compiler/trendline.js';
import { BosParser } from './strategy-compiler/bos.js';
import { ChochParser } from './strategy-compiler/choch.js';
import { EmaParser } from './strategy-compiler/ema.js';
import { RsiParser } from './strategy-compiler/rsi.js';
import { SessionParser } from './strategy-compiler/session.js';
import { VolumeParser } from './strategy-compiler/volume.js';
import { LiquidityParser } from './strategy-compiler/liquidity.js';
import { FvgParser } from './strategy-compiler/fvg.js';
import { SupportResistanceParser } from './strategy-compiler/support-resistance.js';
import { MacdParser } from './strategy-compiler/macd.js';
import { AtrParser } from './strategy-compiler/atr.js';
import { ConfirmationCandleParser } from './strategy-compiler/confirmation-candle.js';
import { OrderBlockParser } from './strategy-compiler/order-block.js';
import { RiskRewardParser } from './strategy-compiler/risk-reward.js';
import { TimeframeParser } from './strategy-compiler/timeframe.js';
import { ClassificationParser } from './strategy-compiler/classification.js';
import { isMandatory, isOptional, extractDedicatedMandatorySection, normalizeRuleId } from './strategy-compiler/normalizer.js';
import { validateDetectors } from './detector-capability-validator.js';

export * from './strategy-compiler/types.js';

/**
 * Strategy Compiler converts natural language strategies into structured JSON rules
 * using highly modular sub-parsers for individual deterministic indicators and concepts.
 * This runs solely during strategy creation/edit actions and never during live scans.
 */
export function compileStrategy(strategyText: string): CompilerOutput {
  const emptyRuleSet: CanonicalRuleSet = {
    strategy_mode: 'AI_ONLY',
    execution_mode: 'AI_ONLY',
    mandatory_rule_ids: [],
    optional_rule_ids: [],
    rules: []
  };

  if (!strategyText || typeof strategyText !== 'string' || strategyText.trim().length === 0) {
    return {
      strategy_mode: 'AI_ONLY',
      compiled_rules: {},
      confidence: 0.0,
      overall_confidence: 0.0,
      module_confidence: {},
      matched_phrases: [],
      canonical_rules: [],
      mandatory_rules: [],
      optional_rules: [],
      canonical_rule_set: emptyRuleSet,
      weighted_rules: [],
      status: 'AMBIGUOUS_STRATEGY'
    };
  }

  // Instantiate sub-parsers
  const trendlineParser = new TrendlineParser();
  const bosParser = new BosParser();
  const chochParser = new ChochParser();
  const emaParser = new EmaParser();
  const rsiParser = new RsiParser();
  const sessionParser = new SessionParser();
  const volumeParser = new VolumeParser();
  const liquidityParser = new LiquidityParser();
  const fvgParser = new FvgParser();
  const srParser = new SupportResistanceParser();
  const macdParser = new MacdParser();
  const atrParser = new AtrParser();
  const confirmationCandleParser = new ConfirmationCandleParser();
  const orderBlockParser = new OrderBlockParser();
  const rrParser = new RiskRewardParser();
  const timeframeParser = new TimeframeParser();
  const classificationParser = new ClassificationParser();

  // Execute parsing pipeline in isolation
  const trendlineResult = trendlineParser.parse(strategyText);
  const bosResult = bosParser.parse(strategyText);
  const chochResult = chochParser.parse(strategyText);
  const emaResult = emaParser.parse(strategyText);
  const rsiResult = rsiParser.parse(strategyText);
  const sessionResult = sessionParser.parse(strategyText);
  const volumeResult = volumeParser.parse(strategyText);
  const liquidityResult = liquidityParser.parse(strategyText);
  const fvgResult = fvgParser.parse(strategyText);
  const orderBlockResult = orderBlockParser.parse(strategyText);
  const srResult = srParser.parse(strategyText);
  const macdResult = macdParser.parse(strategyText);
  const atrResult = atrParser.parse(strategyText);
  const confirmationCandleResult = confirmationCandleParser.parse(strategyText);
  const rrResult = rrParser.parse(strategyText);
  const timeframeResult = timeframeParser.parse(strategyText);
  const classificationResult = classificationParser.parse(strategyText);

  // Assemble the compiled rules
  const compiled_rules: CompiledRules = {
    trendline_breakout: trendlineResult.parsedRule.trendline_breakout,
    break_and_retest: trendlineResult.parsedRule.break_and_retest,
    confirmation_candle: confirmationCandleResult.parsedRule,
    bos: bosResult.parsedRule,
    choch: chochResult.parsedRule,
    liquidity_sweep: liquidityResult.parsedRule,
    fair_value_gap: fvgResult.parsedRule,
    order_block: orderBlockResult.parsedRule.order_block,
    supply_demand: orderBlockResult.parsedRule.supply_demand,
    unmitigated_zone: orderBlockResult.parsedRule.unmitigated_zone,
    support: srResult.parsedRule.support,
    resistance: srResult.parsedRule.resistance,
    support_rejection: srResult.parsedRule.support_rejection,
    resistance_rejection: srResult.parsedRule.resistance_rejection,
    ema: emaResult.parsedRule,
    rsi: rsiResult.parsedRule,
    macd: macdResult.parsedRule,
    atr: atrResult.parsedRule,
    volume_confirmation: volumeResult.parsedRule,
    session: sessionResult.parsedRule,
    timeframes: timeframeResult.parsedRule,
    risk_reward: rrResult.parsedRule,
    subjective_elements: classificationResult.parsedRule.subjective_elements,
    ai_only_elements: classificationResult.parsedRule.ai_only_elements
  };

  // Classify strategy mode based on strict deterministic priority rules:
  let strategy_mode: 'RULE_ONLY' | 'HYBRID' | 'AI_ONLY' = 'RULE_ONLY';
  if (classificationResult.parsedRule.ai_only_elements.length > 0) {
    strategy_mode = 'AI_ONLY';
  } else if (classificationResult.parsedRule.subjective_elements.length > 0) {
    strategy_mode = 'HYBRID';
  }

  // Calculate overall confidence based on matched concepts
  const confidences: number[] = [];
  if (trendlineResult.supported) confidences.push(trendlineResult.confidence);
  if (bosResult.supported) confidences.push(bosResult.confidence);
  if (chochResult.supported) confidences.push(chochResult.confidence);
  if (emaResult.supported) confidences.push(emaResult.confidence);
  if (rsiResult.supported) confidences.push(rsiResult.confidence);
  if (sessionResult.supported) confidences.push(sessionResult.confidence);
  if (volumeResult.supported) confidences.push(volumeResult.confidence);
  if (liquidityResult.supported) confidences.push(liquidityResult.confidence);
  if (fvgResult.supported) confidences.push(fvgResult.confidence);
  if (orderBlockResult.supported) confidences.push(orderBlockResult.confidence);
  if (srResult.supported) confidences.push(srResult.confidence);
  if (macdResult.supported) confidences.push(macdResult.confidence);
  if (atrResult.supported) confidences.push(atrResult.confidence);
  if (confirmationCandleResult.supported) confidences.push(confirmationCandleResult.confidence);
  if (rrResult.supported) confidences.push(rrResult.confidence);
  if (timeframeResult.supported) confidences.push(timeframeResult.confidence);
  if (classificationResult.supported) confidences.push(classificationResult.confidence);

  let confidence = 0.95;
  if (confidences.length > 0) {
    const sum = confidences.reduce((acc, val) => acc + val, 0);
    confidence = parseFloat((sum / confidences.length).toFixed(2));
  } else {
    confidence = 0.90;
  }

  // Build module specific confidences and matched phrases
  const modules = [
    { name: 'trendline', result: trendlineResult },
    { name: 'bos', result: bosResult },
    { name: 'choch', result: chochResult },
    { name: 'ema', result: emaResult },
    { name: 'rsi', result: rsiResult },
    { name: 'session', result: sessionResult },
    { name: 'volume', result: volumeResult },
    { name: 'liquidity', result: liquidityResult },
    { name: 'fair_value_gap', result: fvgResult },
    { name: 'order_block', result: orderBlockResult },
    { name: 'supply_demand', result: orderBlockResult },
    { name: 'unmitigated_zone', result: orderBlockResult },
    { name: 'support_resistance', result: srResult },
    { name: 'macd', result: macdResult },
    { name: 'atr', result: atrResult },
    { name: 'confirmation_candle', result: confirmationCandleResult },
    { name: 'risk_reward', result: rrResult },
    { name: 'timeframes', result: timeframeResult },
    { name: 'classification', result: classificationResult }
  ];

  const module_confidence: { [key: string]: number } = {};
  const matched_phrases: string[] = [];
  for (const m of modules) {
    if (m.result.supported) {
      module_confidence[m.name] = m.result.confidence;
      if (m.result.matchedPhrase) {
        matched_phrases.push(m.result.matchedPhrase);
      }
    }
  }

  // Build complete Canonical Rule Set
  const ruleCatalog: { id: string; name: string; phrase: string; weight: number; active: boolean }[] = [
    { id: 'trendline_breakout', name: 'Trendline Breakout', phrase: 'trendline', weight: 25, active: !!compiled_rules.trendline_breakout },
    { id: 'break_and_retest', name: 'Break and Retest', phrase: 'retest', weight: 20, active: !!compiled_rules.break_and_retest },
    { id: 'bos', name: 'BOS', phrase: 'bos', weight: 20, active: !!compiled_rules.bos },
    { id: 'choch', name: 'CHOCH', phrase: 'choch', weight: 15, active: !!compiled_rules.choch },
    { id: 'order_block', name: 'Order Block', phrase: 'order block', weight: 20, active: !!compiled_rules.order_block },
    { id: 'supply_demand', name: 'Supply and Demand', phrase: 'supply and demand', weight: 20, active: !!compiled_rules.supply_demand },
    { id: 'unmitigated_zone', name: 'Unmitigated Zone', phrase: 'unmitigated', weight: 15, active: !!compiled_rules.unmitigated_zone },
    { id: 'confirmation_candle', name: 'Confirmation Candle', phrase: 'confirmation candle', weight: 15, active: !!compiled_rules.confirmation_candle },
    { id: 'liquidity_sweep', name: 'Liquidity Sweep', phrase: 'liquidity', weight: 15, active: !!compiled_rules.liquidity_sweep },
    { id: 'fair_value_gap', name: 'Fair Value Gap', phrase: 'fair value gap', weight: 12, active: !!compiled_rules.fair_value_gap },
    { id: 'support', name: 'Support Zone', phrase: 'support', weight: 10, active: !!compiled_rules.support },
    { id: 'resistance', name: 'Resistance Zone', phrase: 'resistance', weight: 10, active: !!compiled_rules.resistance },
    { id: 'support_rejection', name: 'Support Rejection', phrase: 'support rejection', weight: 10, active: !!compiled_rules.support_rejection },
    { id: 'resistance_rejection', name: 'Resistance Rejection', phrase: 'resistance rejection', weight: 10, active: !!compiled_rules.resistance_rejection },
    { id: 'ema', name: 'EMA Alignment', phrase: 'ema', weight: 5, active: !!compiled_rules.ema?.enabled },
    { id: 'rsi', name: 'RSI Filter', phrase: 'rsi', weight: 4, active: !!compiled_rules.rsi?.enabled },
    { id: 'macd', name: 'MACD Filter', phrase: 'macd', weight: 4, active: !!compiled_rules.macd?.enabled },
    { id: 'atr', name: 'ATR Volatility Filter', phrase: 'atr', weight: 6, active: !!compiled_rules.atr?.enabled },
    { id: 'volume_confirmation', name: 'Volume Confirmation', phrase: 'volume', weight: 8, active: !!compiled_rules.volume_confirmation },
    { id: 'session', name: 'Session Filter', phrase: 'session', weight: 10, active: !!(compiled_rules.session && compiled_rules.session.length > 0) },
    { id: 'timeframes', name: 'Timeframe Filter', phrase: 'timeframe', weight: 8, active: !!(compiled_rules.timeframes && compiled_rules.timeframes.length > 0) },
    { id: 'risk_reward', name: 'Risk Reward', phrase: 'risk reward', weight: 3, active: !!(compiled_rules.risk_reward && compiled_rules.risk_reward.min_ratio !== undefined) }
  ];

  const canonicalRuleDefs: CanonicalRuleDef[] = [];
  const mandatory_rules: string[] = [];
  const optional_rules: string[] = [];
  const canonical_rules: string[] = [];
  const weighted_rules: { rule: string; weight: number }[] = [];

  const rulePhrases: Record<string, string[]> = {
    trendline_breakout: ['trendline breakout', 'trendline', 'breakout'],
    break_and_retest: ['break and retest', 'break & retest', 'retest'],
    bos: ['break of structure', 'bos'],
    choch: ['change of character', 'choch'],
    order_block: ['order block', 'order blocks', 'orderblock', 'ob', 'demand zone', 'supply zone', 'institutional zone', 'unmitigated order block'],
    supply_demand: ['supply and demand', 'supply & demand', 'demand zone', 'supply zone', 'supply', 'demand'],
    unmitigated_zone: ['unmitigated zone', 'unmitigated', 'fresh zone', 'unmitigated order block', 'unmitigated filter'],
    confirmation_candle: ['confirmation candle', 'candle confirmation', 'confirmation'],
    liquidity_sweep: ['liquidity sweep', 'liquidity'],
    fair_value_gap: ['fair value gap', 'fvg'],
    support: ['support zone', 'support level', 'support'],
    resistance: ['resistance zone', 'resistance level', 'resistance'],
    support_rejection: ['support rejection', 'bounce from support', 'demand rejection'],
    resistance_rejection: ['resistance rejection', 'bounce from resistance', 'supply rejection'],
    ema: ['ema alignment', 'ema'],
    rsi: ['rsi filter', 'rsi'],
    macd: ['macd filter', 'macd'],
    atr: ['atr volatility filter', 'atr filter', 'atr'],
    volume_confirmation: ['volume confirmation', 'volume'],
    session: ['session filter', 'session'],
    timeframes: ['timeframe filter', 'timeframe'],
    risk_reward: ['risk & reward', 'risk reward', 'risk-to-reward', 'risk to reward', 'risk:reward', 'take profit', 'stop loss', '1:2rr', '1:2 rr', 'rr']
  };

  // Check if strategy has any explicitly declared mandatory rules or mandatory sections
  const hasDedicatedMandatory = !!extractDedicatedMandatorySection(strategyText);
  let hasAnyMandatoryRule = hasDedicatedMandatory;

  if (!hasAnyMandatoryRule) {
    for (const item of ruleCatalog) {
      if (item.active) {
        const phrasesToCheck = [item.phrase, ...(rulePhrases[item.id] || [])];
        if (phrasesToCheck.some(p => isMandatory(strategyText, p))) {
          hasAnyMandatoryRule = true;
          break;
        }
      }
    }
  }

  for (const item of ruleCatalog) {
    if (item.active) {
      const moduleObj = modules.find(m => m.name === item.id);
      const primaryPhrase = (moduleObj && moduleObj.result && moduleObj.result.matchedPhrase) ? moduleObj.result.matchedPhrase : item.phrase;
      const phrasesToCheck = [primaryPhrase, ...(rulePhrases[item.id] || [item.phrase])].filter(p => {
        if (item.id.includes('support')) {
          return !p.toLowerCase().includes('resistance') && !p.toLowerCase().includes('supply');
        }
        if (item.id.includes('resistance')) {
          return !p.toLowerCase().includes('support') && !p.toLowerCase().includes('demand');
        }
        return true;
      });
      const isMand = phrasesToCheck.some(p => isMandatory(strategyText, p));
      const isOpt = phrasesToCheck.some(p => isOptional(strategyText, p));

      if (isMand) {
        canonicalRuleDefs.push({
          id: item.id,
          name: item.name,
          isMandatory: true,
          weight: item.weight
        });
        canonical_rules.push(item.id);
        weighted_rules.push({ rule: item.id, weight: item.weight });
        mandatory_rules.push(item.id);
      } else if (isOpt) {
        canonicalRuleDefs.push({
          id: item.id,
          name: item.name,
          isMandatory: false,
          weight: item.weight
        });
        canonical_rules.push(item.id);
        weighted_rules.push({ rule: item.id, weight: item.weight });
        optional_rules.push(item.id);
      } else if (!hasAnyMandatoryRule) {
        // Only if the strategy has NO mandatory declarations at all,
        // treat detected rules as default weighted/optional rules.
        canonicalRuleDefs.push({
          id: item.id,
          name: item.name,
          isMandatory: false,
          weight: item.weight
        });
        canonical_rules.push(item.id);
        weighted_rules.push({ rule: item.id, weight: item.weight });
        optional_rules.push(item.id);
      }
    }
  }

  mandatory_rules.sort();
  optional_rules.sort();
  canonical_rules.sort();

  const detector_validation = validateDetectors(Object.keys(compiled_rules));
  const execution_mode = detector_validation?.execution_mode || strategy_mode;

  const canonical_rule_set: CanonicalRuleSet = {
    strategy_mode,
    execution_mode,
    mandatory_rule_ids: mandatory_rules,
    optional_rule_ids: optional_rules,
    rules: canonicalRuleDefs
  };

  // Handle ambiguous strategy
  let status: 'SUCCESS' | 'AMBIGUOUS_STRATEGY' | 'FAILURE' = 'SUCCESS';
  let error_message = undefined;

  if (canonical_rules.length === 0 && strategyText.trim().length > 30) {
    status = 'AMBIGUOUS_STRATEGY';
    error_message = "Strategy text is descriptive but no deterministic indicators were identified. Please mention specific rules like BOS, EMA, or FVG.";
  }

  // Diagnostic Log 1: Canonical Rule Set Output
  console.log(`\n[CANONICAL RULE SET]`);
  console.log(`Mandatory: [${mandatory_rules.join(', ')}]`);
  console.log(`Optional: [${optional_rules.join(', ')}]`);
  console.log(`Strategy Mode: ${strategy_mode}`);
  console.log(`Execution Mode: ${execution_mode}\n`);

  return {
    strategy_mode,
    compiled_rules,
    mandatory_rules,
    optional_rules,
    canonical_rule_set,
    weighted_rules,
    confidence: Math.round(confidence <= 1.0 ? confidence * 100 : confidence),
    overall_confidence: Math.round(confidence <= 1.0 ? confidence * 100 : confidence),
    module_confidence,
    matched_phrases,
    canonical_rules,
    detector_validation,
    status,
    error_message
  };
}
