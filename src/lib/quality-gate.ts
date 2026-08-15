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
  consecutiveLosses?: number; // Optional consecutive losses from watcher history
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

export interface AdaptiveQualityInput {
  baseThreshold?: number; // default 75
  classification: string; // 'HEALTHY' | 'NEUTRAL' | 'DETERIORATING' | 'POOR' | 'INSUFFICIENT_DATA'
  tier: string; // 'INSUFFICIENT_DATA' | 'WEAK_SAMPLE' | 'ELIGIBLE' | 'STRONG_SAMPLE'
  expectancyR: number;
  recentExpectancyR: number;
  sampleSize: number;
}

export function calculateAdaptiveQualityRequirement(input: AdaptiveQualityInput): {
  minRequired: number;
  reason: string;
} {
  const base = input.baseThreshold ?? 75;
  const classification = (input.classification || 'INSUFFICIENT_DATA').toUpperCase();
  const tier = (input.tier || 'INSUFFICIENT_DATA').toUpperCase();
  const sampleSize = Number(input.sampleSize || 0);

  if (tier === 'INSUFFICIENT_DATA' || sampleSize < 10) {
    return {
      minRequired: base,
      reason: `Insufficient historical sample (${sampleSize} trades); using base threshold (${base}%).`
    };
  }

  let adjusted = base;
  let reason = `Historical performance neutral/healthy; using base threshold (${base}%).`;

  if (classification === 'HEALTHY' || classification === 'NEUTRAL') {
    adjusted = base;
    reason = `Historical performance ${classification.toLowerCase()} (${input.expectancyR}R); maintaining baseline threshold (${base}%).`;
  } else if (classification === 'DETERIORATING') {
    adjusted = Math.min(100, base + 5); // 80%
    reason = `Historical performance deteriorating (recent expectancy ${input.recentExpectancyR}R); elevated quality requirement (${adjusted}%).`;
  } else if (classification === 'POOR') {
    if (tier === 'STRONG_SAMPLE' && sampleSize >= 50) {
      adjusted = Math.min(100, base + 15); // 90%
    } else {
      adjusted = Math.min(100, base + 10); // 85%
    }
    reason = `Historical performance poor (${input.expectancyR}R, sample ${sampleSize}); strict quality requirement (${adjusted}%).`;
  }

  const finalThreshold = Math.max(base, Math.min(100, adjusted));
  return {
    minRequired: finalThreshold,
    reason
  };
}

/**
 * Evaluates high-confluence setup quality before risk validation and execution.
 */
export function evaluateQualityGate(input: QualityGateInput): QualityGateResult {
  const baseThreshold = input.minQualityThreshold ?? 75;
  const consecutiveLosses = input.consecutiveLosses ?? 0;

  // Calculate deterministic loss-streak safety overlay
  let lossStreakRequiredQuality = baseThreshold;
  if (consecutiveLosses === 2) {
    lossStreakRequiredQuality = Math.max(lossStreakRequiredQuality, 80);
  } else if (consecutiveLosses === 3) {
    lossStreakRequiredQuality = Math.max(lossStreakRequiredQuality, 85);
  } else if (consecutiveLosses >= 4) {
    lossStreakRequiredQuality = 101; // Reject all new trades (higher than max 100% score)
  }

  // Deterministically adjust minimum required score: max(existingRequiredQuality, lossStreakRequiredQuality)
  const minRequired = Math.max(baseThreshold, lossStreakRequiredQuality);
  const ruleScore = Math.max(0, Math.min(100, Math.round(input.ruleScore || 0)));

  const ms = input.marketStructure || {};
  const dirUpper = (input.direction || '').toUpperCase();
  const trendUpper = (ms.trend || '').toUpperCase();
  const isTrendAligned = (dirUpper === 'BUY' && ['BULLISH', 'UP', 'UPTREND'].includes(trendUpper)) ||
                         (dirUpper === 'SELL' && ['BEARISH', 'DOWN', 'DOWNTREND'].includes(trendUpper));
  const htfBias = Boolean(ms.htfBiasAligned || isTrendAligned);
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
  } else if (consecutiveLosses >= 4) {
    reason = 'Loss streak protection: 4 consecutive losses. New trades rejected.';
  } else if (computedQuality < minRequired) {
    if (consecutiveLosses > 0) {
      reason = `Insufficient confluence (Score ${computedQuality}% < required ${minRequired}% due to ${consecutiveLosses} consecutive losses)`;
    } else {
      reason = 'Insufficient confluence';
    }
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

/**
 * Calculates consecutive losses for a specific watcher from completed trades.
 */
export function calculateConsecutiveLossesForWatcher(trades: any[], watcherId?: string): number {
  if (!Array.isArray(trades)) return 0;

  // Filter trades for this specific watcher (if specified) and keep only terminal outcomes: WIN, LOSS, STOP_LOSS, BREAKEVEN
  const validTrades = trades.filter(t => {
    if (watcherId) {
      const tWatcherId = t.watcher_id || t.watcherId;
      if (tWatcherId !== watcherId) return false;
    }
    
    const outcome = (t.outcome || '').toUpperCase();
    return outcome === 'WIN' || outcome === 'LOSS' || outcome === 'STOP_LOSS' || outcome === 'BREAKEVEN';
  });

  // Sort descending by timestamp (newest first)
  const sortedTrades = [...validTrades].sort((a, b) => {
    const timeA = new Date(a.created_at || a.closed_at || a.opened_at || 0).getTime();
    const timeB = new Date(b.created_at || b.closed_at || b.opened_at || 0).getTime();
    return timeB - timeA;
  });

  let consecutiveLosses = 0;
  for (const t of sortedTrades) {
    const outcome = (t.outcome || '').toUpperCase();
    if (outcome === 'LOSS' || outcome === 'STOP_LOSS') {
      consecutiveLosses++;
    } else {
      break; // Streak breaks as soon as we hit a non-loss valid outcome (WIN or BREAKEVEN)
    }
  }

  return consecutiveLosses;
}
