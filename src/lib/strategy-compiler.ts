import { CompilerOutput, CompiledRules } from './strategy-compiler/types';
import { TrendlineParser } from './strategy-compiler/trendline';
import { BosParser } from './strategy-compiler/bos';
import { ChochParser } from './strategy-compiler/choch';
import { EmaParser } from './strategy-compiler/ema';
import { RsiParser } from './strategy-compiler/rsi';
import { SessionParser } from './strategy-compiler/session';
import { VolumeParser } from './strategy-compiler/volume';
import { LiquidityParser } from './strategy-compiler/liquidity';
import { FvgParser } from './strategy-compiler/fvg';
import { SupportResistanceParser } from './strategy-compiler/support-resistance';
import { MacdParser } from './strategy-compiler/macd';
import { AtrParser } from './strategy-compiler/atr';
import { ConfirmationCandleParser } from './strategy-compiler/confirmation-candle';
import { RiskRewardParser } from './strategy-compiler/risk-reward';
import { TimeframeParser } from './strategy-compiler/timeframe';
import { ClassificationParser } from './strategy-compiler/classification';

export * from './strategy-compiler/types';

/**
 * Strategy Compiler converts natural language strategies into structured JSON rules
 * using highly modular sub-parsers for individual deterministic indicators and concepts.
 * This runs solely during strategy creation/edit actions and never during live scans.
 */
export function compileStrategy(strategyText: string): CompilerOutput {
  if (!strategyText || typeof strategyText !== 'string' || strategyText.trim().length === 0) {
    return {
      strategy_mode: 'AI_ONLY',
      compiled_rules: {},
      confidence: 0.0
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
    support: srResult.parsedRule.support,
    resistance: srResult.parsedRule.resistance,
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
  // - If any explicit AI_ONLY words exist, it must be classified as AI_ONLY.
  // - Otherwise, if any subjective/discretionary words exist, it must be classified as HYBRID.
  // - Otherwise, it defaults to RULE_ONLY.
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

  // Internal logging for developers as requested
  console.log(`========== AI STATUS ==========`);
  console.log(`Strategy: [${strategyText.slice(0, 40)}${strategyText.length > 40 ? '...' : ''}]`);
  console.log(`Status: COMPILATION_SUCCESS`);
  console.log(`Mode: ${strategy_mode}`);
  console.log(`Confidence: ${confidence}`);
  console.log(`Matched Concepts: ${Object.entries(compiled_rules)
    .filter(([key, val]) => {
      if (typeof val === 'boolean') return val;
      if (Array.isArray(val)) return val.length > 0;
      if (typeof val === 'object' && val !== null) {
        if ('enabled' in val) return (val as any).enabled;
        if ('min_ratio' in val) return (val as any).min_ratio !== undefined;
        return true;
      }
      return false;
    })
    .map(([key]) => key)
    .join(', ') || 'None'}`);
  console.log(`===============================`);

  return {
    strategy_mode,
    compiled_rules,
    confidence
  };
}
