function calculateSMA(values) {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}
function calculateEMA(candles, period) {
  if (candles.length < period) return candles[candles.length - 1]?.close || 0;
  let ema = calculateSMA(candles.slice(0, period).map((c) => c.close));
  const k = 2 / (period + 1);
  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return ema;
}
function calculateATR(candles, period = 14) {
  if (candles.length < period + 1) return 1e-3;
  const trs = [];
  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trs.push(tr);
  }
  const recentTRs = trs.slice(-period);
  return calculateSMA(recentTRs);
}
function classifyRegime(history) {
  if (!history || history.length < 20) {
    return {
      trend: "RANGING",
      volatility: "NORMAL_VOLATILITY",
      atrValue: 1e-3,
      ema20: 0,
      ema50: 0
    };
  }
  const ema20 = calculateEMA(history, 20);
  const ema50 = calculateEMA(history, 50);
  const atr = calculateATR(history, 14);
  const longTermATR = calculateATR(history, 50);
  let trend = "RANGING";
  const diffPercent = Math.abs((ema20 - ema50) / ema50) * 100;
  if (diffPercent > 0.05) {
    if (ema20 > ema50) {
      trend = "BULLISH_TREND";
    } else {
      trend = "BEARISH_TREND";
    }
  }
  let volatility = "NORMAL_VOLATILITY";
  if (longTermATR > 0) {
    const ratio = atr / longTermATR;
    if (ratio > 1.25) {
      volatility = "HIGH_VOLATILITY";
    } else if (ratio < 0.75) {
      volatility = "LOW_VOLATILITY";
    }
  }
  return {
    trend,
    volatility,
    atrValue: atr,
    ema20,
    ema50
  };
}
function analyzeMarketRegimes(trades, candles, minSampleThreshold = 30) {
  const regimeGroups = {};
  for (const trade of trades) {
    const entryTs = new Date(trade.entryTimestamp).getTime();
    const historyIndex = candles.findIndex((c) => new Date(c.timestamp).getTime() >= entryTs);
    const sliceEnd = historyIndex > 0 ? historyIndex : candles.length;
    const history = candles.slice(0, sliceEnd);
    const regime = classifyRegime(history);
    const key = `${regime.trend}__${regime.volatility}`;
    if (!regimeGroups[key]) {
      regimeGroups[key] = [];
    }
    regimeGroups[key].push(trade);
  }
  const breakdown = {};
  let maxTradeCount = 0;
  let dominantRegime = "NONE";
  for (const [key, group] of Object.entries(regimeGroups)) {
    const [trend, volatility] = key.split("__");
    const totalTrades = group.length;
    if (totalTrades > maxTradeCount) {
      maxTradeCount = totalTrades;
      dominantRegime = key;
    }
    const wins = group.filter((t) => t.netPnL > 0);
    const losses = group.filter((t) => t.netPnL < 0);
    const grossProfit = wins.reduce((sum, t) => sum + t.netPnL, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.netPnL, 0));
    const netPnL = group.reduce((sum, t) => sum + t.netPnL, 0);
    const winRate = totalTrades > 0 ? wins.length / totalTrades * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0;
    const expectancy = totalTrades > 0 ? netPnL / totalTrades : 0;
    const p = totalTrades > 0 ? wins.length / totalTrades : 0;
    const standardError = totalTrades > 0 ? Math.sqrt(p * (1 - p) / totalTrades) * 100 : 0;
    const ciMargin = 1.96 * standardError;
    const ciLower = Math.max(0, winRate - ciMargin);
    const ciUpper = Math.min(100, winRate + ciMargin);
    const isStatisticallySignificant = totalTrades >= minSampleThreshold;
    const status = isStatisticallySignificant ? "VALID" : "INCONCLUSIVE";
    const statisticalSignificance = isStatisticallySignificant ? "STATISTICALLY_SUPPORTED" : "DESCRIPTIVE_ONLY_INCONCLUSIVE";
    const evaluationReason = isStatisticallySignificant ? `Sample size (${totalTrades} trades) meets or exceeds statistical threshold (${minSampleThreshold}). Conclusion is statistically supported.` : `INCONCLUSIVE: Sample size (${totalTrades} trades) is below statistical threshold (${minSampleThreshold}). Observations are descriptive only and carry high estimation uncertainty (SE: \xB1${standardError.toFixed(1)}%).`;
    breakdown[key] = {
      regimeKey: key,
      trend,
      volatility,
      totalTrades,
      winningTrades: wins.length,
      winRate,
      winRateStandardError: Number(standardError.toFixed(2)),
      confidenceInterval95: {
        lower: Number(ciLower.toFixed(2)),
        upper: Number(ciUpper.toFixed(2))
      },
      profitFactor,
      netPnL,
      maxDrawdown: 0,
      expectancy,
      status,
      statisticalSignificance,
      evaluationReason
    };
  }
  const statisticallySupportedRegimes = Object.values(breakdown).filter((r) => r.status === "VALID");
  const isPassed = statisticallySupportedRegimes.some((r) => r.netPnL > 0);
  return {
    regimeBreakdown: breakdown,
    dominantRegime,
    minSampleThreshold,
    isPassed,
    timestamp: (/* @__PURE__ */ new Date()).toISOString()
  };
}
export {
  analyzeMarketRegimes,
  classifyRegime
};
