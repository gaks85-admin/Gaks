export interface RiskGovernorInput {
  metrics: {
    totalTrades: number;
    winRate: number;
    expectancyR: number;
    consecutiveLosses: number;
    consecutiveWins: number;
    totalRealizedR: number;
    performanceByPair: Record<string, { trades: number; expectancyR: number; winRate: number }>;
    performanceBySetup: Record<string, { trades: number; expectancyR: number; winRate: number }>;
    sampleSizeTier: 'INSUFFICIENT' | 'WEAK' | 'ELIGIBLE';
  };
  equityState: {
    configuredCapital: number;
    estimatedEquity: number;
    estimatedDrawdownPercent: number;
  };
  candidate: {
    pair: string;
    timeframe: string;
    strategySetup?: string;
    qualityScore?: number;
    confidence?: number;
    expectedRr?: number;
  };
}

export type GovernorStatus = 'NORMAL' | 'RESTRICTED_SELECTIVITY' | 'NO_TRADE';

export interface RiskGovernorResult {
  status: GovernorStatus;
  reasonCodes: string[];
  explanation: string;
  metricsUsed: {
    totalTrades: number;
    expectancyR: number;
    consecutiveLosses: number;
    drawdownPercent: number;
    sampleSizeTier: string;
  };
  sampleSizeSufficient: boolean;
}

// Configurable Constants & Thresholds
export const GOVERNOR_THRESHOLDS = {
  MIN_TRADES_ELIGIBLE: 20,
  MIN_TRADES_WEAK: 10,
  NEGATIVE_EXPECTANCY_RESTRICT: -0.05,
  NEGATIVE_EXPECTANCY_NO_TRADE: -0.20,
  CONSECUTIVE_LOSSES_RESTRICT: 3,
  CONSECUTIVE_LOSSES_NO_TRADE: 5,
  DRAWDOWN_RESTRICT_PERCENT: 10.0,
  DRAWDOWN_NO_TRADE_PERCENT: 25.0,
  PAIR_NEGATIVE_EXPECTANCY_THRESHOLD: -0.10,
  SETUP_NEGATIVE_EXPECTANCY_THRESHOLD: -0.10
};

/**
 * PURE, TESTABLE RISK GOVERNOR FUNCTION.
 * Does NOT call Supabase directly. Evaluates historical performance and equity state
 * to govern candidate trade selectivity.
 */
export function evaluateRiskGovernor(input: RiskGovernorInput): RiskGovernorResult {
  const { metrics, equityState, candidate } = input;
  const reasonCodes: string[] = [];
  let status: GovernorStatus = 'NORMAL';

  const totalTrades = metrics.totalTrades || 0;
  const sampleSizeSufficient = totalTrades >= GOVERNOR_THRESHOLDS.MIN_TRADES_ELIGIBLE;
  const hasWeakSample = totalTrades >= GOVERNOR_THRESHOLDS.MIN_TRADES_WEAK;

  // Rule A — Insufficient data
  if (!hasWeakSample) {
    return {
      status: 'NORMAL',
      reasonCodes: ['INSUFFICIENT_HISTORY_NORMAL'],
      explanation: `Insufficient completed trades (${totalTrades}) for governor restriction. Operating in NORMAL mode.`,
      metricsUsed: {
        totalTrades,
        expectancyR: metrics.expectancyR,
        consecutiveLosses: metrics.consecutiveLosses,
        drawdownPercent: equityState.estimatedDrawdownPercent,
        sampleSizeTier: metrics.sampleSizeTier
      },
      sampleSizeSufficient: false
    };
  }

  // Rule C — Consecutive losses
  if (metrics.consecutiveLosses >= GOVERNOR_THRESHOLDS.CONSECUTIVE_LOSSES_NO_TRADE) {
    status = 'NO_TRADE';
    reasonCodes.push('SEVERE_CONSECUTIVE_LOSSES');
  } else if (metrics.consecutiveLosses >= GOVERNOR_THRESHOLDS.CONSECUTIVE_LOSSES_RESTRICT) {
    if (status === 'NORMAL') status = 'RESTRICTED_SELECTIVITY';
    reasonCodes.push('ELEVATED_CONSECUTIVE_LOSSES');
  }

  // Rule D — Drawdown
  if (equityState.estimatedDrawdownPercent >= GOVERNOR_THRESHOLDS.DRAWDOWN_NO_TRADE_PERCENT) {
    status = 'NO_TRADE';
    reasonCodes.push('SEVERE_DRAWDOWN');
  } else if (equityState.estimatedDrawdownPercent >= GOVERNOR_THRESHOLDS.DRAWDOWN_RESTRICT_PERCENT) {
    if (status === 'NORMAL') status = 'RESTRICTED_SELECTIVITY';
    reasonCodes.push('ELEVATED_DRAWDOWN');
  }

  // Rule B — Negative expectancy (requires sample size >= 20)
  if (sampleSizeSufficient) {
    if (metrics.expectancyR <= GOVERNOR_THRESHOLDS.NEGATIVE_EXPECTANCY_NO_TRADE) {
      status = 'NO_TRADE';
      reasonCodes.push('SEVERE_NEGATIVE_EXPECTANCY');
    } else if (metrics.expectancyR <= GOVERNOR_THRESHOLDS.NEGATIVE_EXPECTANCY_RESTRICT) {
      if (status === 'NORMAL') status = 'RESTRICTED_SELECTIVITY';
      reasonCodes.push('NEGATIVE_EXPECTANCY');
    }
  }

  // Rule E — Pair-specific deterioration
  const pairKey = (candidate.pair || '').toUpperCase();
  if (pairKey && metrics.performanceByPair && metrics.performanceByPair[pairKey]) {
    const pairData = metrics.performanceByPair[pairKey];
    if (pairData.trades >= 5 && pairData.expectancyR <= GOVERNOR_THRESHOLDS.PAIR_NEGATIVE_EXPECTANCY_THRESHOLD) {
      if (status === 'NORMAL') status = 'RESTRICTED_SELECTIVITY';
      reasonCodes.push('PAIR_NEGATIVE_EXPECTANCY');
    }
  }

  // Rule F — Setup-specific deterioration
  const setupKey = (candidate.strategySetup || 'HYBRID').toUpperCase();
  if (setupKey && metrics.performanceBySetup && metrics.performanceBySetup[setupKey]) {
    const setupData = metrics.performanceBySetup[setupKey];
    if (setupData.trades >= 5 && setupData.expectancyR <= GOVERNOR_THRESHOLDS.SETUP_NEGATIVE_EXPECTANCY_THRESHOLD) {
      if (status === 'NORMAL') status = 'RESTRICTED_SELECTIVITY';
      reasonCodes.push('SETUP_NEGATIVE_EXPECTANCY');
    }
  }

  if (reasonCodes.length === 0) {
    reasonCodes.push('METRICS_HEALTHY');
  }

  const explanation = status === 'NORMAL'
    ? `Risk Governor evaluated ${totalTrades} trades: performance is healthy.`
    : `Risk Governor status is ${status} due to: ${reasonCodes.join(', ')}.`;

  // Structured Diagnostic Logging
  console.log(`[Equity Learning]
[Historical Performance]
Total Trades: ${totalTrades}
Win Rate: ${metrics.winRate}%
Expectancy: ${metrics.expectancyR}R
Consecutive Losses: ${metrics.consecutiveLosses}
Status: ${metrics.expectancyR < 0 ? 'NEGATIVE_EXPECTANCY' : 'HEALTHY'}

[Equity State]
Configured Capital: $${equityState.configuredCapital}
Estimated Equity: $${equityState.estimatedEquity}
Estimated Drawdown: ${equityState.estimatedDrawdownPercent}%
Status: ${equityState.estimatedDrawdownPercent > 10 ? 'ELEVATED_DRAWDOWN' : 'NORMAL'}

[Risk Governor]
Status: ${status}
Reason: ${reasonCodes.join(', ')}
Sample Size: ${totalTrades} (${metrics.sampleSizeTier})`);

  return {
    status,
    reasonCodes,
    explanation,
    metricsUsed: {
      totalTrades,
      expectancyR: metrics.expectancyR,
      consecutiveLosses: metrics.consecutiveLosses,
      drawdownPercent: equityState.estimatedDrawdownPercent,
      sampleSizeTier: metrics.sampleSizeTier
    },
    sampleSizeSufficient
  };
}
