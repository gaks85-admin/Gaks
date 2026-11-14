import { filterValidCompletedTrades, computeMetricsForSubset } from "./adaptive-learning-engine.js";
function evaluateClosedLoopCalibration(input) {
  const reasonCodes = [];
  const userId = input.userId;
  const pair = (input.pair || "EURUSD").toUpperCase();
  const timeframe = (input.timeframe || "M5").toUpperCase();
  const setup = (input.setup || "HYBRID").toUpperCase();
  const direction = (input.direction || "BUY").toUpperCase();
  const marketRegime = (input.marketRegime || "UNKNOWN").toUpperCase();
  const allTrades = filterValidCompletedTrades(input.completedTrades || []);
  const userTrades = userId ? allTrades.filter((t) => t.user_id === userId) : allTrades;
  let matchingTrades = [];
  let fallbackLevel = "INSUFFICIENT";
  const l1 = userTrades.filter(
    (t) => (t.pair || t.symbol || "").toUpperCase() === pair && (t.timeframe || t.selected_timeframe || "").toUpperCase() === timeframe && (t.strategy_mode || t.setup || "").toUpperCase() === setup && (t.direction || t.signal || "").toUpperCase() === direction && (t.market_regime || t.regime || "").toUpperCase() === marketRegime
  );
  if (l1.length >= 10) {
    matchingTrades = l1;
    fallbackLevel = "PAIR+TF+SETUP+DIRECTION+REGIME";
  } else {
    const l2 = userTrades.filter(
      (t) => (t.pair || t.symbol || "").toUpperCase() === pair && (t.timeframe || t.selected_timeframe || "").toUpperCase() === timeframe && (t.strategy_mode || t.setup || "").toUpperCase() === setup && (t.direction || t.signal || "").toUpperCase() === direction
    );
    if (l2.length >= 10) {
      matchingTrades = l2;
      fallbackLevel = "PAIR+TF+SETUP+DIRECTION";
    } else {
      const l3 = userTrades.filter(
        (t) => (t.pair || t.symbol || "").toUpperCase() === pair && (t.timeframe || t.selected_timeframe || "").toUpperCase() === timeframe && (t.strategy_mode || t.setup || "").toUpperCase() === setup
      );
      if (l3.length >= 10) {
        matchingTrades = l3;
        fallbackLevel = "PAIR+TF+SETUP";
      } else {
        const l4 = userTrades.filter(
          (t) => (t.pair || t.symbol || "").toUpperCase() === pair && (t.timeframe || t.selected_timeframe || "").toUpperCase() === timeframe
        );
        if (l4.length >= 10) {
          matchingTrades = l4;
          fallbackLevel = "PAIR+TF";
        } else {
          const l5 = userTrades.filter((t) => (t.pair || t.symbol || "").toUpperCase() === pair);
          if (l5.length >= 10) {
            matchingTrades = l5;
            fallbackLevel = "PAIR";
          } else {
            matchingTrades = userTrades;
            fallbackLevel = userTrades.length >= 10 ? "GLOBAL_USER" : "INSUFFICIENT";
          }
        }
      }
    }
  }
  const tradeCount = matchingTrades.length;
  let evidenceLevel = "INSUFFICIENT";
  if (tradeCount >= 30) evidenceLevel = "STRONG";
  else if (tradeCount >= 20) evidenceLevel = "MODERATE";
  else if (tradeCount >= 10) evidenceLevel = "OBSERVATIONAL";
  else evidenceLevel = "INSUFFICIENT";
  if (tradeCount === 0) {
    reasonCodes.push("ZERO_COMPLETED_TRADES");
    const emptyMetrics = {
      tradeCount: 0,
      wins: 0,
      losses: 0,
      breakevens: 0,
      winRate: 0,
      averageWinR: 0,
      averageLossR: 0,
      expectancyR: 0,
      totalRealizedR: 0,
      maximumConsecutiveLosses: 0,
      maximumConsecutiveWins: 0,
      recentExpectancy: 0,
      previousExpectancy: 0,
      deterioration: false,
      recovery: false,
      expectedVsRealizedRatio: null
    };
    return {
      overallReliability: "INSUFFICIENT",
      confidenceReliability: "INSUFFICIENT",
      qualityReliability: "INSUFFICIENT",
      executionReliability: "INSUFFICIENT",
      setupReliability: "INSUFFICIENT",
      regimeReliability: "INSUFFICIENT",
      pairReliability: "INSUFFICIENT",
      directionReliability: "INSUFFICIENT",
      recommendedAction: "NORMAL",
      evidenceLevel: "INSUFFICIENT",
      reasonCodes,
      metrics: emptyMetrics,
      tradeCount: 0,
      expectancyR: 0,
      winRate: 0,
      drawdown: 0,
      consecutiveLosses: 0,
      explanation: "[Closed Loop Calibration] Insufficient completed trade data (0 trades)."
    };
  }
  const subsetMetrics = computeMetricsForSubset(matchingTrades);
  const wins = matchingTrades.filter((t) => (t.outcome || "").toUpperCase() === "WIN");
  const losses = matchingTrades.filter((t) => (t.outcome || "").toUpperCase() === "LOSS");
  const breakevens = matchingTrades.filter((t) => (t.outcome || "").toUpperCase() === "BREAKEVEN");
  const winRate = subsetMetrics.winRate;
  const expectancyR = subsetMetrics.expectancyR;
  const avgWinR = wins.length > 0 ? wins.reduce((sum, t) => sum + Math.max(0, Number(t.rr_achieved || 1)), 0) / wins.length : 0;
  const avgLossR = losses.length > 0 ? losses.reduce((sum, t) => sum + Math.abs(Math.min(0, Number(t.rr_achieved || -1))), 0) / losses.length : 1;
  const chronoTrades = [...matchingTrades].sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let curWins = 0;
  let curLosses = 0;
  let peakR = 0;
  let curR = 0;
  let maxDrawdownR = 0;
  for (const t of chronoTrades) {
    const outcome = (t.outcome || "").toUpperCase();
    let rVal = Number(t.rr_achieved);
    if (isNaN(rVal)) rVal = outcome === "WIN" ? 1 : outcome === "LOSS" ? -1 : 0;
    curR += rVal;
    if (curR > peakR) peakR = curR;
    const dd = peakR - curR;
    if (dd > maxDrawdownR) maxDrawdownR = dd;
    if (outcome === "WIN") {
      curWins++;
      curLosses = 0;
      if (curWins > maxConsecutiveWins) maxConsecutiveWins = curWins;
    } else if (outcome === "LOSS") {
      curLosses++;
      curWins = 0;
      if (curLosses > maxConsecutiveLosses) maxConsecutiveLosses = curLosses;
    } else {
      curWins = 0;
      curLosses = 0;
    }
  }
  const splitIndex = Math.max(1, Math.floor(chronoTrades.length * 0.7));
  const olderTrades = chronoTrades.slice(0, splitIndex);
  const recentTrades = chronoTrades.slice(splitIndex);
  const olderMetrics = computeMetricsForSubset(olderTrades);
  const recentMetrics = computeMetricsForSubset(recentTrades);
  const previousExpectancy = olderMetrics.expectancyR;
  const recentExpectancy = recentMetrics.expectancyR;
  const deterioration = recentExpectancy < previousExpectancy - 0.2 && recentExpectancy < -0.1;
  const recovery = olderExpectancyIsNegative(previousExpectancy) && recentExpectancy > previousExpectancy + 0.2 && recentExpectancy >= 0;
  function olderExpectancyIsNegative(exp) {
    return exp < -0.1;
  }
  let confidenceReliability = "INSUFFICIENT";
  const candidateConf = input.confidence ?? 75;
  const confBucketTrades = userTrades.filter((t) => {
    const conf = t.confidence ?? t.quality_score ?? 75;
    return conf >= Math.floor(candidateConf / 10) * 10 && conf < Math.floor(candidateConf / 10) * 10 + 10;
  });
  if (confBucketTrades.length >= 5) {
    const bucketMetrics = computeMetricsForSubset(confBucketTrades);
    if (candidateConf >= 70 && bucketMetrics.winRate < 40) {
      confidenceReliability = "UNRELIABLE";
      reasonCodes.push("CONFIDENCE_POORLY_CALIBRATED");
    } else if (bucketMetrics.expectancyR >= 0.2) {
      confidenceReliability = "HIGH";
    } else if (bucketMetrics.expectancyR >= 0) {
      confidenceReliability = "MODERATE";
    } else {
      confidenceReliability = "LOW";
    }
  }
  let qualityReliability = "INSUFFICIENT";
  const candQuality = input.qualityScore ?? input.confidence ?? 75;
  const qualBucketTrades = userTrades.filter((t) => {
    const q = t.quality_score ?? t.confidence ?? 75;
    return q >= Math.floor(candQuality / 10) * 10 && q < Math.floor(candQuality / 10) * 10 + 10;
  });
  if (qualBucketTrades.length >= 5) {
    const qMetrics = computeMetricsForSubset(qualBucketTrades);
    if (candQuality >= 80 && qMetrics.winRate >= 60) {
      qualityReliability = "HIGH";
    } else if (qMetrics.expectancyR < -0.15) {
      qualityReliability = "UNRELIABLE";
      reasonCodes.push("HIGH_QUALITY_SCORE_NEGATIVE_EXPECTANCY");
    } else {
      qualityReliability = "MODERATE";
    }
  }
  let executionReliability = "INSUFFICIENT";
  const chasingTrades = userTrades.filter((t) => t.is_chasing || t.execution_score && t.execution_score < 60);
  if (chasingTrades.length >= 5) {
    const chasingMetrics = computeMetricsForSubset(chasingTrades);
    if (chasingMetrics.expectancyR < -0.1) {
      executionReliability = "UNRELIABLE";
      reasonCodes.push("ENTRY_CHASING_CORRELATES_WITH_LOSSES");
    } else {
      executionReliability = "MODERATE";
    }
  } else if (tradeCount >= 10) {
    executionReliability = "MODERATE";
  }
  let setupReliability = evidenceLevel === "STRONG" ? expectancyR > 0 ? "HIGH" : "LOW" : evidenceLevel === "MODERATE" ? "MODERATE" : "INSUFFICIENT";
  let pairReliability = setupReliability;
  let regimeReliability = setupReliability;
  let directionReliability = setupReliability;
  const candidateExpectedR = input.expectedRR ?? 1.5;
  const expectedVsRealizedRatio = candidateExpectedR > 0 && avgWinR > 0 ? Number((avgWinR / candidateExpectedR).toFixed(2)) : null;
  let recommendedAction = "NORMAL";
  let overallReliability = "MODERATE";
  if (evidenceLevel === "INSUFFICIENT") {
    recommendedAction = "NORMAL";
    overallReliability = "INSUFFICIENT";
    reasonCodes.push("INSUFFICIENT_CALIBRATION_EVIDENCE");
  } else if (evidenceLevel === "OBSERVATIONAL") {
    overallReliability = "LOW";
    if (expectancyR < -0.2) {
      recommendedAction = "SELECTIVE";
      reasonCodes.push("OBSERVATIONAL_NEGATIVE_EXPECTANCY");
    } else {
      recommendedAction = "NORMAL";
    }
  } else if (evidenceLevel === "MODERATE") {
    overallReliability = "MODERATE";
    if (expectancyR <= -0.35) {
      recommendedAction = "NO_TRADE";
      reasonCodes.push("SEVERE_NEGATIVE_EXPECTANCY");
    } else if (expectancyR < -0.15 || deterioration) {
      recommendedAction = "RESTRICT";
      reasonCodes.push("NEGATIVE_EXPECTANCY_RESTRICTED");
    } else if (expectancyR >= 0.2) {
      recommendedAction = "NORMAL";
    } else {
      recommendedAction = "SELECTIVE";
    }
  } else {
    overallReliability = "HIGH";
    if (expectancyR <= -0.35) {
      recommendedAction = "NO_TRADE";
      reasonCodes.push("SEVERE_NEGATIVE_EXPECTANCY");
    } else if (expectancyR < -0.15 || deterioration) {
      recommendedAction = "RESTRICT";
      reasonCodes.push("STRONG_NEGATIVE_EXPECTANCY_RESTRICTED");
    } else if (expectancyR >= 0.2) {
      recommendedAction = "NORMAL";
    } else {
      recommendedAction = "SELECTIVE";
    }
  }
  if (deterioration) reasonCodes.push("DETERIORATING_PERFORMANCE_DETECTED");
  if (recovery) reasonCodes.push("RECOVERY_PERFORMANCE_DETECTED");
  const metrics = {
    tradeCount,
    wins: wins.length,
    losses: losses.length,
    breakevens: breakevens.length,
    winRate,
    averageWinR: Number(avgWinR.toFixed(2)),
    averageLossR: Number(avgLossR.toFixed(2)),
    expectancyR,
    totalRealizedR: subsetMetrics.totalR,
    maximumConsecutiveLosses: maxConsecutiveLosses,
    maximumConsecutiveWins: maxConsecutiveWins,
    recentExpectancy,
    previousExpectancy,
    deterioration,
    recovery,
    expectedVsRealizedRatio
  };
  const explanation = `[Closed Loop Calibration] User: <isolated>, Scope: ${pair} ${timeframe} ${setup} ${direction} ${marketRegime}. Action: ${recommendedAction}, Evidence: ${evidenceLevel}, Trades: ${tradeCount}, WinRate: ${winRate}%, Expectancy: ${expectancyR}R, Fallback: ${fallbackLevel}`;
  console.log(explanation);
  return {
    overallReliability,
    confidenceReliability,
    qualityReliability,
    executionReliability,
    setupReliability,
    regimeReliability,
    pairReliability,
    directionReliability,
    recommendedAction,
    evidenceLevel,
    reasonCodes,
    metrics,
    tradeCount,
    expectancyR,
    winRate,
    drawdown: Number(maxDrawdownR.toFixed(2)),
    consecutiveLosses: maxConsecutiveLosses,
    explanation
  };
}
export {
  evaluateClosedLoopCalibration
};
