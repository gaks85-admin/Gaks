import { getSupabase } from "../../lib/supabase-server.js";
const defaultSupabase = getSupabase();
const statsCache = /* @__PURE__ */ new Map();
const CACHE_TTL_MS = 3e4;
function getFromCache(key) {
  const entry = statsCache.get(key);
  if (entry && Date.now() - entry.timestamp < CACHE_TTL_MS) {
    return entry.data;
  }
  return null;
}
function setToCache(key, data) {
  statsCache.set(key, { data, timestamp: Date.now() });
}
function clearStatsCache() {
  statsCache.clear();
}
async function recordCompletedTrade(supabase, params) {
  const client = supabase || defaultSupabase;
  const start = Date.now();
  try {
    if (!params.user_id || typeof params.user_id !== "string" || !params.user_id.trim()) {
      console.error("[Learning Engine] user_id is required to record completed trade. Aborting.");
      return null;
    }
    if (params.trade_id && client && typeof client.from === "function") {
      try {
        const { data: existingTrade } = await client.from("trade_learning").select("*").eq("trade_id", params.trade_id).maybeSingle();
        if (existingTrade) {
          console.log(`[Learning Engine] Trade ${params.trade_id} already recorded in trade_learning. Idempotent return.`);
          return existingTrade;
        }
      } catch (e) {
        console.warn(`[Learning Engine] Idempotency check error for trade_id ${params.trade_id}:`, e.message);
      }
    }
    if (params.outcome === void 0 || params.outcome === null || String(params.outcome).trim() === "") {
      console.warn(`[Learning Engine] Genuinely unavailable, empty or undefined outcome for trade ${params.trade_id || "unknown"}. Aborting recording to learning dataset.`);
      return null;
    }
    const dir = (params.direction || "").toUpperCase().trim();
    const isBuy = dir === "BUY" || dir === "LONG";
    const cleanSym = (params.pair || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    const isIndex = cleanSym.includes("US30") || cleanSym.includes("NAS") || cleanSym.includes("NDX") || cleanSym.includes("US100") || cleanSym.includes("US500") || cleanSym.includes("SPX") || cleanSym.includes("US2000") || cleanSym.includes("GER") || cleanSym.includes("DE30") || cleanSym.includes("DE40") || cleanSym.includes("UK100") || cleanSym.includes("JP225") || cleanSym.includes("HK50") || cleanSym.includes("INDEX");
    const isSubTenCrypto = cleanSym.includes("XRP") || cleanSym.includes("ADA") || cleanSym.includes("DOGE") || cleanSym.includes("SHIB") || cleanSym.includes("TRX") || cleanSym.includes("XLM");
    const isHundredthQuoted = !isSubTenCrypto && (cleanSym.includes("JPY") || cleanSym.includes("XAU") || cleanSym.includes("GOLD") || cleanSym.includes("XAG") || cleanSym.includes("SILVER") || cleanSym.includes("BTC") || cleanSym.includes("ETH") || cleanSym.includes("SOL") || cleanSym.includes("LTC") || cleanSym.includes("BNB") || cleanSym.includes("AVAX") || cleanSym.includes("BCH") || cleanSym.endsWith("USDT") || cleanSym.endsWith("USDC") || cleanSym.endsWith("BUSD"));
    const pipSize = isIndex ? 1 : isHundredthQuoted ? 0.01 : 1e-4;
    const diff = params.exit_price - params.entry_price;
    const pips = isBuy ? diff / pipSize : -diff / pipSize;
    let outcome = "BREAKEVEN";
    if (params.outcome) {
      const sanitized = String(params.outcome).toUpperCase().trim();
      const terminalOutcomes = ["WIN", "LOSS", "BREAKEVEN", "BROKER_REALIZED_WIN", "BROKER_REALIZED_LOSS", "BROKER_REALIZED_BREAKEVEN"];
      if (terminalOutcomes.includes(sanitized)) {
        outcome = sanitized;
      } else {
        if (Math.abs(pips) < 1) {
          outcome = "BREAKEVEN";
        } else if (pips > 0) {
          outcome = "WIN";
        } else {
          outcome = "LOSS";
        }
      }
    }
    const sl = params.stop_loss ? Number(params.stop_loss) : null;
    const tp = params.take_profit ? Number(params.take_profit) : null;
    const risk = sl ? Math.abs(params.entry_price - sl) : 0;
    const expectedReward = tp ? Math.abs(tp - params.entry_price) : 0;
    const achievedReward = isBuy ? params.exit_price - params.entry_price : params.entry_price - params.exit_price;
    const rr_expected = risk > 0 ? Number((expectedReward / risk).toFixed(2)) : null;
    const rr_achieved = risk > 0 ? Number((achievedReward / risk).toFixed(2)) : null;
    const trade_duration_minutes = Math.round(
      (new Date(params.closed_at).getTime() - new Date(params.opened_at).getTime()) / (1e3 * 60)
    );
    let session = params.session;
    if (!session) {
      const hour = new Date(params.opened_at).getUTCHours();
      if (hour >= 8 && hour < 13) session = "London";
      else if (hour >= 13 && hour < 17) session = "London / NY";
      else if (hour >= 17 && hour < 21) session = "NY";
      else session = "Asia";
    }
    const payload = {
      user_id: params.user_id,
      watcher_id: params.watcher_id,
      trade_id: params.trade_id || null,
      evaluation_id: params.evaluation_id || null,
      pair: params.pair,
      timeframe: params.timeframe,
      strategy_mode: params.strategy_mode || "HYBRID",
      entry_price: params.entry_price,
      stop_loss: sl,
      take_profit: tp,
      exit_price: params.exit_price,
      outcome,
      rr_expected,
      rr_achieved,
      pips: Number(pips.toFixed(1)),
      trade_duration_minutes,
      decision_score: params.decision_score || null,
      matched_weight: params.matched_weight || null,
      possible_weight: params.possible_weight || null,
      matched_rules: params.matched_rules || [],
      failed_rules: params.failed_rules || [],
      gemini_used: params.gemini_used || false,
      gemini_confidence: params.gemini_confidence || null,
      market_snapshot: params.market_snapshot || {},
      session,
      volatility: params.volatility || "MEDIUM",
      notes: params.notes || `Auto-recorded by Learning Engine. Outcome: ${outcome}`,
      decision_snapshot: params.decision_snapshot || {},
      // Broker Fields
      execution_mode: params.execution_mode || "THEORETICAL",
      actual_entry_price: params.actual_entry_price || null,
      requested_entry_price: params.requested_entry_price || null,
      entry_slippage_pips: params.entry_slippage_pips || null,
      gross_pnl: params.gross_pnl || null,
      net_pnl: params.net_pnl || null,
      fees: params.fees || null,
      commission: params.commission || null,
      swap: params.swap || null,
      slippage_pips: params.slippage_pips || null,
      realized_r: params.realized_r || null,
      broker_order_id: params.broker_order_id || null,
      outcome_source: params.outcome_source || "THEORETICAL"
    };
    console.log(`[Learning Engine] Recording completed trade: Pair ${payload.pair}, Outcome: ${payload.outcome}, Pips: ${payload.pips}`);
    const { data, error } = await client.from("trade_learning").insert(payload).select().single();
    if (error) {
      console.error("[Learning Engine] DB Insert Error:", error.message);
      throw error;
    }
    clearStatsCache();
    try {
      await updateProfitGoalProgress(client, params.user_id, payload);
    } catch (goalErr) {
      console.warn("[Learning Engine] Failed to update profit goal progress:", goalErr);
    }
    console.log(`[Learning Engine] Trade successfully recorded in ${Date.now() - start}ms`);
    return data;
  } catch (err) {
    console.error("[Learning Engine] Failed to record completed trade:", err.message);
    return null;
  }
}
async function updateProfitGoalProgress(supabase, userId, trade) {
  if (!userId) return;
  try {
    const { data: goal, error: fetchErr } = await supabase.from("profit_goals").select("*").eq("user_id", userId).eq("status", "ACTIVE").order("created_at", { ascending: false }).maybeSingle();
    if (fetchErr || !goal) return;
    let pnl = 0;
    if (trade.net_pnl !== void 0 && trade.net_pnl !== null) {
      pnl = Number(trade.net_pnl);
    } else if (trade.gross_pnl !== void 0 && trade.gross_pnl !== null) {
      pnl = Number(trade.gross_pnl);
    } else {
      const outcome = (trade.outcome || "").toUpperCase();
      const realizedR = trade.realized_r !== void 0 && trade.realized_r !== null ? Number(trade.realized_r) : 0;
      const riskPercentStr = goal.settings_applied?.riskPerTrade || "1%";
      const riskPercent = parseFloat(riskPercentStr.replace("%", "")) / 100 || 0.01;
      if (realizedR !== 0) {
        pnl = Number(goal.start_amount) * riskPercent * realizedR;
      } else if (outcome === "WIN" || outcome === "BROKER_REALIZED_WIN") {
        pnl = Number(goal.start_amount) * riskPercent * 2;
      } else if (outcome === "LOSS" || outcome === "BROKER_REALIZED_LOSS") {
        pnl = -(Number(goal.start_amount) * riskPercent);
      }
    }
    const newAmount = Number(goal.current_amount) + pnl;
    let newStatus = goal.status;
    if (newAmount >= Number(goal.target_amount)) {
      newStatus = "COMPLETED";
    } else {
      if (goal.deadline && new Date(goal.deadline).getTime() < Date.now()) {
        newStatus = "FAILED";
      }
    }
    await supabase.from("profit_goals").update({
      current_amount: newAmount,
      status: newStatus,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }).eq("id", goal.id);
  } catch (err) {
    console.error("[Learning Engine] updateProfitGoalProgress error:", err);
  }
}
async function fetchAllUserTrades(supabase, userId) {
  const client = supabase || defaultSupabase;
  if (!userId) return [];
  const { data, error } = await client.from("trade_learning").select("*").eq("user_id", userId).in("outcome", ["WIN", "LOSS", "BREAKEVEN"]);
  if (error) {
    console.error("[Learning Engine] Fetch trades error:", error.message);
    return [];
  }
  return data || [];
}
async function calculateRuleStatistics(supabase, userId) {
  const cacheKey = `rules_stats_${userId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  const trades = await fetchAllUserTrades(supabase, userId);
  if (trades.length === 0) return [];
  const ruleMap = /* @__PURE__ */ new Map();
  trades.forEach((t) => {
    const rulesList = Array.isArray(t.matched_rules) ? t.matched_rules : [];
    const isWin = t.outcome === "WIN";
    const rr = t.rr_achieved || 0;
    const duration = t.trade_duration_minutes || 0;
    const score = t.decision_score || 0;
    rulesList.forEach((ruleName) => {
      const current = ruleMap.get(ruleName) || { wins: 0, total: 0, rrSum: 0, durationSum: 0, scoreSum: 0 };
      current.total += 1;
      if (isWin) current.wins += 1;
      current.rrSum += rr;
      current.durationSum += duration;
      current.scoreSum += score;
      ruleMap.set(ruleName, current);
    });
  });
  const stats = Array.from(ruleMap.entries()).map(([ruleName, data]) => {
    return {
      rule: ruleName,
      trades: data.total,
      winRate: Number((data.wins / data.total * 100).toFixed(2)),
      averageRR: Number((data.rrSum / data.total).toFixed(2)),
      averageDuration: Math.round(data.durationSum / data.total),
      averageDecisionScore: Number((data.scoreSum / data.total).toFixed(1))
    };
  });
  stats.sort((a, b) => b.winRate - a.winRate);
  setToCache(cacheKey, stats);
  return stats;
}
async function calculatePairStatistics(supabase, userId) {
  const cacheKey = `pair_stats_${userId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  const trades = await fetchAllUserTrades(supabase, userId);
  if (trades.length === 0) return [];
  const pairMap = /* @__PURE__ */ new Map();
  trades.forEach((t) => {
    const isWin = t.outcome === "WIN";
    const rr = t.rr_achieved || 0;
    const pips = t.pips || 0;
    const duration = t.trade_duration_minutes || 0;
    const current = pairMap.get(t.pair) || { wins: 0, total: 0, rrSum: 0, pipsSum: 0, durationSum: 0 };
    current.total += 1;
    if (isWin) current.wins += 1;
    current.rrSum += rr;
    current.pipsSum += pips;
    current.durationSum += duration;
    pairMap.set(t.pair, current);
  });
  const stats = Array.from(pairMap.entries()).map(([pair, data]) => {
    return {
      pair,
      trades: data.total,
      winRate: Number((data.wins / data.total * 100).toFixed(2)),
      averageRR: Number((data.rrSum / data.total).toFixed(2)),
      totalPips: Number(data.pipsSum.toFixed(1)),
      averageDuration: Math.round(data.durationSum / data.total)
    };
  });
  stats.sort((a, b) => b.winRate - a.winRate);
  setToCache(cacheKey, stats);
  return stats;
}
async function calculateTimeframeStatistics(supabase, userId) {
  const cacheKey = `tf_stats_${userId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  const trades = await fetchAllUserTrades(supabase, userId);
  if (trades.length === 0) return [];
  const tfMap = /* @__PURE__ */ new Map();
  trades.forEach((t) => {
    const isWin = t.outcome === "WIN";
    const rr = t.rr_achieved || 0;
    const pips = t.pips || 0;
    const current = tfMap.get(t.timeframe) || { wins: 0, total: 0, rrSum: 0, pipsSum: 0 };
    current.total += 1;
    if (isWin) current.wins += 1;
    current.rrSum += rr;
    current.pipsSum += pips;
    tfMap.set(t.timeframe, current);
  });
  const stats = Array.from(tfMap.entries()).map(([timeframe, data]) => {
    return {
      timeframe,
      trades: data.total,
      winRate: Number((data.wins / data.total * 100).toFixed(2)),
      averageRR: Number((data.rrSum / data.total).toFixed(2)),
      totalPips: Number(data.pipsSum.toFixed(1))
    };
  });
  stats.sort((a, b) => b.winRate - a.winRate);
  setToCache(cacheKey, stats);
  return stats;
}
async function calculateSessionStatistics(supabase, userId) {
  const cacheKey = `session_stats_${userId}`;
  const cached = getFromCache(cacheKey);
  if (cached) return cached;
  const trades = await fetchAllUserTrades(supabase, userId);
  if (trades.length === 0) return [];
  const sessionMap = /* @__PURE__ */ new Map();
  trades.forEach((t) => {
    const isWin = t.outcome === "WIN";
    const rr = t.rr_achieved || 0;
    const pips = t.pips || 0;
    const s = t.session || "Unknown";
    const current = sessionMap.get(s) || { wins: 0, total: 0, rrSum: 0, pipsSum: 0 };
    current.total += 1;
    if (isWin) current.wins += 1;
    current.rrSum += rr;
    current.pipsSum += pips;
    sessionMap.set(s, current);
  });
  const stats = Array.from(sessionMap.entries()).map(([session, data]) => {
    return {
      session,
      trades: data.total,
      winRate: Number((data.wins / data.total * 100).toFixed(2)),
      averageRR: Number((data.rrSum / data.total).toFixed(2)),
      totalPips: Number(data.pipsSum.toFixed(1))
    };
  });
  stats.sort((a, b) => b.winRate - a.winRate);
  setToCache(cacheKey, stats);
  return stats;
}
import { calculateHistoricalProbability as calculateNewProb } from "./rule-learning-engine.js";
async function calculateHistoricalProbability(supabase, userId, pair, timeframe, matchedRules, strategyMode) {
  const result = await calculateNewProb(supabase, userId, pair, timeframe, strategyMode, matchedRules);
  return {
    historical_probability: result.historical_probability,
    sample_size: result.sample_size,
    confidence_level: result.sample_size === 0 ? "INSUFFICIENT_DATA" : result.confidence,
    confidence: result.confidence,
    win_rate: result.win_rate,
    average_rr: result.average_rr
  };
}
async function getUserWinRateStats(supabase, userId, pair) {
  const client = supabase || defaultSupabase;
  if (!userId) {
    return { totalTrades: 0, wins: 0, losses: 0, winRate: 0, pairTotalTrades: 0, pairWins: 0, pairWinRate: 0 };
  }
  try {
    const { data: trades, error } = await client.from("trade_learning").select("outcome, pair").eq("user_id", userId).in("outcome", ["WIN", "LOSS", "BROKER_REALIZED_WIN", "BROKER_REALIZED_LOSS"]);
    if (error || !trades || trades.length === 0) {
      return { totalTrades: 0, wins: 0, losses: 0, winRate: 0, pairTotalTrades: 0, pairWins: 0, pairWinRate: 0 };
    }
    const totalTrades = trades.length;
    const wins = trades.filter((t) => t.outcome === "WIN" || t.outcome === "BROKER_REALIZED_WIN").length;
    const losses = trades.filter((t) => t.outcome === "LOSS" || t.outcome === "BROKER_REALIZED_LOSS").length;
    const winRate = totalTrades > 0 ? Number((wins / totalTrades * 100).toFixed(1)) : 0;
    let pairTotalTrades = 0;
    let pairWins = 0;
    let pairWinRate = 0;
    if (pair) {
      const cleanPair = (pair || "").toUpperCase().replace("/", "").trim();
      const pairTrades = trades.filter((t) => (t.pair || "").toUpperCase().replace("/", "").trim() === cleanPair);
      pairTotalTrades = pairTrades.length;
      pairWins = pairTrades.filter((t) => t.outcome === "WIN" || t.outcome === "BROKER_REALIZED_WIN").length;
      pairWinRate = pairTotalTrades > 0 ? Number((pairWins / pairTotalTrades * 100).toFixed(1)) : 0;
    }
    return {
      totalTrades,
      wins,
      losses,
      winRate,
      pairTotalTrades,
      pairWins,
      pairWinRate
    };
  } catch (err) {
    console.error("[Learning Engine] getUserWinRateStats error:", err);
    return { totalTrades: 0, wins: 0, losses: 0, winRate: 0, pairTotalTrades: 0, pairWins: 0, pairWinRate: 0 };
  }
}
export {
  calculateHistoricalProbability,
  calculatePairStatistics,
  calculateRuleStatistics,
  calculateSessionStatistics,
  calculateTimeframeStatistics,
  clearStatsCache,
  getUserWinRateStats,
  recordCompletedTrade
};
