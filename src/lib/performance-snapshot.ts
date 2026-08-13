import { supabase as defaultSupabase } from '../supabaseClient.js';
import { fetchUserCompletedTrades, computeEquityAnalytics, deriveEquityState } from './equity-learning-engine.js';
import { filterValidCompletedTrades, computeMetricsForSubset } from './adaptive-learning-engine.js';
import { evaluateRiskGovernor, GovernorStatus } from './risk-governor.js';

export type EvidenceTier = 'INSUFFICIENT' | 'WEAK' | 'MODERATE' | 'STRONG';
export type PerformanceState = 'HEALTHY' | 'NEUTRAL' | 'DETERIORATING' | 'POOR' | 'INSUFFICIENT_DATA';

export interface PerformanceBreakdownItem {
  key: string;
  sampleSize: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  expectancyR: number;
  realizedR: number;
  evidenceTier: EvidenceTier;
  performanceState: PerformanceState;
}

export interface ExecutionTimingMetrics {
  goodTiming: { count: number; wins: number; losses: number; winRate: number; expectancyR: number };
  fairTiming: { count: number; wins: number; losses: number; winRate: number; expectancyR: number };
  poorTiming: { count: number; wins: number; losses: number; winRate: number; expectancyR: number };
  insufficientDataTiming: { count: number; wins: number; losses: number; winRate: number; expectancyR: number };
  waitCount: number;
  executeCount: number;
  noTradeCount: number;
  chasingRejectionCount: number;
}

export interface RiskGovernorVisibility {
  status: GovernorStatus;
  sampleSizeUsed: number;
  expectancyR: number;
  consecutiveLosses: number;
  drawdownPercent: number;
  pairDeterioration: Record<string, boolean>;
  setupDeterioration: Record<string, boolean>;
  evidenceTier: EvidenceTier;
  triggeringConditions: string[];
}

export interface PerformanceSnapshotOptions {
  supabase?: any;
  completedTrades?: any[];
  allEvaluations?: any[];
  configuredCapital?: number;
  currentGovernorState?: GovernorStatus;
}

export interface PerformanceSnapshot {
  userId: string;
  generatedAt: string;
  totalCompletedTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number;
  totalRealizedR: number;
  expectancyR: number;
  averageWinR: number;
  averageLossR: number;
  consecutiveWins: number;
  consecutiveLosses: number;
  estimatedEquity: number;
  configuredCapital: number;
  estimatedDrawdownPercent: number;
  currentGovernorState: GovernorStatus;
  evidenceTier: EvidenceTier;
  
  // Dynamic Breakdowns
  breakdownByPair: Record<string, PerformanceBreakdownItem>;
  breakdownByTimeframe: Record<string, PerformanceBreakdownItem>;
  breakdownBySetup: Record<string, PerformanceBreakdownItem>;
  breakdownByDirection: Record<string, PerformanceBreakdownItem>;
  breakdownByRegime: Record<string, PerformanceBreakdownItem>;
  breakdownByExecutionTiming: Record<string, PerformanceBreakdownItem>;
  
  executionMetrics: ExecutionTimingMetrics;
  riskGovernorVisibility: RiskGovernorVisibility;
}

/**
 * Calculates Evidence Tier from sample size.
 */
export function getEvidenceTier(sampleSize: number): EvidenceTier {
  if (sampleSize >= 30) return 'STRONG';
  if (sampleSize >= 20) return 'MODERATE';
  if (sampleSize >= 10) return 'WEAK';
  return 'INSUFFICIENT';
}

/**
 * Calculates Performance State from metrics and sample size.
 */
export function getPerformanceState(sampleSize: number, expectancyR: number, winRate: number): PerformanceState {
  if (sampleSize < 10) return 'INSUFFICIENT_DATA';
  if (expectancyR >= 0.20 && winRate >= 50) return 'HEALTHY';
  if (expectancyR < -0.15 || winRate < 35) return 'POOR';
  if (expectancyR < 0) return 'DETERIORATING';
  return 'NEUTRAL';
}

/**
 * Aggregates only valid completed trades into a central performance snapshot.
 * Read-only function strictly scoped to userId.
 */
export async function getUserPerformanceSnapshot(
  userId: string,
  options?: PerformanceSnapshotOptions
): Promise<PerformanceSnapshot> {
  const generatedAt = new Date().toISOString();
  const supabase = options?.supabase || defaultSupabase;

  console.log(`[PERFORMANCE SNAPSHOT] Generating snapshot for user: ${userId}`);

  // Fetch or filter completed trades
  let rawTrades: any[] = options?.completedTrades || [];
  if (!options?.completedTrades && userId) {
    try {
      rawTrades = await fetchUserCompletedTrades(supabase, userId);
    } catch (err) {
      console.error('[PERFORMANCE SNAPSHOT] Error fetching trades:', err);
    }
  }

  // Filter valid completed trades strictly scoped to userId
  const completedTrades = filterValidCompletedTrades(rawTrades).filter(t => t.user_id === userId);

  // Derive equity metrics and state
  const cap = options?.configuredCapital || 1000;
  const equityMetrics = computeEquityAnalytics(completedTrades);
  const equityState = deriveEquityState(cap, equityMetrics);

  const totalCompletedTrades = equityMetrics.totalTrades;
  const wins = equityMetrics.wins;
  const losses = equityMetrics.losses;
  const breakevens = completedTrades.filter(t => (t.outcome || '').toUpperCase() === 'BREAKEVEN').length;
  const globalEvidenceTier = getEvidenceTier(totalCompletedTrades);

  // Grouping helper for breakdowns
  function buildBreakdown(groupFn: (t: any) => string): Record<string, PerformanceBreakdownItem> {
    const groups: Record<string, any[]> = {};
    for (const t of completedTrades) {
      const key = groupFn(t);
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }

    const breakdown: Record<string, PerformanceBreakdownItem> = {};
    for (const [key, trades] of Object.entries(groups)) {
      const metrics = computeMetricsForSubset(trades);
      const sampleSize = metrics.totalTrades;
      const w = metrics.wins;
      const l = metrics.losses;
      const be = trades.filter(t => (t.outcome || '').toUpperCase() === 'BREAKEVEN').length;
      const wr = metrics.winRate;
      const expR = metrics.expectancyR;
      const realR = metrics.totalR;
      const tier = getEvidenceTier(sampleSize);
      const state = getPerformanceState(sampleSize, expR, wr);

      breakdown[key] = {
        key,
        sampleSize,
        wins: w,
        losses: l,
        breakevens: be,
        winRate: wr,
        expectancyR: expR,
        realizedR: realR,
        evidenceTier: tier,
        performanceState: state
      };
    }
    return breakdown;
  }

  // Dynamic breakdowns
  const breakdownByPair = buildBreakdown(t => (t.pair || t.symbol || 'UNKNOWN').toUpperCase());
  const breakdownByTimeframe = buildBreakdown(t => (t.timeframe || t.selected_timeframe || 'M5').toUpperCase());
  const breakdownBySetup = buildBreakdown(t => (t.strategy_mode || t.setup_name || t.setup || 'HYBRID').toUpperCase());
  const breakdownByDirection = buildBreakdown(t => (t.direction || t.signal || 'BUY').toUpperCase());
  const breakdownByRegime = buildBreakdown(t => (t.market_regime || t.regime || 'UNKNOWN').toUpperCase());

  // Execution timing breakdown
  const breakdownByExecutionTiming = buildBreakdown(t => {
    const score = Number(t.execution_score);
    if (!isNaN(score) && score > 0) {
      if (score >= 80) return 'GOOD';
      if (score >= 60) return 'FAIR';
      return 'POOR';
    }
    return 'INSUFFICIENT';
  });

  // Calculate Execution Timing Metrics
  const goodTrades = completedTrades.filter(t => (t.execution_score && Number(t.execution_score) >= 80));
  const fairTrades = completedTrades.filter(t => (t.execution_score && Number(t.execution_score) >= 60 && Number(t.execution_score) < 80));
  const poorTrades = completedTrades.filter(t => (t.execution_score && Number(t.execution_score) < 60));
  const insufficientTrades = completedTrades.filter(t => (!t.execution_score || isNaN(Number(t.execution_score))));

  function timingGroupStats(trades: any[]) {
    const m = computeMetricsForSubset(trades);
    return {
      count: trades.length,
      wins: m.wins,
      losses: m.losses,
      winRate: m.winRate,
      expectancyR: m.expectancyR
    };
  }

  // Count candidate rejections/WAITs from allEvaluations if provided
  let waitCount = 0;
  let executeCount = totalCompletedTrades;
  let noTradeCount = 0;
  let chasingRejectionCount = 0;

  if (options?.allEvaluations) {
    const userEvals = options.allEvaluations.filter(e => e.user_id === userId);
    waitCount = userEvals.filter(e => (e.final_decision || e.recommendation || '').toUpperCase() === 'WAIT').length;
    noTradeCount = userEvals.filter(e => (e.final_decision || e.recommendation || '').toUpperCase() === 'NO_TRADE').length;
    chasingRejectionCount = userEvals.filter(e => e.reason_code === 'ENTRY_CHASING_REJECTED' || (e.reasoning && String(e.reasoning).includes('chasing'))).length;
  }

  const executionMetrics: ExecutionTimingMetrics = {
    goodTiming: timingGroupStats(goodTrades),
    fairTiming: timingGroupStats(fairTrades),
    poorTiming: timingGroupStats(poorTrades),
    insufficientDataTiming: timingGroupStats(insufficientTrades),
    waitCount,
    executeCount,
    noTradeCount,
    chasingRejectionCount
  };

  // Evaluate Risk Governor Visibility
  const governorEval = evaluateRiskGovernor({
    metrics: {
      totalTrades: totalCompletedTrades,
      winRate: equityMetrics.winRate,
      expectancyR: equityMetrics.expectancyR,
      consecutiveLosses: equityMetrics.consecutiveLosses,
      consecutiveWins: equityMetrics.consecutiveWins,
      totalRealizedR: equityMetrics.totalRealizedR,
      performanceByPair: equityMetrics.performanceByPair,
      performanceBySetup: equityMetrics.performanceBySetup,
      sampleSizeTier: equityMetrics.sampleSizeTier
    },
    equityState: {
      configuredCapital: cap,
      estimatedEquity: equityState.estimatedEquity,
      estimatedDrawdownPercent: equityState.estimatedDrawdownPercent
    },
    candidate: {
      pair: 'EURUSD',
      timeframe: 'M5'
    }
  });

  const pairDeterioration: Record<string, boolean> = {};
  for (const [p, stats] of Object.entries(equityMetrics.performanceByPair)) {
    pairDeterioration[p] = stats.expectancyR < -0.10;
  }

  const setupDeterioration: Record<string, boolean> = {};
  for (const [su, stats] of Object.entries(equityMetrics.performanceBySetup)) {
    setupDeterioration[su] = stats.expectancyR < -0.10;
  }

  const riskGovernorVisibility: RiskGovernorVisibility = {
    status: governorEval.status,
    sampleSizeUsed: totalCompletedTrades,
    expectancyR: equityMetrics.expectancyR,
    consecutiveLosses: equityMetrics.consecutiveLosses,
    drawdownPercent: equityState.estimatedDrawdownPercent,
    pairDeterioration,
    setupDeterioration,
    evidenceTier: globalEvidenceTier,
    triggeringConditions: governorEval.reasonCodes
  };

  console.log(`[RISK GOVERNOR STATUS] User: ${userId}, Status: ${governorEval.status}, Trades: ${totalCompletedTrades}, Expectancy: ${equityMetrics.expectancyR}R`);

  return {
    userId,
    generatedAt,
    totalCompletedTrades,
    wins,
    losses,
    breakevens,
    winRate: equityMetrics.winRate,
    totalRealizedR: equityMetrics.totalRealizedR,
    expectancyR: equityMetrics.expectancyR,
    averageWinR: equityMetrics.avgWinningR,
    averageLossR: equityMetrics.avgLosingR,
    consecutiveWins: equityMetrics.consecutiveWins,
    consecutiveLosses: equityMetrics.consecutiveLosses,
    estimatedEquity: equityState.estimatedEquity,
    configuredCapital: cap,
    estimatedDrawdownPercent: equityState.estimatedDrawdownPercent,
    currentGovernorState: options?.currentGovernorState || governorEval.status,
    evidenceTier: globalEvidenceTier,
    breakdownByPair,
    breakdownByTimeframe,
    breakdownBySetup,
    breakdownByDirection,
    breakdownByRegime,
    breakdownByExecutionTiming,
    executionMetrics,
    riskGovernorVisibility
  };
}
