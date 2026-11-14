import { getSupabase } from "../../lib/supabase-server.js";
const defaultSupabase = getSupabase();
import { fetchUserCompletedTrades, computeEquityAnalytics, deriveEquityState } from "./equity-learning-engine.js";
import { filterValidCompletedTrades, computeMetricsForSubset } from "./adaptive-learning-engine.js";
import { evaluateRiskGovernor } from "./risk-governor.js";
import { aggregateLossDiagnostics } from "./trade-post-mortem-engine.js";
function getEvidenceTier(sampleSize) {
  if (sampleSize >= 30) return "STRONG";
  if (sampleSize >= 20) return "MODERATE";
  if (sampleSize >= 10) return "WEAK";
  return "INSUFFICIENT";
}
function getPerformanceState(sampleSize, expectancyR, winRate) {
  if (sampleSize < 10) return "INSUFFICIENT_DATA";
  if (expectancyR >= 0.2 && winRate >= 50) return "HEALTHY";
  if (expectancyR < -0.15 || winRate < 35) return "POOR";
  if (expectancyR < 0) return "DETERIORATING";
  return "NEUTRAL";
}
async function getUserPerformanceSnapshot(userId, options) {
  const generatedAt = (/* @__PURE__ */ new Date()).toISOString();
  const supabase = options?.supabase || defaultSupabase;
  console.log(`[PERFORMANCE SNAPSHOT] Generating snapshot for user: ${userId}`);
  let rawTrades = options?.completedTrades || [];
  if (!options?.completedTrades && userId) {
    try {
      rawTrades = await fetchUserCompletedTrades(supabase, userId);
    } catch (err) {
      console.error("[PERFORMANCE SNAPSHOT] Error fetching trades:", err);
    }
  }
  const completedTrades = filterValidCompletedTrades(rawTrades).filter((t) => t.user_id === userId);
  const cap = options?.configuredCapital || 1e3;
  const equityMetrics = computeEquityAnalytics(completedTrades);
  const equityState = deriveEquityState(cap, equityMetrics);
  const totalCompletedTrades = equityMetrics.totalTrades;
  const wins = equityMetrics.wins;
  const losses = equityMetrics.losses;
  const breakevens = completedTrades.filter((t) => (t.outcome || "").toUpperCase() === "BREAKEVEN").length;
  const globalEvidenceTier = getEvidenceTier(totalCompletedTrades);
  function buildBreakdown(groupFn) {
    const groups = {};
    for (const t of completedTrades) {
      const key = groupFn(t);
      if (!groups[key]) groups[key] = [];
      groups[key].push(t);
    }
    const breakdown = {};
    for (const [key, trades] of Object.entries(groups)) {
      const metrics = computeMetricsForSubset(trades);
      const sampleSize = metrics.totalTrades;
      const w = metrics.wins;
      const l = metrics.losses;
      const be = trades.filter((t) => (t.outcome || "").toUpperCase() === "BREAKEVEN").length;
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
  const breakdownByPair = buildBreakdown((t) => (t.pair || t.symbol || "UNKNOWN").toUpperCase());
  const breakdownByTimeframe = buildBreakdown((t) => (t.timeframe || t.selected_timeframe || "M5").toUpperCase());
  const breakdownBySetup = buildBreakdown((t) => (t.strategy_mode || t.setup_name || t.setup || "HYBRID").toUpperCase());
  const breakdownByDirection = buildBreakdown((t) => (t.direction || t.signal || "BUY").toUpperCase());
  const breakdownByRegime = buildBreakdown((t) => (t.market_regime || t.regime || "UNKNOWN").toUpperCase());
  const breakdownByExecutionTiming = buildBreakdown((t) => {
    const score = Number(t.execution_score);
    if (!isNaN(score) && score > 0) {
      if (score >= 80) return "GOOD";
      if (score >= 60) return "FAIR";
      return "POOR";
    }
    return "INSUFFICIENT";
  });
  const goodTrades = completedTrades.filter((t) => t.execution_score && Number(t.execution_score) >= 80);
  const fairTrades = completedTrades.filter((t) => t.execution_score && Number(t.execution_score) >= 60 && Number(t.execution_score) < 80);
  const poorTrades = completedTrades.filter((t) => t.execution_score && Number(t.execution_score) < 60);
  const insufficientTrades = completedTrades.filter((t) => !t.execution_score || isNaN(Number(t.execution_score)));
  function timingGroupStats(trades) {
    const m = computeMetricsForSubset(trades);
    return {
      count: trades.length,
      wins: m.wins,
      losses: m.losses,
      winRate: m.winRate,
      expectancyR: m.expectancyR
    };
  }
  let waitCount = 0;
  let executeCount = totalCompletedTrades;
  let noTradeCount = 0;
  let chasingRejectionCount = 0;
  if (options?.allEvaluations) {
    const userEvals = options.allEvaluations.filter((e) => e.user_id === userId);
    waitCount = userEvals.filter((e) => (e.final_decision || e.recommendation || "").toUpperCase() === "WAIT").length;
    noTradeCount = userEvals.filter((e) => (e.final_decision || e.recommendation || "").toUpperCase() === "NO_TRADE").length;
    chasingRejectionCount = userEvals.filter((e) => e.reason_code === "ENTRY_CHASING_REJECTED" || e.reasoning && String(e.reasoning).includes("chasing")).length;
  }
  const executionMetrics = {
    goodTiming: timingGroupStats(goodTrades),
    fairTiming: timingGroupStats(fairTrades),
    poorTiming: timingGroupStats(poorTrades),
    insufficientDataTiming: timingGroupStats(insufficientTrades),
    waitCount,
    executeCount,
    noTradeCount,
    chasingRejectionCount
  };
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
      pair: "EURUSD",
      timeframe: "M5"
    }
  });
  const pairDeterioration = {};
  for (const [p, stats] of Object.entries(equityMetrics.performanceByPair)) {
    pairDeterioration[p] = stats.expectancyR < -0.1;
  }
  const setupDeterioration = {};
  for (const [su, stats] of Object.entries(equityMetrics.performanceBySetup)) {
    setupDeterioration[su] = stats.expectancyR < -0.1;
  }
  const riskGovernorVisibility = {
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
    riskGovernorVisibility,
    lossDiagnostics: aggregateLossDiagnostics(completedTrades)
  };
}
export {
  getEvidenceTier,
  getPerformanceState,
  getUserPerformanceSnapshot
};
