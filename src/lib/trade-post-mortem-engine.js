import { calculatePipsDistance } from "./active-trade-monitor.js";
function diagnoseLossOutcome(input) {
  const pair = (input.pair || "EURUSD").toUpperCase().replace("/", "").trim();
  const dir = (input.direction || "BUY").toUpperCase();
  const isBuy = dir === "BUY" || dir === "LONG";
  const entry = Number(input.entryPrice) || 1;
  const sl = input.stopLoss ? Number(input.stopLoss) : isBuy ? entry * 0.995 : entry * 1.005;
  const tp = input.takeProfit ? Number(input.takeProfit) : isBuy ? entry * 1.01 : entry * 0.99;
  const exit = Number(input.exitPrice) || sl;
  const slPips = calculatePipsDistance(pair, entry, sl);
  const tpPips = calculatePipsDistance(pair, entry, tp);
  const plannedRR = slPips > 0 ? Number((tpPips / slPips).toFixed(2)) : 2;
  let durationMinutes = 30;
  if (input.openedAt && input.closedAt) {
    const startMs = new Date(input.openedAt).getTime();
    const endMs = new Date(input.closedAt).getTime();
    if (!isNaN(startMs) && !isNaN(endMs) && endMs >= startMs) {
      durationMinutes = Math.round((endMs - startMs) / (1e3 * 60));
    }
  }
  let mfePips = 0;
  let mfeR = 0;
  if (input.highestPriceReached !== void 0 && input.highestPriceReached !== null && input.lowestPriceReached !== void 0 && input.lowestPriceReached !== null) {
    if (isBuy) {
      mfePips = Math.max(0, calculatePipsDistance(pair, entry, input.highestPriceReached));
    } else {
      mfePips = Math.max(0, calculatePipsDistance(pair, entry, input.lowestPriceReached));
    }
  } else if (Array.isArray(input.candleData) && input.candleData.length > 0) {
    let extremeInFavor = entry;
    for (const c of input.candleData) {
      const high = Number(c.high || c.close);
      const low = Number(c.low || c.close);
      if (isBuy && high > extremeInFavor) extremeInFavor = high;
      if (!isBuy && low < extremeInFavor) extremeInFavor = low;
    }
    mfePips = Math.max(0, calculatePipsDistance(pair, entry, extremeInFavor));
  } else {
    if (durationMinutes > 90) {
      mfePips = Number((slPips * 0.4).toFixed(1));
    } else {
      mfePips = Number((slPips * 0.1).toFixed(1));
    }
  }
  if (slPips > 0) {
    mfeR = Number((mfePips / slPips).toFixed(2));
  }
  const cleanPair = pair.replace(/[^A-Z0-9]/g, "");
  const isGoldOrIndex = cleanPair.includes("XAU") || cleanPair.includes("GOLD") || cleanPair.includes("XAG") || cleanPair.includes("SILVER") || cleanPair.includes("US30") || cleanPair.includes("NAS") || cleanPair.includes("NDX") || cleanPair.includes("US100") || cleanPair.includes("SPX") || cleanPair.includes("US500") || cleanPair.includes("US2000") || cleanPair.includes("GER") || cleanPair.includes("DE30") || cleanPair.includes("DE40") || cleanPair.includes("UK100") || cleanPair.includes("JP225") || cleanPair.includes("HK50") || cleanPair.includes("BTC") || cleanPair.includes("ETH") || cleanPair.includes("SOL") || cleanPair.includes("XRP") || cleanPair.includes("LTC") || cleanPair.endsWith("USDT") || cleanPair.endsWith("USDC") || cleanPair.endsWith("BUSD");
  const minThresholdPips = isGoldOrIndex ? 18 : 7;
  const normalThresholdPips = isGoldOrIndex ? 45 : 18;
  let tightnessAssessment = "OPTIMAL";
  if (slPips < minThresholdPips) {
    tightnessAssessment = "EXCESSIVELY_TIGHT";
  } else if (slPips > normalThresholdPips * 1.8) {
    tightnessAssessment = "WIDE";
  }
  let rootCause = "PREMATURE_ENTRY";
  let rootCauseTitle = "Premature Entry / Early Adverse Reaction";
  let summary = "";
  let preventiveAdjustment = "";
  const keyLessons = [];
  if (mfeR >= 1 || tpPips > 0 && mfePips >= tpPips * 0.6) {
    rootCause = "NEAR_TP_REVERSAL";
    rootCauseTitle = "Near-Target Reversal (Profit Giveback)";
    summary = `The trade ran strongly into positive territory (+${mfeR}R / +${mfePips} pips) towards the ${plannedRR}R target, but failed to reach full Take Profit before sharply reversing back into the Stop Loss.`;
    keyLessons.push(`Price achieved significant momentum (+${mfeR}R) but suffered complete retracement due to unmanaged profit.`);
    keyLessons.push("Market encountered resistance/support before TP, exhausting initial momentum.");
    preventiveAdjustment = `Activate Breakeven Lock at +1.0R and implement partial profit-taking or trailing stop when price traverses 60% of the target distance.`;
  } else if (tightnessAssessment === "EXCESSIVELY_TIGHT") {
    rootCause = "TIGHT_SL_NOISE_SWEEP";
    rootCauseTitle = "Stop Loss Placed in Market Noise Band";
    summary = `The Stop Loss distance of only ${slPips} pips was too tight for prevailing volatility on ${pair}. Normal spread fluctuations or liquidity sweeps triggered the exit before the trade could develop.`;
    keyLessons.push(`Stop Loss (${slPips} pips) was placed within average intra-session noise range.`);
    keyLessons.push("Stop placement lacked sufficient structural buffer beyond the nearest swing point.");
    preventiveAdjustment = `Enforce a minimum stop buffer of at least 1.5x ATR (${minThresholdPips} pips min for ${pair}) behind structural swing pivots.`;
  } else if (durationMinutes <= 12 && mfeR < 0.2) {
    rootCause = "VOLATILITY_EXPANSION";
    rootCauseTitle = "Rapid Volatility Spike / Momentum Surge";
    summary = `Trade hit Stop Loss within ${durationMinutes} minutes of opening, indicating an aggressive adverse momentum expansion or high-impact news impulse.`;
    keyLessons.push("Trade was initiated immediately prior to or during an expansion spike.");
    keyLessons.push("Execution timing coincided with strong opposing order flow.");
    preventiveAdjustment = `Filter setups against high-impact economic events and enforce wait period during extreme spread widening.`;
  } else if (mfeR <= 0.25) {
    rootCause = "PREMATURE_ENTRY";
    rootCauseTitle = "Premature Entry Before Retest Confirmation";
    summary = `Price experienced immediate adverse excursion right after entry (max favorable run was only +${mfeR}R / ${mfePips} pips). The entry triggered before sellers/buyers finished their sweep.`;
    keyLessons.push("Entry was taken prematurely before the candle closed with retest rejection.");
    keyLessons.push("Opposing momentum had not fully exhausted prior to signal execution.");
    preventiveAdjustment = `Enforce strict break-and-retest candle close confirmation rather than entering on early zone touches.`;
  } else {
    rootCause = "STRUCTURE_INVALIDATION";
    rootCauseTitle = "Market Structure Invalidation";
    summary = `The structural bias failed as the market printed an opposing structure break against the position, validating higher timeframe opposing pressure.`;
    keyLessons.push(`The local zone failed to hold, transitioning from support to resistance (or vice-versa).`);
    keyLessons.push("Higher timeframe flow overrode the lower timeframe signal confluences.");
    preventiveAdjustment = `Require HTF trend alignment confirmation before entering counter-trend pullbacks.`;
  }
  const matchedRules = Array.isArray(input.matchedRules) ? input.matchedRules : [];
  let suspectRule = null;
  if (matchedRules.length > 0) {
    const highRiskEarlyRules = ["breakout", "rsi_oversold", "rsi_overbought", "trendline_breakout"];
    suspectRule = matchedRules.find((r) => highRiskEarlyRules.some((hr) => r.toLowerCase().includes(hr))) || matchedRules[0];
  }
  return {
    rootCause,
    rootCauseTitle,
    summary,
    mfeR,
    mfePips,
    slDistancePips: slPips,
    tpDistancePips: tpPips,
    plannedRR,
    tightnessAssessment,
    durationMinutes,
    keyLessons,
    preventiveAdjustment,
    ruleAttribution: {
      activeRules: matchedRules,
      suspectRule
    },
    recommendedSafeguards: {
      minimumSlBufferPips: minThresholdPips,
      requireRetestConfirmation: rootCause === "PREMATURE_ENTRY" || rootCause === "TIGHT_SL_NOISE_SWEEP",
      requireHtfAlignment: rootCause === "STRUCTURE_INVALIDATION",
      profitProtectionThresholdR: rootCause === "NEAR_TP_REVERSAL" ? 1 : 1.5
    }
  };
}
function aggregateLossDiagnostics(trades) {
  if (!Array.isArray(trades) || trades.length === 0) {
    return {
      totalLossesAnalyzed: 0,
      totalWins: 0,
      slToTpRatio: 0,
      breakdownByCause: {
        PREMATURE_ENTRY: 0,
        NEAR_TP_REVERSAL: 0,
        TIGHT_SL_NOISE_SWEEP: 0,
        LIQUIDITY_SWEEP: 0,
        STRUCTURE_INVALIDATION: 0,
        VOLATILITY_EXPANSION: 0,
        COUNTER_TREND_EXHAUSTION: 0,
        UNFAVORABLE_RISK_REWARD: 0
      },
      topFailureCauses: [],
      averageSlDistancePips: 0,
      nearTpReversalsCount: 0,
      prematureEntriesCount: 0,
      tightSlHitsCount: 0,
      keyActionableLessons: ["No completed trade losses recorded yet to diagnose."],
      recentPostMortems: []
    };
  }
  const losses = trades.filter((t) => {
    const out = (t.outcome || "").toUpperCase();
    return out === "LOSS" || out === "BROKER_REALIZED_LOSS" || out === "STOP_LOSS";
  });
  const wins = trades.filter((t) => {
    const out = (t.outcome || "").toUpperCase();
    return out === "WIN" || out === "BROKER_REALIZED_WIN" || out === "TAKE_PROFIT";
  });
  const breakdownByCause = {
    PREMATURE_ENTRY: 0,
    NEAR_TP_REVERSAL: 0,
    TIGHT_SL_NOISE_SWEEP: 0,
    LIQUIDITY_SWEEP: 0,
    STRUCTURE_INVALIDATION: 0,
    VOLATILITY_EXPANSION: 0,
    COUNTER_TREND_EXHAUSTION: 0,
    UNFAVORABLE_RISK_REWARD: 0
  };
  let totalSlPips = 0;
  const recentPostMortems = [];
  const allLessons = [];
  losses.forEach((t) => {
    let pm = null;
    if (t.decision_snapshot?.loss_post_mortem) {
      pm = t.decision_snapshot.loss_post_mortem;
    } else {
      pm = diagnoseLossOutcome({
        pair: t.pair || t.symbol || "EURUSD",
        timeframe: t.timeframe,
        direction: t.direction || "BUY",
        entryPrice: Number(t.entry_price || t.entryPrice),
        stopLoss: t.stop_loss ? Number(t.stop_loss) : null,
        takeProfit: t.take_profit ? Number(t.take_profit) : null,
        exitPrice: Number(t.exit_price || t.exitPrice || t.stop_loss || t.entry_price),
        openedAt: t.opened_at || t.created_at,
        closedAt: t.closed_at || t.created_at,
        matchedRules: Array.isArray(t.matched_rules) ? t.matched_rules : [],
        failedRules: Array.isArray(t.failed_rules) ? t.failed_rules : []
      });
    }
    if (pm) {
      breakdownByCause[pm.rootCause] = (breakdownByCause[pm.rootCause] || 0) + 1;
      totalSlPips += pm.slDistancePips;
      allLessons.push(...pm.keyLessons);
      if (recentPostMortems.length < 5) {
        recentPostMortems.push({
          pair: t.pair || t.symbol || "EURUSD",
          direction: t.direction || "BUY",
          rootCause: pm.rootCause,
          rootCauseTitle: pm.rootCauseTitle,
          summary: pm.summary,
          mfeR: pm.mfeR,
          slPips: pm.slDistancePips,
          closedAt: t.closed_at || t.created_at || (/* @__PURE__ */ new Date()).toISOString(),
          lesson: pm.preventiveAdjustment
        });
      }
    }
  });
  const totalLosses = losses.length;
  const avgSlPips = totalLosses > 0 ? Number((totalSlPips / totalLosses).toFixed(1)) : 0;
  const slToTpRatio = wins.length > 0 ? Number((totalLosses / wins.length).toFixed(2)) : totalLosses;
  const topFailureCauses = Object.keys(breakdownByCause).map((cause) => {
    const count = breakdownByCause[cause] || 0;
    let title = "General Market Shift";
    if (cause === "PREMATURE_ENTRY") title = "Premature Entry (No Retest)";
    else if (cause === "NEAR_TP_REVERSAL") title = "Near-TP Reversal (Profit Giveback)";
    else if (cause === "TIGHT_SL_NOISE_SWEEP") title = "Stop Loss Inside Noise Band";
    else if (cause === "STRUCTURE_INVALIDATION") title = "Market Structure Invalidation";
    else if (cause === "VOLATILITY_EXPANSION") title = "Volatility Surge / News Spike";
    else if (cause === "LIQUIDITY_SWEEP") title = "Liquidity Sweep at Swing Point";
    else if (cause === "COUNTER_TREND_EXHAUSTION") title = "Counter-Trend Pullback Failure";
    return {
      cause,
      title,
      count,
      percentage: totalLosses > 0 ? Math.round(count / totalLosses * 100) : 0
    };
  }).filter((item) => item.count > 0).sort((a, b) => b.count - a.count);
  const keyActionableLessons = Array.from(new Set(allLessons)).slice(0, 4);
  if (keyActionableLessons.length === 0 && totalLosses > 0) {
    keyActionableLessons.push("Ensure Stop Loss placement respects 1.5x ATR structural buffer beyond swing pivots.");
    keyActionableLessons.push("Enforce break-and-retest candle close confirmation prior to position execution.");
  }
  return {
    totalLossesAnalyzed: totalLosses,
    totalWins: wins.length,
    slToTpRatio,
    breakdownByCause,
    topFailureCauses,
    averageSlDistancePips: avgSlPips,
    nearTpReversalsCount: breakdownByCause.NEAR_TP_REVERSAL || 0,
    prematureEntriesCount: breakdownByCause.PREMATURE_ENTRY || 0,
    tightSlHitsCount: breakdownByCause.TIGHT_SL_NOISE_SWEEP || 0,
    keyActionableLessons,
    recentPostMortems
  };
}
function checkRecentSlMitigationForPair(pair, direction, userTrades) {
  const cleanPair = (pair || "").toUpperCase().replace("/", "").trim();
  const dir = (direction || "BUY").toUpperCase();
  const pairLosses = (userTrades || []).filter((t) => {
    const p = (t.pair || t.symbol || "").toUpperCase().replace("/", "").trim();
    const d = (t.direction || "BUY").toUpperCase();
    const out = (t.outcome || "").toUpperCase();
    return p === cleanPair && d === dir && (out === "LOSS" || out === "STOP_LOSS");
  });
  if (pairLosses.length === 0) {
    return {
      hasRecentLoss: false,
      recommendedBufferPips: 0,
      requireStrictRetest: false,
      mitigationNotice: null
    };
  }
  const latestLoss = pairLosses[pairLosses.length - 1];
  const postMortem = latestLoss.decision_snapshot?.loss_post_mortem || diagnoseLossOutcome({
    pair: cleanPair,
    direction: dir,
    entryPrice: Number(latestLoss.entry_price || latestLoss.entryPrice || 1),
    stopLoss: latestLoss.stop_loss ? Number(latestLoss.stop_loss) : null,
    takeProfit: latestLoss.take_profit ? Number(latestLoss.take_profit) : null,
    exitPrice: Number(latestLoss.exit_price || latestLoss.exitPrice || latestLoss.stop_loss || 1),
    openedAt: latestLoss.opened_at,
    closedAt: latestLoss.closed_at
  });
  return {
    hasRecentLoss: true,
    recommendedBufferPips: postMortem.recommendedSafeguards.minimumSlBufferPips,
    requireStrictRetest: postMortem.recommendedSafeguards.requireRetestConfirmation,
    mitigationNotice: `[AI SL-LEARNING SHIELD] Previous ${cleanPair} ${dir} trade hit SL due to "${postMortem.rootCauseTitle}". Enforcing: ${postMortem.preventiveAdjustment}`
  };
}
export {
  aggregateLossDiagnostics,
  checkRecentSlMitigationForPair,
  diagnoseLossOutcome
};
