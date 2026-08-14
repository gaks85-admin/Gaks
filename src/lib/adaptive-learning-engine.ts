import { supabase as defaultSupabase } from '../supabaseClient.js';

export type LearningTier = 'INSUFFICIENT_DATA' | 'WEAK_SAMPLE' | 'ELIGIBLE' | 'STRONG_SAMPLE';
export type PerformanceClassification = 'HEALTHY' | 'NEUTRAL' | 'DETERIORATING' | 'POOR' | 'INSUFFICIENT_DATA';
export type AdaptiveDecision = 'ALLOW' | 'WATCH' | 'RESTRICT' | 'REJECT';

export interface AdaptiveLearningInput {
  pair: string;
  timeframe: string;
  setup: string;
  direction: 'BUY' | 'SELL';
  marketRegime?: string;
  completedTrades: any[];
}

export interface AdaptiveLearningResult {
  decision: AdaptiveDecision;
  classification: PerformanceClassification;
  tier: LearningTier;
  sampleSize: number;
  expectancyR: number;
  recentExpectancyR: number;
  winRate: number;
  recentWinRate: number;
  fallbackLevelUsed: string;
  reason: string;
  explanation: string;
}

/**
 * Fetches completed trades for adaptive learning, ensuring strict user isolation.
 */
export async function fetchCompletedTradesForAdaptiveLearning(supabase: any, userId: string, preferredSource?: 'THEORETICAL' | 'PAPER' | 'LIVE'): Promise<any[]> {
  const client = supabase || defaultSupabase;
  if (!userId) return [];

  const source = preferredSource || process.env.EXECUTION_MODE || 'THEORETICAL';

  try {
    // 1. Primary: fetch from trade_learning table
    let query = client
      .from('trade_learning')
      .select('*')
      .eq('user_id', userId)
      .in('outcome', ['WIN', 'LOSS', 'BREAKEVEN']);

    // Stage 7 Requirement: Only broker-reconciled results for LIVE
    if (source === 'LIVE') {
      query = query.eq('execution_source', 'LIVE').eq('is_reconciled', true);
    } else if (source === 'PAPER') {
      query = query.eq('execution_source', 'PAPER');
    }

    const { data: learningData, error: learningErr } = await query
      .order('created_at', { ascending: true });

    if (!learningErr && Array.isArray(learningData) && learningData.length > 0) {
      return learningData;
    }

    // 2. Fallback: fetch from watcher_evaluations table
    const { data, error } = await client
      .from('watcher_evaluations')
      .select('*')
      .eq('user_id', userId)
      .in('outcome', ['WIN', 'LOSS', 'BREAKEVEN'])
      .order('created_at', { ascending: true });

    if (error || !data) {
      return [];
    }
    return data;
  } catch (err) {
    console.error('[Adaptive Learning] Error fetching completed trades:', err);
    return [];
  }
}

/**
 * Validates and normalizes completed trades, strictly excluding NO_TRADE, active, unresolved, etc.
 */
export function filterValidCompletedTrades(trades: any[]): any[] {
  if (!Array.isArray(trades)) return [];
  return trades.filter(t => {
    const outcome = (t.outcome || '').toUpperCase();
    return (outcome === 'WIN' || outcome === 'LOSS' || outcome === 'BREAKEVEN') &&
           t.user_id &&
           !t.is_active &&
           (t.trade_id || t.id);
  });
}

/**
 * Computes metrics (trades, wins, losses, winRate, expectancyR) for a subset of trades.
 */
export function computeMetricsForSubset(trades: any[]) {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      expectancyR: 0,
      totalR: 0
    };
  }

  let wins = 0;
  let losses = 0;
  let totalWinR = 0;
  let totalLossR = 0;
  let totalR = 0;

  for (const t of trades) {
    const outcome = (t.outcome || '').toUpperCase();
    let rVal = Number(t.rr_achieved);
    if (isNaN(rVal) || !Number.isFinite(rVal)) {
      rVal = outcome === 'WIN' ? 1.0 : (outcome === 'LOSS' ? -1.0 : 0);
    }

    totalR += rVal;
    if (outcome === 'WIN') {
      wins++;
      totalWinR += Math.max(0, rVal);
    } else if (outcome === 'LOSS') {
      losses++;
      totalLossR += Math.abs(Math.min(0, rVal) || 1.0);
    }
  }

  const winRate = Number(((wins / totalTrades) * 100).toFixed(1));
  const pWin = wins / totalTrades;
  const pLoss = losses / totalTrades;
  const avgWin = wins > 0 ? totalWinR / wins : 0;
  const avgLoss = losses > 0 ? totalLossR / losses : 1.0;
  const expectancyR = Number(((pWin * avgWin) - (pLoss * avgLoss)).toFixed(3));

  return {
    totalTrades,
    wins,
    losses,
    winRate: isNaN(winRate) ? 0 : winRate,
    expectancyR: isNaN(expectancyR) ? 0 : expectancyR,
    totalR: Number(totalR.toFixed(2))
  };
}

/**
 * Determines sample size tier.
 */
export function getSampleTier(count: number): LearningTier {
  if (count >= 50) return 'STRONG_SAMPLE';
  if (count >= 20) return 'ELIGIBLE';
  if (count >= 10) return 'WEAK_SAMPLE';
  return 'INSUFFICIENT_DATA';
}

/**
 * Classifies performance based on expectancy and recency.
 */
export function classifyPerformance(expectancy: number, recentExpectancy: number, count: number): PerformanceClassification {
  if (count < 10) return 'INSUFFICIENT_DATA';

  if (expectancy >= 0.20 && recentExpectancy >= 0.0) return 'HEALTHY';
  if (expectancy >= -0.05 && recentExpectancy >= -0.10) return 'NEUTRAL';
  if (recentExpectancy < expectancy - 0.15 || (expectancy < 0 && recentExpectancy < expectancy)) return 'DETERIORATING';
  if (expectancy <= -0.15 || recentExpectancy <= -0.25) return 'POOR';

  return 'NEUTRAL';
}

/**
 * Hierarchical Adaptive Learning evaluation engine.
 */
export function evaluateAdaptiveLearning(input: AdaptiveLearningInput): AdaptiveLearningResult {
  const { pair, timeframe, setup, direction, marketRegime, completedTrades } = input;
  const validTrades = filterValidCompletedTrades(completedTrades);

  const normPair = (pair || '').toUpperCase();
  const normTf = (timeframe || '').toUpperCase();
  const normSetup = (setup || 'HYBRID').toUpperCase();
  const normDir = (direction || 'BUY').toUpperCase();
  const normRegime = (marketRegime || 'UNKNOWN').toUpperCase();

  // Hierarchical Matchers
  // 1. pair + timeframe + setup + regime + direction
  let subset = validTrades.filter(t => 
    (t.pair || t.symbol || '').toUpperCase() === normPair &&
    (t.timeframe || t.selected_timeframe || '').toUpperCase() === normTf &&
    (t.strategy_mode || t.setup_name || 'HYBRID').toUpperCase() === normSetup &&
    ((t.market_regime || t.regime || 'UNKNOWN').toUpperCase() === normRegime) &&
    ((t.direction || t.signal || 'BUY').toUpperCase() === normDir)
  );
  let fallbackLevel = 'PAIR+TF+SETUP+REGIME+DIRECTION';

  // 2. pair + timeframe + setup + direction
  if (subset.length < 10) {
    const broader = validTrades.filter(t => 
      (t.pair || t.symbol || '').toUpperCase() === normPair &&
      (t.timeframe || t.selected_timeframe || '').toUpperCase() === normTf &&
      (t.strategy_mode || t.setup_name || 'HYBRID').toUpperCase() === normSetup &&
      ((t.direction || t.signal || 'BUY').toUpperCase() === normDir)
    );
    if (broader.length >= 10 || broader.length > subset.length) {
      subset = broader;
      fallbackLevel = 'PAIR+TF+SETUP+DIRECTION';
    }
  }

  // 3. pair + setup
  if (subset.length < 10) {
    const broader = validTrades.filter(t => 
      (t.pair || t.symbol || '').toUpperCase() === normPair &&
      (t.strategy_mode || t.setup_name || 'HYBRID').toUpperCase() === normSetup
    );
    if (broader.length >= 10 || broader.length > subset.length) {
      subset = broader;
      fallbackLevel = 'PAIR+SETUP';
    }
  }

  // 4. pair + timeframe
  if (subset.length < 10) {
    const broader = validTrades.filter(t => 
      (t.pair || t.symbol || '').toUpperCase() === normPair &&
      (t.timeframe || t.selected_timeframe || '').toUpperCase() === normTf
    );
    if (broader.length >= 10 || broader.length > subset.length) {
      subset = broader;
      fallbackLevel = 'PAIR+TIMEFRAME';
    }
  }

  // 5. pair
  if (subset.length < 10) {
    const broader = validTrades.filter(t => 
      (t.pair || t.symbol || '').toUpperCase() === normPair
    );
    if (broader.length >= 10 || broader.length > subset.length) {
      subset = broader;
      fallbackLevel = 'PAIR_ONLY';
    }
  }

  // 6. global user performance
  if (subset.length < 10 && validTrades.length >= 10) {
    subset = validTrades;
    fallbackLevel = 'GLOBAL_USER_PERFORMANCE';
  }

  const metrics = computeMetricsForSubset(subset);
  const sampleSize = metrics.totalTrades;
  const tier = getSampleTier(sampleSize);

  // Recency weighting: split subset into older vs last 10 trades
  const recentSlice = subset.slice(-10);
  const recentMetrics = computeMetricsForSubset(recentSlice);
  const recentExpectancyR = recentMetrics.expectancyR;

  const classification = classifyPerformance(metrics.expectancyR, recentExpectancyR, sampleSize);

  let decision: AdaptiveDecision = 'ALLOW';
  let reason = 'Sample insufficient or performance healthy';

  if (tier === 'INSUFFICIENT_DATA') {
    decision = 'ALLOW';
    reason = `Insufficient data (${sampleSize} trades). Operating in INSUFFICIENT_DATA mode.`;
  } else if (tier === 'WEAK_SAMPLE') {
    if (classification === 'POOR') {
      decision = 'WATCH';
      reason = `Weak sample (${sampleSize} trades) shows poor expectancy (${metrics.expectancyR}R). Warning issued.`;
    } else {
      decision = 'ALLOW';
      reason = `Weak sample (${sampleSize} trades). Informational warning only.`;
    }
  } else {
    // ELIGIBLE or STRONG_SAMPLE
    if (classification === 'POOR') {
      decision = 'REJECT';
      reason = `Persistent poor performance (${metrics.expectancyR}R expectancy, ${sampleSize} trades at level ${fallbackLevel}).`;
    } else if (classification === 'DETERIORATING') {
      decision = 'RESTRICT';
      reason = `Deteriorating performance detected (recent expectancy ${recentExpectancyR}R, overall ${metrics.expectancyR}R).`;
    } else if (classification === 'NEUTRAL') {
      decision = 'WATCH';
      reason = `Neutral performance (${metrics.expectancyR}R expectancy).`;
    } else {
      decision = 'ALLOW';
      reason = `Healthy performance (${metrics.expectancyR}R expectancy, win rate ${metrics.winRate}%).`;
    }
  }

  console.log(`[Adaptive Learning]
User: <isolated>
Pair: ${normPair}
Timeframe: ${normTf}
Setup: ${normSetup}
Direction: ${normDir}
Regime: ${normRegime}

Sample: ${sampleSize} (${tier})
Fallback Level: ${fallbackLevel}
Expectancy: ${metrics.expectancyR}R
Recent Expectancy: ${recentExpectancyR}R
Win Rate: ${metrics.winRate}%
Recent Win Rate: ${recentMetrics.winRate}%
Classification: ${classification}
Decision: ${decision}
Reason: ${reason}`);

  return {
    decision,
    classification,
    tier,
    sampleSize,
    expectancyR: metrics.expectancyR,
    recentExpectancyR,
    winRate: metrics.winRate,
    recentWinRate: recentMetrics.winRate,
    fallbackLevelUsed: fallbackLevel,
    reason,
    explanation: reason
  };
}
