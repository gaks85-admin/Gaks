import { filterValidCompletedTrades, computeMetricsForSubset } from "./adaptive-learning-engine.js";
function evaluateAdaptiveExecution(input) {
  const reasonCodes = [];
  const pair = (input.pair || "EURUSD").toUpperCase();
  const timeframe = (input.timeframe || "M5").toUpperCase();
  const setup = (input.setup || "HYBRID").toUpperCase();
  const direction = (input.direction || "BUY").toUpperCase();
  const marketRegime = (input.marketRegime || "UNKNOWN").toUpperCase();
  const allTrades = filterValidCompletedTrades(input.completedTrades || []);
  const trades = input.userId ? allTrades.filter((t) => t.user_id === input.userId) : allTrades;
  let matchingTrades = [];
  let fallbackLevelUsed = "INSUFFICIENT";
  const l1 = trades.filter(
    (t) => (t.pair || "").toUpperCase() === pair && (t.timeframe || "").toUpperCase() === timeframe && (t.strategy_mode || t.setup || "").toUpperCase() === setup && (t.direction || "").toUpperCase() === direction && (t.market_regime || t.regime || "").toUpperCase() === marketRegime
  );
  if (l1.length >= 10) {
    matchingTrades = l1;
    fallbackLevelUsed = "PAIR+TF+SETUP+DIRECTION+REGIME";
  } else {
    const l2 = trades.filter(
      (t) => (t.pair || "").toUpperCase() === pair && (t.timeframe || "").toUpperCase() === timeframe && (t.strategy_mode || t.setup || "").toUpperCase() === setup && (t.direction || "").toUpperCase() === direction
    );
    if (l2.length >= 10) {
      matchingTrades = l2;
      fallbackLevelUsed = "PAIR+TF+SETUP+DIRECTION";
    } else {
      const l3 = trades.filter(
        (t) => (t.pair || "").toUpperCase() === pair && (t.timeframe || "").toUpperCase() === timeframe && (t.strategy_mode || t.setup || "").toUpperCase() === setup
      );
      if (l3.length >= 10) {
        matchingTrades = l3;
        fallbackLevelUsed = "PAIR+TF+SETUP";
      } else {
        const l4 = trades.filter(
          (t) => (t.pair || "").toUpperCase() === pair && (t.timeframe || "").toUpperCase() === timeframe
        );
        if (l4.length >= 10) {
          matchingTrades = l4;
          fallbackLevelUsed = "PAIR+TF";
        } else {
          const l5 = trades.filter((t) => (t.pair || "").toUpperCase() === pair);
          if (l5.length >= 10) {
            matchingTrades = l5;
            fallbackLevelUsed = "PAIR";
          } else {
            if (trades.length >= 15) {
              matchingTrades = trades;
              fallbackLevelUsed = "GLOBAL_USER";
            } else {
              matchingTrades = trades;
              fallbackLevelUsed = "INSUFFICIENT";
            }
          }
        }
      }
    }
  }
  const metrics = computeMetricsForSubset(matchingTrades);
  const sampleSize = metrics.totalTrades;
  const expectancyR = metrics.expectancyR;
  let historicalSupport = "INSUFFICIENT";
  if (sampleSize >= 30) {
    historicalSupport = expectancyR >= 0.3 ? "STRONG" : expectancyR >= 0 ? "MODERATE" : "WEAK";
  } else if (sampleSize >= 15) {
    historicalSupport = expectancyR >= 0.2 ? "STRONG" : expectancyR >= 0 ? "MODERATE" : "WEAK";
  } else if (sampleSize >= 10) {
    historicalSupport = "MODERATE";
  } else {
    historicalSupport = "INSUFFICIENT";
  }
  let timingScore = 80;
  if (input.entryPrice !== void 0 && input.structurePrice !== void 0 && input.atr !== void 0 && input.atr > 0) {
    const distancePipsOrUnits = Math.abs(input.entryPrice - input.structurePrice);
    const atrMultiple = distancePipsOrUnits / input.atr;
    if (atrMultiple > 2) {
      timingScore -= 30;
      reasonCodes.push("EXCESSIVE_ATR_EXPANSION_OR_CHASING");
    } else if (atrMultiple > 1.5) {
      timingScore -= 15;
      reasonCodes.push("EXTENDED_ENTRY_DISTANCE");
    } else {
      timingScore += 5;
      reasonCodes.push("GOOD_STRUCTURAL_PROXIMITY");
    }
  }
  if (input.candleBodySize !== void 0 && input.averageCandleBody !== void 0 && input.averageCandleBody > 0) {
    const expansionRatio = input.candleBodySize / input.averageCandleBody;
    if (expansionRatio > 2.5) {
      timingScore -= 20;
      reasonCodes.push("EXHAUSTION_CANDLE_VOLATILITY");
    } else if (expansionRatio < 0.3) {
      timingScore -= 10;
      reasonCodes.push("LOW_MOMENTUM_CANDLE");
    }
  }
  if (sampleSize >= 10) {
    if (expectancyR < -0.2) {
      timingScore -= 20;
      reasonCodes.push("POOR_HISTORICAL_EXECUTION_EXPECTANCY");
    } else if (expectancyR > 0.4) {
      timingScore += 10;
      reasonCodes.push("STRONG_HISTORICAL_EXECUTION_EXPECTANCY");
    }
  }
  if (input.riskGovernor && input.riskGovernor.decision === "RESTRICT") {
    timingScore -= 15;
    reasonCodes.push("RISK_GOVERNOR_RESTRICTION");
  }
  if (input.adaptiveQuality && input.adaptiveQuality.decision === "RESTRICT") {
    timingScore -= 15;
    reasonCodes.push("ADAPTIVE_QUALITY_RESTRICTION");
  }
  timingScore = Math.max(0, Math.min(100, timingScore));
  let timingQuality = "FAIR";
  if (timingScore >= 75) {
    timingQuality = "GOOD";
  } else if (timingScore >= 60) {
    timingQuality = "FAIR";
  } else {
    timingQuality = "POOR";
  }
  let status = "EXECUTE";
  if (timingScore < 50 || reasonCodes.includes("EXCESSIVE_ATR_EXPANSION_OR_CHASING")) {
    status = "NO_TRADE";
  } else if (timingScore < 65) {
    status = "WAIT";
  } else {
    status = "EXECUTE";
  }
  const explanation = `Execution Score: ${timingScore}/100 (${timingQuality}), Historical Support: ${historicalSupport} (sample: ${sampleSize}, expectancy: ${expectancyR.toFixed(2)}R), Hierarchy: ${fallbackLevelUsed}, Reasons: ${reasonCodes.join(", ") || "NONE"}`;
  console.log(`[Adaptive Execution] Evaluated ${pair} ${timeframe} ${setup} ${direction}: Status=${status}, Score=${timingScore}, Timing=${timingQuality}, Support=${historicalSupport}`);
  return {
    status,
    executionScore: timingScore,
    reasonCodes,
    timingQuality,
    historicalSupport,
    fallbackLevelUsed,
    explanation
  };
}
export {
  evaluateAdaptiveExecution
};
