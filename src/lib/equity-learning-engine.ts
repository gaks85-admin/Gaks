import { supabase as defaultSupabase } from '../supabaseClient.js';

export interface EquityMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number; // 0 to 100
  avgWinningR: number;
  avgLosingR: number;
  expectancyR: number;
  consecutiveLosses: number;
  consecutiveWins: number;
  totalRealizedR: number;
  performanceByPair: Record<string, { trades: number; wins: number; losses: number; winRate: number; expectancyR: number; totalR: number }>;
  performanceByTimeframe: Record<string, { trades: number; wins: number; losses: number; winRate: number; expectancyR: number; totalR: number }>;
  performanceBySetup: Record<string, { trades: number; wins: number; losses: number; winRate: number; expectancyR: number; totalR: number }>;
  sampleSizeTier: 'INSUFFICIENT' | 'WEAK' | 'ELIGIBLE';
}

export interface EquityState {
  configuredCapital: number;
  cumulativeRealizedR: number;
  estimatedRealizedPl: number;
  estimatedEquity: number;
  peakEstimatedEquity: number;
  estimatedDrawdownPercent: number;
  consecutiveLosses: number;
  consecutiveWins: number;
}

/**
 * Fetches completed trades for a user from watcher_evaluations / trade_learning
 * and computes read-only equity & performance analytics safely.
 */
export async function fetchUserCompletedTrades(supabase: any, userId: string): Promise<any[]> {
  const client = supabase || defaultSupabase;
  if (!userId) return [];

  try {
    // Query watcher_evaluations or trade_learning where outcome is WIN or LOSS (completed trades)
    // We check watcher_evaluations first as it is the primary historical log
    const { data, error } = await client
      .from('watcher_evaluations')
      .select('*')
      .eq('user_id', userId)
      .in('outcome', ['WIN', 'LOSS', 'BREAKEVEN'])
      .order('created_at', { ascending: true });

    if (error || !data) {
      // Fallback try trade_learning table if it exists
      const { data: learningData, error: learningErr } = await client
        .from('trade_learning')
        .select('*')
        .eq('user_id', userId)
        .order('created_at', { ascending: true });

      if (learningErr || !learningData) {
        return [];
      }
      return learningData;
    }

    return data;
  } catch (err) {
    console.error('[Equity Analytics] Error fetching user completed trades:', err);
    return [];
  }
}

/**
 * Computes analytics over completed trades for a specific user.
 * Strictly user-scoped. Never counts NO_TRADE, rejected signals, ACTIVE trades, etc.
 */
export function computeEquityAnalytics(trades: any[]): EquityMetrics {
  const defaultMetrics: EquityMetrics = {
    totalTrades: 0,
    wins: 0,
    losses: 0,
    winRate: 0,
    avgWinningR: 0,
    avgLosingR: 0,
    expectancyR: 0,
    consecutiveLosses: 0,
    consecutiveWins: 0,
    totalRealizedR: 0,
    performanceByPair: {},
    performanceByTimeframe: {},
    performanceBySetup: {},
    sampleSizeTier: 'INSUFFICIENT'
  };

  if (!Array.isArray(trades) || trades.length === 0) {
    return defaultMetrics;
  }

  // Filter valid completed trades only (WIN, LOSS, BREAKEVEN - excluding active, NO_TRADE, etc.)
  const completed = trades.filter(t => {
    const outcome = (t.outcome || '').toUpperCase();
    return (outcome === 'WIN' || outcome === 'LOSS' || outcome === 'BREAKEVEN') &&
           t.user_id &&
           !t.is_active;
  });

  const totalTrades = completed.length;
  if (totalTrades === 0) return defaultMetrics;

  let wins = 0;
  let losses = 0;
  let totalWinR = 0;
  let totalLossR = 0;
  let totalRealizedR = 0;

  const pairStats: Record<string, { trades: number; wins: number; losses: number; totalR: number }> = {};
  const tfStats: Record<string, { trades: number; wins: number; losses: number; totalR: number }> = {};
  const setupStats: Record<string, { trades: number; wins: number; losses: number; totalR: number }> = {};

  let currentStreakLosses = 0;
  let currentStreakWins = 0;
  let maxStreakLosses = 0;
  let maxStreakWins = 0;

  for (const t of completed) {
    const outcome = (t.outcome || '').toUpperCase();
    // Use rr_achieved if available, otherwise estimate from pips or default
    let rVal = Number(t.rr_achieved);
    if (isNaN(rVal) || !Number.isFinite(rVal)) {
      // Fallback estimation if rr_achieved missing
      const pips = Number(t.pips || 0);
      rVal = outcome === 'WIN' ? Math.max(0.5, pips / 20) : (outcome === 'LOSS' ? -1.0 : 0);
    }

    const pair = (t.pair || t.symbol || 'UNKNOWN').toUpperCase();
    const timeframe = (t.timeframe || t.selected_timeframe || 'H1').toUpperCase();
    const setup = (t.strategy_mode || t.setup_name || 'HYBRID').toUpperCase();

    // Initialize pair/tf/setup stats
    if (!pairStats[pair]) pairStats[pair] = { trades: 0, wins: 0, losses: 0, totalR: 0 };
    if (!tfStats[timeframe]) tfStats[timeframe] = { trades: 0, wins: 0, losses: 0, totalR: 0 };
    if (!setupStats[setup]) setupStats[setup] = { trades: 0, wins: 0, losses: 0, totalR: 0 };

    pairStats[pair].trades++;
    tfStats[timeframe].trades++;
    setupStats[setup].trades++;

    totalRealizedR += rVal;

    if (outcome === 'WIN') {
      wins++;
      totalWinR += Math.max(0, rVal);
      pairStats[pair].wins++;
      tfStats[timeframe].wins++;
      setupStats[setup].wins++;

      currentStreakWins++;
      currentStreakLosses = 0;
      if (currentStreakWins > maxStreakWins) maxStreakWins = currentStreakWins;
    } else if (outcome === 'LOSS') {
      losses++;
      totalLossR += Math.abs(Math.min(0, rVal) || 1.0); // assume 1R risk if negative R missing
      pairStats[pair].losses++;
      tfStats[timeframe].losses++;
      setupStats[setup].losses++;

      currentStreakLosses++;
      currentStreakWins = 0;
      if (currentStreakLosses > maxStreakLosses) maxStreakLosses = currentStreakLosses;
    } else {
      // Breakeven
      currentStreakLosses = 0;
      currentStreakWins = 0;
    }

    pairStats[pair].totalR += rVal;
    tfStats[timeframe].totalR += rVal;
    setupStats[setup].totalR += rVal;
  }

  const winRate = Number(((wins / totalTrades) * 100).toFixed(1));
  const pWin = wins / totalTrades;
  const pLoss = losses / totalTrades;
  const avgWinningR = wins > 0 ? Number((totalWinR / wins).toFixed(2)) : 0;
  const avgLosingR = losses > 0 ? Number((totalLossR / losses).toFixed(2)) : 1.0;

  // Expectancy = (P(win) * Avg Win R) - (P(loss) * Avg Loss R)
  const expectancyR = Number(((pWin * avgWinningR) - (pLoss * avgLosingR)).toFixed(3));

  // Format pair/tf/setup performance records
  const performanceByPair: EquityMetrics['performanceByPair'] = {};
  for (const [p, st] of Object.entries(pairStats)) {
    performanceByPair[p] = {
      trades: st.trades,
      wins: st.wins,
      losses: st.losses,
      winRate: st.trades > 0 ? Number(((st.wins / st.trades) * 100).toFixed(1)) : 0,
      expectancyR: st.trades > 0 ? Number((st.totalR / st.trades).toFixed(3)) : 0,
      totalR: Number(st.totalR.toFixed(2))
    };
  }

  const performanceByTimeframe: EquityMetrics['performanceByTimeframe'] = {};
  for (const [tf, st] of Object.entries(tfStats)) {
    performanceByTimeframe[tf] = {
      trades: st.trades,
      wins: st.wins,
      losses: st.losses,
      winRate: st.trades > 0 ? Number(((st.wins / st.trades) * 100).toFixed(1)) : 0,
      expectancyR: st.trades > 0 ? Number((st.totalR / st.trades).toFixed(3)) : 0,
      totalR: Number(st.totalR.toFixed(2))
    };
  }

  const performanceBySetup: EquityMetrics['performanceBySetup'] = {};
  for (const [su, st] of Object.entries(setupStats)) {
    performanceBySetup[su] = {
      trades: st.trades,
      wins: st.wins,
      losses: st.losses,
      winRate: st.trades > 0 ? Number(((st.wins / st.trades) * 100).toFixed(1)) : 0,
      expectancyR: st.trades > 0 ? Number((st.totalR / st.trades).toFixed(3)) : 0,
      totalR: Number(st.totalR.toFixed(2))
    };
  }

  let sampleSizeTier: EquityMetrics['sampleSizeTier'] = 'INSUFFICIENT';
  if (totalTrades >= 20) {
    sampleSizeTier = 'ELIGIBLE';
  } else if (totalTrades >= 10) {
    sampleSizeTier = 'WEAK';
  }

  return {
    totalTrades,
    wins,
    losses,
    winRate: isNaN(winRate) ? 0 : winRate,
    avgWinningR: isNaN(avgWinningR) ? 0 : avgWinningR,
    avgLosingR: isNaN(avgLosingR) ? 1.0 : avgLosingR,
    expectancyR: isNaN(expectancyR) ? 0 : expectancyR,
    consecutiveLosses: currentStreakLosses,
    consecutiveWins: currentStreakWins,
    totalRealizedR: Number(totalRealizedR.toFixed(2)),
    performanceByPair,
    performanceByTimeframe,
    performanceBySetup,
    sampleSizeTier
  };
}

/**
 * Derives read-only Equity State from configured capital and historical performance R.
 */
export function deriveEquityState(configuredCapital: number, metrics: EquityMetrics): EquityState {
  const cap = Number.isFinite(configuredCapital) && configuredCapital > 0 ? configuredCapital : 1000;
  const totalR = metrics.totalRealizedR;

  // Assuming average 1% risk per trade or standard dollar value per R (e.g. 1% of capital per R unit)
  const riskUnitPerR = cap * 0.01;
  const estimatedRealizedPl = Number((totalR * riskUnitPerR).toFixed(2));
  const estimatedEquity = Number((cap + estimatedRealizedPl).toFixed(2));

  // Peak equity approximation for drawdown calculation
  let peakEquity = cap;
  let runningEq = cap;
  // Simple heuristic peak calculation
  if (estimatedEquity > peakEquity) {
    peakEquity = estimatedEquity;
  } else if (estimatedEquity < cap) {
    peakEquity = cap;
  }

  const drawdownAmt = peakEquity > estimatedEquity ? peakEquity - estimatedEquity : 0;
  const estimatedDrawdownPercent = peakEquity > 0 ? Number(((drawdownAmt / peakEquity) * 100).toFixed(1)) : 0;

  return {
    configuredCapital: cap,
    cumulativeRealizedR: totalR,
    estimatedRealizedPl,
    estimatedEquity,
    peakEstimatedEquity: peakEquity,
    estimatedDrawdownPercent: isNaN(estimatedDrawdownPercent) ? 0 : estimatedDrawdownPercent,
    consecutiveLosses: metrics.consecutiveLosses,
    consecutiveWins: metrics.consecutiveWins
  };
}
