import { getSupabase } from "../../lib/supabase-server.js";
const defaultSupabase = getSupabase();
async function fetchUserCompletedTrades(supabase, userId) {
  const client = supabase || defaultSupabase;
  if (!userId) return [];
  try {
    const { data: learningData, error: learningErr } = await client.from("trade_learning").select("*").eq("user_id", userId).in("outcome", ["WIN", "LOSS", "BREAKEVEN"]).order("created_at", { ascending: true });
    if (!learningErr && Array.isArray(learningData) && learningData.length > 0) {
      return learningData;
    }
    const { data, error } = await client.from("watcher_evaluations").select("*").eq("user_id", userId).in("outcome", ["WIN", "LOSS", "BREAKEVEN"]).order("created_at", { ascending: true });
    if (error || !data) {
      return [];
    }
    return data;
  } catch (err) {
    console.error("[Equity Analytics] Error fetching user completed trades:", err);
    return [];
  }
}
function computeEquityAnalytics(trades) {
  const defaultMetrics = {
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
    sampleSizeTier: "INSUFFICIENT"
  };
  if (!Array.isArray(trades) || trades.length === 0) {
    return defaultMetrics;
  }
  const completed = trades.filter((t) => {
    const outcome = (t.outcome || "").toUpperCase();
    return (outcome === "WIN" || outcome === "LOSS" || outcome === "BREAKEVEN") && t.user_id && !t.is_active;
  });
  const totalTrades = completed.length;
  if (totalTrades === 0) return defaultMetrics;
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let totalWinR = 0;
  let totalLossR = 0;
  let totalRealizedR = 0;
  const pairStats = {};
  const tfStats = {};
  const setupStats = {};
  const dirStats = {};
  const regimeStats = {};
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
    const outcome = (t.outcome || "").toUpperCase();
    let rVal = Number(t.rr_achieved ?? t.realized_r ?? t.pnl_r);
    if (isNaN(rVal) || !Number.isFinite(rVal)) {
      const pips = Number(t.pips || 0);
      rVal = outcome === "WIN" ? Math.max(0.5, pips / 20) : outcome === "LOSS" ? -1 : 0;
    }
    const pair = (t.pair || t.symbol || "UNKNOWN").toUpperCase();
    const timeframe = (t.timeframe || t.selected_timeframe || "H1").toUpperCase();
    const setup = (t.strategy_mode || t.setup_name || t.setup || "HYBRID").toUpperCase();
    const direction = (t.direction || t.signal || "BUY").toUpperCase();
    const regime = (t.market_snapshot?.regime || t.regime || "UNKNOWN").toUpperCase();
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
    const execTiming = t.decision_snapshot?.executionResult?.timingQuality || t.market_snapshot?.timingQuality;
    const wasChasing = t.decision_snapshot?.executionResult?.isChasing || t.market_snapshot?.isChasing;
    if (execTiming) {
      timingCount++;
      if (execTiming === "OPTIMAL" || execTiming === "GOOD") {
        goodCount++;
        if (outcome === "WIN") timingWins++;
      } else if (execTiming === "ACCEPTABLE" || execTiming === "FAIR") {
        fairCount++;
        if (outcome === "WIN") timingWins++;
      } else {
        poorCount++;
      }
    }
    if (wasChasing) {
      chasingTrades++;
      if (outcome === "LOSS") chasingLosses++;
    }
    if (outcome === "WIN") {
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
    } else if (outcome === "LOSS") {
      losses++;
      totalLossR += Math.abs(Math.min(0, rVal) || 1);
      pairStats[pair].losses++;
      tfStats[timeframe].losses++;
      setupStats[setup].losses++;
      dirStats[direction].losses++;
      regimeStats[regime].losses++;
      currentStreakLosses++;
      currentStreakWins = 0;
      if (currentStreakLosses > maxStreakLosses) maxStreakLosses = currentStreakLosses;
    } else {
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
  const winRate = Number((wins / totalTrades * 100).toFixed(1));
  const pWin = wins / totalTrades;
  const pLoss = losses / totalTrades;
  const avgWinningR = wins > 0 ? Number((totalWinR / wins).toFixed(2)) : 0;
  const avgLosingR = losses > 0 ? Number((totalLossR / losses).toFixed(2)) : 1;
  const expectancyR = Number((pWin * avgWinningR - pLoss * avgLosingR).toFixed(3));
  const performanceByPair = {};
  for (const [p, st] of Object.entries(pairStats)) {
    performanceByPair[p] = {
      trades: st.trades,
      wins: st.wins,
      losses: st.losses,
      breakevens: st.breakevens,
      winRate: st.trades > 0 ? Number((st.wins / st.trades * 100).toFixed(1)) : 0,
      expectancyR: st.trades > 0 ? Number((st.totalR / st.trades).toFixed(3)) : 0,
      totalR: Number(st.totalR.toFixed(2))
    };
  }
  const performanceByTimeframe = {};
  for (const [tf, st] of Object.entries(tfStats)) {
    performanceByTimeframe[tf] = {
      trades: st.trades,
      wins: st.wins,
      losses: st.losses,
      breakevens: st.breakevens,
      winRate: st.trades > 0 ? Number((st.wins / st.trades * 100).toFixed(1)) : 0,
      expectancyR: st.trades > 0 ? Number((st.totalR / st.trades).toFixed(3)) : 0,
      totalR: Number(st.totalR.toFixed(2))
    };
  }
  const performanceBySetup = {};
  for (const [su, st] of Object.entries(setupStats)) {
    performanceBySetup[su] = {
      trades: st.trades,
      wins: st.wins,
      losses: st.losses,
      breakevens: st.breakevens,
      winRate: st.trades > 0 ? Number((st.wins / st.trades * 100).toFixed(1)) : 0,
      expectancyR: st.trades > 0 ? Number((st.totalR / st.trades).toFixed(3)) : 0,
      totalR: Number(st.totalR.toFixed(2))
    };
  }
  const performanceByDirection = {};
  for (const [d, st] of Object.entries(dirStats)) {
    performanceByDirection[d] = {
      trades: st.trades,
      wins: st.wins,
      losses: st.losses,
      breakevens: st.breakevens,
      winRate: st.trades > 0 ? Number((st.wins / st.trades * 100).toFixed(1)) : 0,
      expectancyR: st.trades > 0 ? Number((st.totalR / st.trades).toFixed(3)) : 0,
      totalR: Number(st.totalR.toFixed(2))
    };
  }
  const performanceByRegime = {};
  for (const [rg, st] of Object.entries(regimeStats)) {
    performanceByRegime[rg] = {
      trades: st.trades,
      wins: st.wins,
      losses: st.losses,
      breakevens: st.breakevens,
      winRate: st.trades > 0 ? Number((st.wins / st.trades * 100).toFixed(1)) : 0,
      expectancyR: st.trades > 0 ? Number((st.totalR / st.trades).toFixed(3)) : 0,
      totalR: Number(st.totalR.toFixed(2))
    };
  }
  let sampleSizeTier = "INSUFFICIENT";
  if (totalTrades >= 20) {
    sampleSizeTier = "ELIGIBLE";
  } else if (totalTrades >= 10) {
    sampleSizeTier = "WEAK";
  }
  return {
    totalTrades,
    wins,
    losses,
    breakevens,
    winRate: isNaN(winRate) ? 0 : winRate,
    avgWinningR: isNaN(avgWinningR) ? 0 : avgWinningR,
    avgLosingR: isNaN(avgLosingR) ? 1 : avgLosingR,
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
      timingWinRate: timingCount > 0 ? Number((timingWins / timingCount * 100).toFixed(1)) : 0
    },
    sampleSizeTier
  };
}
function deriveEquityState(configuredCapital, metrics) {
  const cap = Number.isFinite(configuredCapital) && configuredCapital > 0 ? configuredCapital : 1e3;
  const totalR = metrics.totalRealizedR;
  const riskUnitPerR = cap * 0.01;
  const estimatedRealizedPl = Number((totalR * riskUnitPerR).toFixed(2));
  const estimatedEquity = Number((cap + estimatedRealizedPl).toFixed(2));
  let peakEquity = cap;
  if (estimatedEquity > peakEquity) {
    peakEquity = estimatedEquity;
  }
  const drawdownAmt = peakEquity > estimatedEquity ? peakEquity - estimatedEquity : 0;
  const estimatedDrawdownPercent = peakEquity > 0 ? Number((drawdownAmt / peakEquity * 100).toFixed(1)) : 0;
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
function computeDailyPnL(trades, configuredCapital = 1e3) {
  if (!Array.isArray(trades) || trades.length === 0) return 0;
  const today = (/* @__PURE__ */ new Date()).setHours(0, 0, 0, 0);
  const todayTrades = trades.filter((t) => {
    const tradeDate = new Date(t.created_at || t.closed_at).getTime();
    return tradeDate >= today;
  });
  const riskUnit = configuredCapital * 0.01;
  return todayTrades.reduce((acc, t) => {
    let pnl = Number(t.net_pnl ?? t.gross_pnl ?? t.actual_pnl);
    if (isNaN(pnl) || !Number.isFinite(pnl)) {
      const rVal = Number(t.realized_r ?? t.rr_achieved ?? t.pnl_r);
      if (!isNaN(rVal) && Number.isFinite(rVal)) {
        pnl = rVal * riskUnit;
      } else {
        const outcome = String(t.outcome || "").toUpperCase();
        if (outcome === "LOSS") {
          pnl = -riskUnit;
        } else if (outcome === "WIN") {
          pnl = riskUnit * 2;
        } else {
          pnl = 0;
        }
      }
    }
    return acc + pnl;
  }, 0);
}
export {
  computeDailyPnL,
  computeEquityAnalytics,
  deriveEquityState,
  fetchUserCompletedTrades
};
