// src/lib/quality-gate.ts

export interface QualityGateInput {
  ruleScore: number; // 0-100 from decision engine
  marketStructure: any; // extracted market structure
  mandatoryRulesPassed: boolean;
  geminiApproved?: boolean;
  geminiRequired?: boolean;
  direction: 'BUY' | 'SELL' | 'NO_TRADE';
  slValid: boolean;
  tpValid: boolean;
  rrValid: boolean;
  historicalProbability?: number; // 0-100 if available
  minQualityThreshold?: number; // Default 75
}

export interface QualityGateResult {
  passed: boolean;
  qualityScore: number;
  ruleScore: number;
  minRequired: number;
  action: 'CONTINUE_TO_RISK' | 'NO_TRADE';
  reason: string;
  confluenceFactors: {
    ruleScoreContrib: number;
    htfBias: boolean;
    bosOrChoch: boolean;
    fvgOrLiquidity: boolean;
    srLevel: boolean;
    sessionQuality: boolean;
    volumeConfirmed: boolean;
    geminiBonus: number;
    probBonus: number;
  };
}

/**
 * Evaluates high-confluence setup quality before risk validation and execution.
 */
export function evaluateQualityGate(input: QualityGateInput): QualityGateResult {
  const minRequired = input.minQualityThreshold ?? 75;
  const ruleScore = Math.max(0, Math.min(100, Math.round(input.ruleScore || 0)));

  const ms = input.marketStructure || {};
  const htfBias = Boolean(ms.htfBiasAligned || (ms.trend && ms.trend !== 'Neutral'));
  const bosOrChoch = Boolean(ms.bos || ms.choch || ms.structureShift);
  const fvgOrLiquidity = Boolean(
    (ms.fairValueGaps && ms.fairValueGaps.length > 0) ||
    (ms.liquiditySweeps && ms.liquiditySweeps.length > 0) ||
    ms.liquidity_sweep
  );
  const srLevel = Boolean(
    (ms.supportZones && ms.supportZones.length > 0) ||
    (ms.resistanceZones && ms.resistanceZones.length > 0) ||
    (ms.swingHighs && ms.swingHighs.length > 0) ||
    (ms.swingLows && ms.swingLows.length > 0)
  );
  const sessionQuality = Boolean(ms.activeSession || ms.sessionQuality);
  const volumeConfirmed = Boolean(ms.volumeInformation?.volumeSpike || ms.volumeConfirmed);

  let confluenceBonus = 0;
  if (htfBias) confluenceBonus += 3;
  if (bosOrChoch) confluenceBonus += 4;
  if (fvgOrLiquidity) confluenceBonus += 4;
  if (srLevel) confluenceBonus += 3;
  if (sessionQuality) confluenceBonus += 3;
  if (volumeConfirmed) confluenceBonus += 3;

  const geminiBonus = input.geminiApproved ? 5 : 0;
  const probBonus = (input.historicalProbability && input.historicalProbability >= 60) ? 5 : 0;

  let computedQuality = Math.round(ruleScore + confluenceBonus + geminiBonus + probBonus);
  computedQuality = Math.max(0, Math.min(100, computedQuality));

  // Gate conditions
  const isValidDirection = input.direction === 'BUY' || input.direction === 'SELL';
  const satisfiesGates =
    input.mandatoryRulesPassed &&
    isValidDirection &&
    input.slValid &&
    input.tpValid &&
    input.rrValid &&
    (input.geminiRequired ? input.geminiApproved === true : true);

  if (!satisfiesGates) {
    computedQuality = Math.min(computedQuality, ruleScore);
  }

  const passed = satisfiesGates && computedQuality >= minRequired;
  const action: 'CONTINUE_TO_RISK' | 'NO_TRADE' = passed ? 'CONTINUE_TO_RISK' : 'NO_TRADE';

  let reason = 'Sufficient confluence';
  if (!input.mandatoryRulesPassed) {
    reason = 'Mandatory rules failed';
  } else if (!isValidDirection) {
    reason = 'Invalid trade direction';
  } else if (!input.slValid) {
    reason = 'Invalid stop-loss structure';
  } else if (!input.tpValid) {
    reason = 'Invalid take-profit structure';
  } else if (!input.rrValid) {
    reason = 'Minimum R:R not satisfied';
  } else if (input.geminiRequired && !input.geminiApproved) {
    reason = 'Gemini approval missing or rejected';
  } else if (computedQuality < minRequired) {
    reason = 'Insufficient confluence';
  }

  const result: QualityGateResult = {
    passed,
    qualityScore: computedQuality,
    ruleScore,
    minRequired,
    action,
    reason,
    confluenceFactors: {
      ruleScoreContrib: ruleScore,
      htfBias,
      bosOrChoch,
      fvgOrLiquidity,
      srLevel,
      sessionQuality,
      volumeConfirmed,
      geminiBonus,
      probBonus
    }
  };

  // Structured Log Output
  console.log(`
[Signal Quality]
Rule Score: ${ruleScore}%
Quality Score: ${computedQuality}%
Minimum Required: ${minRequired}%
Quality Gate: ${passed ? 'PASSED' : 'FAILED'}
Action: ${action}
Reason: ${reason}
`.trim());

  return result;
}
