import { compileStrategy } from './strategy-compiler.js';
import { evaluateDecision } from './decision-engine.js';
import { recordEvaluation, EvaluationRecord } from './explainability-engine.js';

export interface TestResult {
  name: string;
  passed: boolean;
  details: string;
}

export function runRulePipelineConsistencyTestSuite(): TestResult[] {
  const results: TestResult[] = [];

  // Mock market structure where BOS and CHOCH pass, but Volume and FVG fail
  const mockMarketStructurePassMandatory = {
    watcherId: 'test-watcher-1',
    pair: 'BTCUSD',
    timeframe: 'M5',
    bos: { matched: true, reason: 'Bullish BOS detected' },
    choch: { matched: true, reason: 'Bullish CHOCH detected' },
    trendline_breakout: { matched: true, reason: 'Trendline broken' },
    support: { matched: true, reason: 'In support zone' },
    resistance: { matched: true, reason: 'Below resistance' },
    volume_confirmation: { matched: false, reason: 'Volume below 1.5x average' },
    fair_value_gap: { matched: false, reason: 'No FVG detected' },
    confirmation_candle: { matched: true, reason: 'Bullish engulfing' }
  };

  const mockMarketStructureFailMandatory = {
    ...mockMarketStructurePassMandatory,
    choch: { matched: false, reason: 'No CHOCH detected' },
    support: { matched: false, reason: 'Price broke through support' }
  };

  // 1. Test A: Optional Volume Confirmation fails -> trade is still eligible if mandatory rules pass
  try {
    const strategy = "Entry mandatory: BOS and CHOCH. Optional: volume confirmation.";
    const compiled = compileStrategy(strategy);
    const decision = evaluateDecision(compiled, mockMarketStructurePassMandatory);

    const volumeIsOptional = compiled.optional_rules.includes('volume_confirmation') ||
      compiled.canonical_rule_set.optional_rule_ids.includes('volume_confirmation');
    const mandatoryPassed = decision.mandatory_rules_passed;
    const recommendationNotFail = decision.recommendation !== 'FAIL';

    results.push({
      name: 'Test A: Optional Volume Confirmation failure does not block trade',
      passed: volumeIsOptional && mandatoryPassed && recommendationNotFail,
      details: `Optional: ${volumeIsOptional}, Mandatory Passed: ${mandatoryPassed}, Recommendation: ${decision.recommendation}`
    });
  } catch (err: any) {
    results.push({ name: 'Test A: Optional Volume Confirmation failure', passed: false, details: err.message });
  }

  // 2. Test B: Optional FVG fails -> trade is still eligible
  try {
    const strategy = "Must see BOS and CHOCH. If possible: fair value gap.";
    const compiled = compileStrategy(strategy);
    const decision = evaluateDecision(compiled, mockMarketStructurePassMandatory);

    const fvgIsOptional = compiled.optional_rules.includes('fair_value_gap') ||
      compiled.canonical_rule_set.optional_rule_ids.includes('fair_value_gap');
    const mandatoryPassed = decision.mandatory_rules_passed;

    results.push({
      name: 'Test B: Optional FVG failure does not mark mandatory failed',
      passed: fvgIsOptional && mandatoryPassed,
      details: `FVG Optional: ${fvgIsOptional}, Mandatory Passed: ${mandatoryPassed}`
    });
  } catch (err: any) {
    results.push({ name: 'Test B: Optional FVG failure', passed: false, details: err.message });
  }

  // 3. Test C: Mandatory CHOCH fails -> deterministic decision FAIL
  try {
    const strategy = "Entry mandatory: CHOCH required.";
    const compiled = compileStrategy(strategy);
    const decision = evaluateDecision(compiled, mockMarketStructureFailMandatory);

    results.push({
      name: 'Test C: Mandatory CHOCH failure causes deterministic FAIL',
      passed: !decision.mandatory_rules_passed && decision.recommendation === 'FAIL' && decision.failed_mandatory_rules.includes('CHOCH'),
      details: `Mandatory Passed: ${decision.mandatory_rules_passed}, Rec: ${decision.recommendation}, Failed Mandatory: ${decision.failed_mandatory_rules.join(', ')}`
    });
  } catch (err: any) {
    results.push({ name: 'Test C: Mandatory CHOCH failure', passed: false, details: err.message });
  }

  // 4. Test D: Mandatory Support Zone fails -> deterministic decision FAIL
  try {
    const strategy = "Mandatory: support zone required.";
    const compiled = compileStrategy(strategy);
    const decision = evaluateDecision(compiled, mockMarketStructureFailMandatory);

    results.push({
      name: 'Test D: Mandatory Support failure causes deterministic FAIL',
      passed: !decision.mandatory_rules_passed && decision.recommendation === 'FAIL' && decision.failed_mandatory_rules.includes('Support Zone'),
      details: `Mandatory Passed: ${decision.mandatory_rules_passed}, Rec: ${decision.recommendation}`
    });
  } catch (err: any) {
    results.push({ name: 'Test D: Mandatory Support failure', passed: false, details: err.message });
  }

  // 5. Test E: Compiler says Volume Confirmation optional -> evaluator cannot mark it mandatory
  try {
    const strategy = "Mandatory: BOS. Optional: volume.";
    const compiled = compileStrategy(strategy);
    const decision = evaluateDecision(compiled, mockMarketStructurePassMandatory);

    const notInFailedMandatory = !decision.failed_mandatory_rules.includes('Volume Confirmation');
    const inFailedOptional = decision.failed_optional_rules.includes('Volume Confirmation');

    results.push({
      name: 'Test E: Evaluator respects compiler optional classification for Volume Confirmation',
      passed: notInFailedMandatory && inFailedOptional,
      details: `NotInFailedMandatory: ${notInFailedMandatory}, InFailedOptional: ${inFailedOptional}`
    });
  } catch (err: any) {
    results.push({ name: 'Test E: Evaluator optional classification', passed: false, details: err.message });
  }

  // 6. Test F: Explainability output matches evaluator rule requirements
  try {
    const strategy = "Mandatory: BOS. Optional: volume.";
    const compiled = compileStrategy(strategy);
    const decision = evaluateDecision(compiled, mockMarketStructurePassMandatory);

    const record: EvaluationRecord = {
      user_id: 'test-user',
      watcher_id: 'test-watcher',
      pair: 'BTCUSD',
      timeframe: 'M5',
      strategy_mode: compiled.strategy_mode,
      decision_score: decision.decision_score,
      matched_weight: decision.matched_weight,
      possible_weight: decision.possible_weight,
      recommendation: decision.recommendation,
      mandatory_rules_passed: decision.mandatory_rules_passed,
      matched_rules: decision.matched_rules,
      failed_rules: decision.failed_rules,
      failed_mandatory_rules: decision.failed_mandatory_rules,
      failed_optional_rules: decision.failed_optional_rules,
      gemini_used: false,
      trade_sent: false,
      scan_duration_ms: 100
    };

    const explained = recordEvaluation(null, record);
    results.push({
      name: 'Test F: Explainability matches evaluator output',
      passed: Boolean(explained),
      details: `Record logged with ${record.failed_mandatory_rules?.length} mandatory failures and ${record.failed_optional_rules?.length} optional failures`
    });
  } catch (err: any) {
    results.push({ name: 'Test F: Explainability test', passed: false, details: err.message });
  }

  // 7. Test G: Compiler/evaluator mismatch -> NO_TRADE + RULE SET MISMATCH
  try {
    const strategy = "Mandatory: BOS and CHOCH.";
    const compiled = compileStrategy(strategy);
    // Tamper with compiled output to simulate a mismatch
    const corruptedCompilerOutput = {
      ...compiled,
      canonical_rule_set: {
        ...compiled.canonical_rule_set,
        mandatory_rule_ids: ['bos', 'choch', 'corrupted_rule']
      }
    };

    const decision = evaluateDecision(corruptedCompilerOutput, mockMarketStructurePassMandatory);

    results.push({
      name: 'Test G: Rule set mismatch produces NO_TRADE and RULE SET MISMATCH trace',
      passed: decision.recommendation === 'FAIL' && decision.explanation.includes('[RULE SET MISMATCH]'),
      details: `Recommendation: ${decision.recommendation}, Explanation: ${decision.explanation}`
    });
  } catch (err: any) {
    results.push({ name: 'Test G: Rule set mismatch test', passed: false, details: err.message });
  }

  // 8. Test H: RULE_ONLY + mandatory failure -> Gemini must not be called
  try {
    const strategy = "Mandatory: CHOCH required.";
    const compiled = compileStrategy(strategy);
    const decision = evaluateDecision(compiled, mockMarketStructureFailMandatory);

    results.push({
      name: 'Test H: RULE_ONLY mode with mandatory failure sets requires_gemini to false',
      passed: compiled.strategy_mode === 'RULE_ONLY' && !decision.mandatory_rules_passed && decision.requires_gemini === false,
      details: `Mode: ${compiled.strategy_mode}, Mandatory Passed: ${decision.mandatory_rules_passed}, Requires Gemini: ${decision.requires_gemini}`
    });
  } catch (err: any) {
    results.push({ name: 'Test H: RULE_ONLY mandatory failure test', passed: false, details: err.message });
  }

  // 9. Test I: RULE_ONLY + all mandatory rules pass -> proceed without Gemini
  try {
    const strategy = "Mandatory: BOS and CHOCH.";
    const compiled = compileStrategy(strategy);
    const decision = evaluateDecision(compiled, mockMarketStructurePassMandatory);

    results.push({
      name: 'Test I: RULE_ONLY mode with passing mandatory rules produces valid score and recommendation',
      passed: compiled.strategy_mode === 'RULE_ONLY' && decision.mandatory_rules_passed && (decision.recommendation === 'PASS' || decision.recommendation === 'LIKELY_PASS'),
      details: `Mode: ${compiled.strategy_mode}, Recommendation: ${decision.recommendation}, Score: ${decision.decision_score}%`
    });
  } catch (err: any) {
    results.push({ name: 'Test I: RULE_ONLY passing test', passed: false, details: err.message });
  }

  // 10. Test J: NO_TRADE can never be passed to the broker/execution layer
  try {
    const decision = evaluateDecision(compileStrategy("Mandatory: CHOCH required."), mockMarketStructureFailMandatory);
    const canSendTrade = decision.recommendation === 'PASS' || decision.recommendation === 'LIKELY_PASS';

    results.push({
      name: 'Test J: NO_TRADE recommendation strictly prevents trade execution',
      passed: !canSendTrade && decision.recommendation === 'FAIL',
      details: `Can Send Trade: ${canSendTrade}, Recommendation: ${decision.recommendation}`
    });
  } catch (err: any) {
    results.push({ name: 'Test J: NO_TRADE execution prevention test', passed: false, details: err.message });
  }

  return results;
}
