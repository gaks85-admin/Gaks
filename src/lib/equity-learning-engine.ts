import { getSupabase } from '../../lib/supabase-server.js';
const defaultSupabase = getSupabase();

export interface EquityMetrics {
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  winRate: number; // 0 to 100
  avgWinningR: number;
  avgLosingR: number;
  expectancyR: number;
  consecutiveLosses: number;
  consecutiveWins: number;
  totalRealizedR: number;
  performanceByPair: Record<string, { trades: number; wins: number; losses: number; breakevens?: number; winRate: number; expectancyR: number; totalR: number }>;
  performanceByTimeframe: Record<string, { trades: number; wins: number; losses: number; breakevens?: number; winRate: number; expectancyR: number; totalR: number }>;
  performanceBySetup: Record<string, { trades: number; wins: number; losses: number; breakevens?: number; winRate: number; expectancyR: number; totalR: number }>;
  performanceByDirection: Record<string, { trades: number; wins: number; losses: number; breakevens?: number; winRate: number; expectancyR: number; totalR: number }>;
  performanceByRegime: Record<string, { trades: number; wins: number; losses: number; breakevens?: number; winRate: number; expectancyR: number; totalR: number }>;
  executionTimingPerformance?: {
    goodCount: number;
    fairCount: number;
    poorCount: number;
    chasingTrades: number;
    chasingLosses: number;
    timingWinRate: number;
  };
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
 * Fetches completed trades for a user from trade_learning / watcher_evaluations
 * and computes read-only equity & performance analytics safely.
 */
export async function fetchUserCompletedTrades(supabase: any, userId: string): Promise<any[]> {
  const client = supabase || defaultSupabase;
  if (!userId) return [];

  try {
    // 1. Primary: query trade_learning table for completed trades
    const { data: learningData, error: learningErr } = await client
      .from('trade_learning')
      .select('*')
      .eq('user_id', userId)
      .in('outcome', ['WIN', 'LOSS', 'BREAKEVEN'])
      .order('created_at', { ascending: true });

    if (!learningErr && Array.isArray(learningData) && learningData.length > 0) {
      return learningData;
    }

    // 2. Fallback: query watcher_evaluations where outcome is WIN, LOSS, or BREAKEVEN
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
    breakevens: 0,
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
    performanceByDirection: {},
    performanceByRegime: {},
    executionTimingPerformance: {
      goodCount: 0,
      fairCount: 0,
      poorCount: 0,
      chasingTrades: 0,
      chasingLosses: 0,
      timingWinRate: 0
    },
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
  let breakevens = 0;
  let totalWinR = 0;
  let totalLossR = 0;
  let totalRealizedR = 0;

  const pairStats: Record<string, { trades: number; wins: number; losses: number; breakevens: number; totalR: number }> = {};
  const tfStats: Record<string, { trades: number; wins: number; losses: number; breakevens: number; totalR: number }> = {};
  const setupStats: Record<string, { trades: number; wins: number; losses: number; breakevens: number; totalR: number }> = {};
  const dirStats: Record<string, { trades: number; wins: number; losses: number; breakevens: number; totalR: number }> = {};
  const regimeStats: Record<string, { trades: number; wins: number; losses: number; breakevens: number; totalR: number }> = {};

  let goodCount = 0;
  let fairCount = 0;
  let poorCount = 0;
  let chasingTrades = 0;
  let chasingLosses = 0;
  let timingWins = 0;
  let timingCount = 0;

  let currentStreakLosses = 0;
  let currentStreakWins = 0;
  let maxStreakLosses = 0;
  let maxStreakWins = 0;

  for (const t of completed) {
    const outcome = (t.outcome || '').toUpperCase();
    // Use rr_achieved, realized_r, or pnl_r if available
    let rVal = Number(t.rr_achieved ?? t.realized_r ?? t.pnl_r);
    if (isNaN(rVal) || !Number.isFinite(rVal)) {
      // Fallback estimation if explicit R metrics are missing
      const pips = Number(t.pips || 0);
      rVal = outcome === 'WIN' ? Math.max(0.5, pips / 20) : (outcome === 'LOSS' ? -1.0 : 0);
    }

    const pair = (t.pair || t.symbol || 'UNKNOWN').toUpperCase();
    const timeframe = (t.timeframe || t.selected_timeframe || 'H1').toUpperCase();
    const setup = (t.strategy_mode || t.setup_name || t.setup || 'HYBRID').toUpperCase();
    const direction = (t.direction || t.signal || 'BUY').toUpperCase();
    const regime = (t.market_snapshot?.regime || t.regime || 'UNKNOWN').toUpperCase();

    // Initialize groupings
    if (!pairStats[pair]) pairStats[pair] = { trades: 0, wins: 0, losses: 0, breakevens: 0, totalR: 0 };
    if (!tfStats[timeframe]) tfStats[timeframe] = { trades: 0, wins: 0, losses: 0, breakevens: 0, totalR: 0 };
    if (!setupStats[setup]) setupStats[setup] = { trades: 0, wins: 0, losses: 0, breakevens: 0, totalR: 0 };
    if (!dirStats[direction]) dirStats[direction] = { trades: 0, wins: 0, losses: 0, breakevens: 0, totalR: 0 };
    if (!regimeStats[regime]) regimeStats[regime] = { trades: 0, wins: 0, losses: 0, breakevens: 0, totalR: 0 };

    pairStats[pair].trades++;
    tfStats[timeframe].trades++;
    setupStats[setup].trades++;
    dirStats[direction].trades++;
    regimeStats[regime].trades++;

    totalRealizedR += rVal;

    // Execution timing diagnostics if recorded in snapshot
    const execTiming = t.decision_snapshot?.executionResult?.timingQuality || t.market_snapshot?.timingQuality;
    const wasChasing = t.decision_snapshot?.executionResult?.isChasing || t.market_snapshot?.isChasing;
    if (execTiming) {
      timingCount++;
      if (execTiming === 'OPTIMAL' || execTiming === 'GOOD') {
        goodCount++;
        if (outcome === 'WIN') timingWins++;
      } else if (execTiming === 'ACCEPTABLE' || execTiming === 'FAIR') {
        fairCount++;
        if (outcome === 'WIN') timingWins++;
      } else {
        poorCount++;
      }
    }
    if (wasChasing) {
      chasingTrades++;
      if (outcome === 'LOSS') chasingLosses++;
    }

    if (outcome === 'WIN') {
      wins++;
      totalWinR += Math.max(0, rVal);
      pairStats[pair].wins++;
      tfStats[timeframe].wins++;
      setupStats[setup].wins++;
      dirStats[direction].wins++;
      regimeStats[regime].wins++;

      currentStreakWins++;
      currentStreakLosses = 0;
      if (currentStreakWins > maxStreakWins) maxStreakWins = currentStreakWins;
    } else if (outcome === 'LOSS') {
      losses++;
      totalLossR += Math.abs(Math.min(0, rVal) || 1.0); // assume 1R risk if negative R missing
      pairStats[pair].losses++;
      tfStats[timeframe].losses++;
      setupStats[setup].losses++;
      dirStats[direction].losses++;
      regimeStats[regime].losses++;

      currentStreakLosses++;
      currentStreakWins = 0;
      if (currentStreakLosses > maxStreakLosses) maxStreakLosses = currentStreakLosses;
    } else {
      // Breakeven
      breakevens++;
      pairStats[pair].breakevens++;
      tfStats[timeframe].breakevens++;
      setupStats[setup].breakevens++;
      dirStats[direction].breakevens++;
      regimeStats[regime].breakevens++;

      currentStreakLosses = 0;
      currentStreakWins = 0;
    }

    pairStats[pair].totalR += rVal;
    tfStats[timeframe].totalR += rVal;
    setupStats[setup].totalR += rVal;
    dirStats[direction].totalR += rVal;
    regimeStats[regime].totalR += rVal;
  }

  const winRate = Number(((wins / totalTrades) * 100).toFixed(1));
  const pWin = wins / totalTrades;
  const pLoss = losses / totalTrades;
  const avgWinningR = wins > 0 ? Number((totalWinR / wins).toFixed(2)) : 0;
  const avgLosingR = losses > 0 ? Number((totalLossR / losses).toFixed(2)) : 1.0;

  // Expectancy = (P(win) * Avg Win R) - (P(loss) * Avg Loss R)
  const expectancyR = Number(((pWin * avgWinningR) - (pLoss * avgLosingR)).toFixed(3));

  // Format pair/tf/setup/dir/regime performance records
  const performanceByPair: EquityMetrics['performanceByPair'] = {};
  for (const [p, st] of Object.entries(pairStats)) {
    performanceByPair[p] = {
      trades: st.trades,
      wins: st.wins,
      losses: st.losses,
      breakevens: st.breakevens,
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
      breakevens: st.breakevens,
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
      breakevens: st.breakevens,
      winRate: st.trades > 0 ? Number(((st.wins / st.trades) * 100).toFixed(1)) : 0,
      expectancyR: st.trades > 0 ? Number((st.totalR / st.trades).toFixed(3)) : 0,
      totalR: Number(st.totalR.toFixed(2))
    };
  }

  const performanceByDirection: EquityMetrics['performanceByDirection'] = {};
  for (const [d, st] of Object.entries(dirStats)) {
    performanceByDirection[d] = {
      trades: st.trades,
      wins: st.wins,
      losses: st.losses,
      breakevens: st.breakevens,
      winRate: st.trades > 0 ? Number(((st.wins / st.trades) * 100).toFixed(1)) : 0,
      expectancyR: st.trades > 0 ? Number((st.totalR / st.trades).toFixed(3)) : 0,
      totalR: Number(st.totalR.toFixed(2))
    };
  }

  const performanceByRegime: EquityMetrics['performanceByRegime'] = {};
  for (const [rg, st] of Object.entries(regimeStats)) {
    performanceByRegime[rg] = {
      trades: st.trades,
      wins: st.wins,
      losses: st.losses,
      breakevens: st.breakevens,
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
    breakevens,
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
    performanceByDirection,
    performanceByRegime,
    executionTimingPerformance: {
      goodCount,
      fairCount,
      poorCount,
      chasingTrades,
      chasingLosses,
      timingWinRate: timingCount > 0 ? Number(((timingWins / timingCount) * 100).toFixed(1)) : 0
    },
    sampleSizeTier
  };
}

/**
 * Derives read-only Equity State from configured capital and historical performance R.
 */
export function deriveEquityState(configuredCapital: number, metrics: EquityMetrics): EquityState {
  const cap = Number.isFinite(configuredCapital) && configuredCapital > 0 ? configuredCapital : 1000;
  const totalR = metrics.totalRealizedR;

  // Standard dollar value per R unit (1% of starting capital)
  const riskUnitPerR = cap * 0.01;
  const estimatedRealizedPl = Number((totalR * riskUnitPerR).toFixed(2));
  const estimatedEquity = Number((cap + estimatedRealizedPl).toFixed(2));

  // Peak equity approximation for drawdown calculation
  let peakEquity = cap;
  if (estimatedEquity > peakEquity) {
    peakEquity = estimatedEquity;
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
