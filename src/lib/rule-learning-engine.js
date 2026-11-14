import { getSupabase } from "../../lib/supabase-server.js";
const defaultSupabase = getSupabase();
function calculateJaccardSimilarity(rules1, rules2) {
  const r1 = rules1 || [];
  const r2 = rules2 || [];
  if (r1.length === 0 && r2.length === 0) return 1;
  if (r1.length === 0 || r2.length === 0) return 0;
  const set1 = new Set(r1.map((r) => r.toLowerCase().trim()));
  const set2 = new Set(r2.map((r) => r.toLowerCase().trim()));
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = /* @__PURE__ */ new Set([...set1, ...set2]);
  return intersection.size / union.size;
}
async function calculateHistoricalProbability(supabaseOrPair, userIdOrTimeframe, pairOrStrategyMode, timeframeOrMatchedRules, strategyMode, matchedRules) {
  let client = defaultSupabase;
  let userId = "";
  let pair = "";
  let timeframe = "";
  let strategy_mode = "HYBRID";
  let matched_rules = [];
  if (supabaseOrPair && typeof supabaseOrPair === "object" && typeof supabaseOrPair.from === "function") {
    client = supabaseOrPair;
    userId = userIdOrTimeframe;
    pair = pairOrStrategyMode;
    timeframe = timeframeOrMatchedRules;
    strategy_mode = strategyMode || "HYBRID";
    matched_rules = matchedRules || [];
  } else {
    pair = supabaseOrPair || "";
    timeframe = userIdOrTimeframe || "";
    strategy_mode = pairOrStrategyMode || "HYBRID";
    matched_rules = timeframeOrMatchedRules || [];
    try {
      const { data: { user } } = await client.auth.getUser();
      if (user) {
        userId = user.id;
      }
    } catch {
    }
  }
  const defaultResult = {
    sample_size: 0,
    win_rate: 0,
    average_rr: 0,
    average_decision_score: 0,
    confidence: "LOW",
    historical_probability: 0
  };
  try {
    let query = client.from("trade_learning").select("*").eq("pair", pair).eq("timeframe", timeframe).eq("strategy_mode", strategy_mode);
    if (userId) {
      query = query.eq("user_id", userId);
    }
    const { data: records, error } = await query;
    if (error || !records || records.length === 0) {
      return defaultResult;
    }
    const currentRules = matched_rules || [];
    const similarTrades = records.filter((t) => {
      const histRules = Array.isArray(t.matched_rules) ? t.matched_rules : [];
      return calculateJaccardSimilarity(currentRules, histRules) >= 0.5;
    });
    const sample_size = similarTrades.length;
    if (sample_size === 0) {
      return defaultResult;
    }
    const wins = similarTrades.filter((t) => t.outcome === "WIN").length;
    const win_rate = Number((wins / sample_size * 100).toFixed(2));
    let rrSum = 0;
    let scoreSum = 0;
    similarTrades.forEach((t) => {
      rrSum += Number(t.rr_achieved || 0);
      scoreSum += Number(t.decision_score || 0);
    });
    const average_rr = Number((rrSum / sample_size).toFixed(2));
    const average_decision_score = Number((scoreSum / sample_size).toFixed(2));
    let confidence = "LOW";
    if (sample_size >= 100) {
      confidence = "HIGH";
    } else if (sample_size >= 20) {
      confidence = "MEDIUM";
    }
    return {
      sample_size,
      win_rate,
      average_rr,
      average_decision_score,
      confidence,
      historical_probability: win_rate
    };
  } catch (err) {
    console.error("[Rule Learning Engine] calculateHistoricalProbability error:", err.message);
    return defaultResult;
  }
}
async function calculateAdvancedLearningStats(supabase, userId) {
  const client = supabase || defaultSupabase;
  try {
    const { data: records, error } = await client.from("trade_learning").select("*").eq("user_id", userId);
    if (error || !records || records.length === 0) {
      return null;
    }
    const comboMap = /* @__PURE__ */ new Map();
    const pairMap = /* @__PURE__ */ new Map();
    const tfMap = /* @__PURE__ */ new Map();
    records.forEach((t) => {
      const isWin = t.outcome === "WIN";
      const rr = Number(t.rr_achieved || 0);
      const rules = Array.isArray(t.matched_rules) ? [...t.matched_rules].sort() : [];
      const comboKey = rules.length > 0 ? rules.join(" + ") : "No Rules Matched";
      const currentCombo = comboMap.get(comboKey) || { wins: 0, total: 0, rrSum: 0 };
      currentCombo.total += 1;
      if (isWin) currentCombo.wins += 1;
      currentCombo.rrSum += rr;
      comboMap.set(comboKey, currentCombo);
      const currentPair = pairMap.get(t.pair) || { wins: 0, total: 0 };
      currentPair.total += 1;
      if (isWin) currentPair.wins += 1;
      pairMap.set(t.pair, currentPair);
      const currentTf = tfMap.get(t.timeframe) || { wins: 0, total: 0 };
      currentTf.total += 1;
      if (isWin) currentTf.wins += 1;
      tfMap.set(t.timeframe, currentTf);
    });
    const ruleCombos = Array.from(comboMap.entries()).map(([combo, data]) => {
      const winRate = Number((data.wins / data.total * 100).toFixed(1));
      const avgRR = Number((data.rrSum / data.total).toFixed(2));
      return {
        combination: combo,
        trades: data.total,
        winRate,
        averageRR: avgRR
      };
    });
    const pairs = Array.from(pairMap.entries()).map(([pair, data]) => {
      const winRate = Number((data.wins / data.total * 100).toFixed(1));
      return {
        pair,
        trades: data.total,
        winRate
      };
    });
    const timeframes = Array.from(tfMap.entries()).map(([timeframe, data]) => {
      const winRate = Number((data.wins / data.total * 100).toFixed(1));
      return {
        timeframe,
        trades: data.total,
        winRate
      };
    });
    const sortedCombosByWinRate = [...ruleCombos].sort((a, b) => b.winRate - a.winRate || b.trades - a.trades);
    const sortedPairsByWinRate = [...pairs].sort((a, b) => b.winRate - a.winRate || b.trades - a.trades);
    const sortedTfsByWinRate = [...timeframes].sort((a, b) => b.winRate - a.winRate || b.trades - a.trades);
    return {
      bestCombinations: sortedCombosByWinRate.slice(0, 5),
      worstCombinations: [...sortedCombosByWinRate].reverse().slice(0, 5),
      bestPair: sortedPairsByWinRate[0] || null,
      worstPair: sortedPairsByWinRate[sortedPairsByWinRate.length - 1] || null,
      bestTimeframe: sortedTfsByWinRate[0] || null,
      worstTimeframe: sortedTfsByWinRate[sortedTfsByWinRate.length - 1] || null,
      ruleCombinations: sortedCombosByWinRate
    };
  } catch (err) {
    console.error("[Rule Learning Engine] calculateAdvancedLearningStats error:", err.message);
    return null;
  }
}
export {
  calculateAdvancedLearningStats,
  calculateHistoricalProbability,
  calculateJaccardSimilarity
};
