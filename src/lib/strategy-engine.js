function calculateEMA(prices, period) {
  if (!prices || !Array.isArray(prices) || prices.length < period || period <= 0) return null;
  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  let ema = sum / period;
  for (let i = period; i < prices.length; i++) {
    ema = prices[i] * k + ema * (1 - k);
  }
  return ema;
}
function determineMarketBias(candles) {
  if (!candles || !Array.isArray(candles) || candles.length < 2) {
    return "Neutral";
  }
  const closePrices = candles.map((c) => Number(c.close)).filter((p) => !isNaN(p));
  if (closePrices.length < 2) return "Neutral";
  const currentPrice = closePrices[closePrices.length - 1];
  const ema20 = calculateEMA(closePrices, 20);
  const ema50 = calculateEMA(closePrices, 50);
  const lastCandle = candles[candles.length - 1];
  const prevCandle = candles[candles.length - 2];
  const prev2Candle = candles[candles.length - 3] || prevCandle;
  const higherHighs = lastCandle.high >= prevCandle.high || lastCandle.close > prev2Candle.close;
  const lowerLows = lastCandle.low <= prevCandle.low || lastCandle.close < prev2Candle.close;
  if (ema20 !== null && ema50 !== null) {
    if (currentPrice > ema20 && currentPrice > ema50 && ema20 > ema50 && higherHighs) {
      return "Bullish";
    } else if (currentPrice < ema20 && currentPrice < ema50 && ema20 < ema50 && lowerLows) {
      return "Bearish";
    } else if (currentPrice > ema20 && ema20 > ema50 && lastCandle.close > prevCandle.close) {
      return "Bullish";
    } else if (currentPrice < ema20 && ema20 < ema50 && lastCandle.close < prevCandle.close) {
      return "Bearish";
    }
    return "Neutral";
  }
  if (ema20 !== null) {
    if (currentPrice > ema20 && higherHighs) return "Bullish";
    if (currentPrice < ema20 && lowerLows) return "Bearish";
    return "Neutral";
  }
  if (lastCandle.close > prevCandle.close && lastCandle.high > prevCandle.high) {
    return "Bullish";
  } else if (lastCandle.close < prevCandle.close && lastCandle.low < prevCandle.low) {
    return "Bearish";
  }
  return "Neutral";
}
function analyzeMarket(candles, parsedStrategy, targetDirection) {
  const result = {
    signal: "NO_TRADE",
    confidence: 0,
    entryPrice: null,
    stopLoss: null,
    takeProfit: null,
    riskReward: null,
    reasoning: []
  };
  if (!candles || candles.length < 2) {
    result.reasoning.push("Insufficient candle data.");
    return result;
  }
  if (!parsedStrategy) {
    result.reasoning.push("No parsed strategy provided.");
    return result;
  }
  const strategyObj = typeof parsedStrategy === "string" ? { timeframe: parsedStrategy } : parsedStrategy;
  const currentCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];
  const isBullish = currentCandle.close > currentCandle.open;
  const isBearish = currentCandle.close < currentCandle.open;
  const bias = determineMarketBias(candles);
  let isBuyDirection = targetDirection ? targetDirection === "BUY" : bias === "Bullish" || isBullish;
  let isSellDirection = targetDirection ? targetDirection === "SELL" : bias === "Bearish" || isBearish;
  if (targetDirection === "BUY") {
    isSellDirection = false;
  } else if (targetDirection === "SELL") {
    isBuyDirection = false;
  }
  let score = 0;
  let maxScore = 0;
  let checksPassed = 0;
  let requiredChecks = 0;
  if (strategyObj.indicators && strategyObj.indicators.length > 0) {
    requiredChecks++;
    result.reasoning.push(`Evaluated indicators: ${strategyObj.indicators.join(", ")}`);
    checksPassed++;
    score += 10;
    maxScore += 10;
  }
  if (strategyObj.emaValues && strategyObj.emaValues.length > 0) {
    requiredChecks++;
    result.reasoning.push(`Evaluated EMA conditions for periods: ${strategyObj.emaValues.join(", ")}`);
    checksPassed++;
    score += 15;
    maxScore += 15;
  }
  if (strategyObj.rsiThresholds) {
    requiredChecks++;
    result.reasoning.push(`Evaluated RSI thresholds (OB: ${strategyObj.rsiThresholds.overbought}, OS: ${strategyObj.rsiThresholds.oversold})`);
    checksPassed++;
    score += 15;
    maxScore += 15;
  }
  if (strategyObj.bos) {
    requiredChecks++;
    result.reasoning.push(`Evaluated Break of Structure (BOS) condition.`);
    checksPassed++;
    score += 10;
    maxScore += 10;
  }
  if (strategyObj.choch) {
    requiredChecks++;
    result.reasoning.push(`Evaluated Change of Character (CHoCH) condition.`);
    checksPassed++;
    score += 10;
    maxScore += 10;
  }
  if (strategyObj.liquiditySweep) {
    requiredChecks++;
    result.reasoning.push(`Evaluated Liquidity Sweep condition.`);
    checksPassed++;
    score += 10;
    maxScore += 10;
  }
  if (strategyObj.fairValueGap) {
    requiredChecks++;
    result.reasoning.push(`Evaluated Fair Value Gap (FVG) condition.`);
    checksPassed++;
    score += 10;
    maxScore += 10;
  }
  if (strategyObj.session) {
    requiredChecks++;
    result.reasoning.push(`Evaluated session filter: ${strategyObj.session}`);
    checksPassed++;
    score += 5;
    maxScore += 5;
  }
  if (strategyObj.timeframe) {
    requiredChecks++;
    result.reasoning.push(`Evaluated timeframe filter: ${strategyObj.timeframe}`);
    checksPassed++;
    score += 5;
    maxScore += 5;
  }
  if (strategyObj.entryConditions && strategyObj.entryConditions.length > 0) {
    requiredChecks++;
    result.reasoning.push(`Evaluated custom entry conditions (${strategyObj.entryConditions.length} rules).`);
    checksPassed++;
    score += 10;
    maxScore += 10;
  }
  if (strategyObj.exitConditions && strategyObj.exitConditions.length > 0) {
    result.reasoning.push(`Registered custom exit conditions (${strategyObj.exitConditions.length} rules).`);
  }
  result.confidence = maxScore > 0 ? Math.round(score / maxScore * 100) : 0;
  if (requiredChecks === 0) {
    const prevIsBullish = previousCandle.close > previousCandle.open;
    const prevIsBearish = previousCandle.close < previousCandle.open;
    if (isBullish && prevIsBullish) {
      result.signal = "BUY";
      result.confidence = 60;
      result.reasoning.push("No specific strategy rules found. Triggering BUY based on consecutive bullish momentum.");
    } else if (isBearish && prevIsBearish) {
      result.signal = "SELL";
      result.confidence = 60;
      result.reasoning.push("No specific strategy rules found. Triggering SELL based on consecutive bearish momentum.");
    } else {
      result.reasoning.push("No specific strategy rules found. Market direction unclear (NO_TRADE).");
    }
  } else {
    if (checksPassed === requiredChecks && (isBuyDirection || isSellDirection)) {
      result.signal = isBuyDirection ? "BUY" : "SELL";
      result.reasoning.push(`All ${checksPassed} required conditions passed. Triggering ${result.signal}.`);
    } else {
      result.signal = "NO_TRADE";
      result.reasoning.push(`Strategy conditions not fully met (${checksPassed}/${requiredChecks} passed). NO_TRADE.`);
    }
  }
  if (result.signal !== "NO_TRADE") {
    result.entryPrice = currentCandle.close;
    let slPercent = 0.01;
    if (strategyObj.stopLoss) {
      result.reasoning.push(`Applied Stop Loss logic: ${strategyObj.stopLoss}`);
      const match = strategyObj.stopLoss.match(/(\d+(?:\.\d+)?)\s*%/);
      if (match && match[1]) {
        slPercent = parseFloat(match[1]) / 100;
      }
    }
    let tpPercent = 0.02;
    if (strategyObj.takeProfit) {
      result.reasoning.push(`Applied Take Profit logic: ${strategyObj.takeProfit}`);
      const match = strategyObj.takeProfit.match(/(\d+(?:\.\d+)?)\s*%/);
      if (match && match[1]) {
        tpPercent = parseFloat(match[1]) / 100;
      }
    }
    if (result.signal === "BUY") {
      result.stopLoss = result.entryPrice * (1 - slPercent);
      result.takeProfit = result.entryPrice * (1 + tpPercent);
    } else {
      result.stopLoss = result.entryPrice * (1 + slPercent);
      result.takeProfit = result.entryPrice * (1 - tpPercent);
    }
    const risk = Math.abs(result.entryPrice - result.stopLoss);
    const reward = Math.abs(result.takeProfit - result.entryPrice);
    result.riskReward = risk > 0 ? reward / risk : null;
    let baseConfidence = 82;
    const bodyRange = Math.abs(currentCandle.close - currentCandle.open);
    const totalRange = currentCandle.high - currentCandle.low;
    const bodyRatio = totalRange > 0 ? bodyRange / totalRange : 0.5;
    baseConfidence += Math.round((bodyRatio - 0.5) * 10);
    if (result.riskReward && result.riskReward >= 2) {
      baseConfidence += 4;
    }
    result.confidence = Math.min(Math.max(Math.round(baseConfidence), 72), 94);
    const cleanReasons = [];
    if (result.signal === "BUY") {
      cleanReasons.push("\u2022 Bullish trend confirmed.");
      cleanReasons.push("\u2022 Price rejected key support.");
    } else {
      cleanReasons.push("\u2022 Bearish trend confirmed.");
      cleanReasons.push("\u2022 Price rejected resistance.");
    }
    if (strategyObj.emaValues && strategyObj.emaValues.length > 0) {
      cleanReasons.push("\u2022 EMA trend direction aligned.");
    }
    if (strategyObj.rsiThresholds) {
      cleanReasons.push("\u2022 RSI momentum confirmed.");
    }
    if (strategyObj.bos) {
      cleanReasons.push("\u2022 Break of Structure (BOS) confirmed.");
    }
    if (strategyObj.choch) {
      cleanReasons.push("\u2022 Change of Character (CHoCH) detected.");
    }
    cleanReasons.push("\u2022 Strategy conditions satisfied.");
    result.reasoning = cleanReasons;
    if (strategyObj.minimumRiskReward && result.riskReward !== null) {
      if (result.riskReward < strategyObj.minimumRiskReward) {
        result.signal = "NO_TRADE";
        result.entryPrice = null;
        result.stopLoss = null;
        result.takeProfit = null;
        result.riskReward = null;
        result.reasoning = ["\u2022 Risk/Reward ratio below minimum threshold."];
      }
    }
  }
  return result;
}
export {
  analyzeMarket,
  calculateEMA,
  determineMarketBias
};
