function calculateDeterministicEMA(prices, period) {
  if (!prices || prices.length < period || period <= 0) return null;
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
function calculateDeterministicATR(candles, period = 14) {
  if (!candles || candles.length < 2) return 1e-3;
  const count = Math.min(candles.length - 1, period);
  let trSum = 0;
  for (let i = candles.length - count; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trSum += tr;
  }
  return count > 0 ? trSum / count : 1e-3;
}
function calculateDeterministicRSI(prices, period = 14) {
  if (!prices || prices.length <= period) return null;
  let gains = 0;
  let losses = 0;
  for (let i = prices.length - period; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    if (change >= 0) {
      gains += change;
    } else {
      losses += Math.abs(change);
    }
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}
class DeterministicEMACrossoverStrategy {
  constructor(fastPeriod = 9, slowPeriod = 21, riskRewardRatio = 2) {
    this.fastPeriod = fastPeriod;
    this.slowPeriod = slowPeriod;
    this.riskRewardRatio = riskRewardRatio;
  }
  fastPeriod;
  slowPeriod;
  riskRewardRatio;
  id = "ema-crossover";
  name = "Deterministic EMA Crossover";
  evaluate(context) {
    const { current, previous, symbol, timeframe, index } = context;
    if (previous.length < this.slowPeriod + 1) return null;
    const allCandles = [...previous, current];
    const closes = allCandles.map((c) => c.close);
    const prevCloses = closes.slice(0, -1);
    const currCloses = closes;
    const prevFast = calculateDeterministicEMA(prevCloses, this.fastPeriod);
    const prevSlow = calculateDeterministicEMA(prevCloses, this.slowPeriod);
    const currFast = calculateDeterministicEMA(currCloses, this.fastPeriod);
    const currSlow = calculateDeterministicEMA(currCloses, this.slowPeriod);
    if (prevFast === null || prevSlow === null || currFast === null || currSlow === null) {
      return null;
    }
    const atr = calculateDeterministicATR(allCandles, 14);
    const slBuffer = atr * 1.5;
    if (prevFast <= prevSlow && currFast > currSlow) {
      const entryPrice = current.close;
      const stopLoss = Math.round((entryPrice - slBuffer) * 1e5) / 1e5;
      const riskPips = entryPrice - stopLoss;
      const takeProfit = Math.round((entryPrice + riskPips * this.riskRewardRatio) * 1e5) / 1e5;
      return {
        id: `sig_${index}_buy`,
        timestamp: current.timestamp,
        symbol,
        timeframe,
        direction: "BUY",
        entryPrice,
        stopLoss,
        takeProfit,
        reason: `Deterministic Fast EMA (${this.fastPeriod}) crossed above Slow EMA (${this.slowPeriod})`,
        confidence: 85
      };
    }
    if (prevFast >= prevSlow && currFast < currSlow) {
      const entryPrice = current.close;
      const stopLoss = Math.round((entryPrice + slBuffer) * 1e5) / 1e5;
      const riskPips = stopLoss - entryPrice;
      const takeProfit = Math.round((entryPrice - riskPips * this.riskRewardRatio) * 1e5) / 1e5;
      return {
        id: `sig_${index}_sell`,
        timestamp: current.timestamp,
        symbol,
        timeframe,
        direction: "SELL",
        entryPrice,
        stopLoss,
        takeProfit,
        reason: `Deterministic Fast EMA (${this.fastPeriod}) crossed below Slow EMA (${this.slowPeriod})`,
        confidence: 85
      };
    }
    return null;
  }
}
class DeterministicBreakoutStrategy {
  constructor(lookbackPeriod = 20, riskRewardRatio = 2) {
    this.lookbackPeriod = lookbackPeriod;
    this.riskRewardRatio = riskRewardRatio;
  }
  lookbackPeriod;
  riskRewardRatio;
  id = "breakout";
  name = "Deterministic Donchian/Swing Breakout";
  evaluate(context) {
    const { current, previous, symbol, timeframe, index } = context;
    if (previous.length < this.lookbackPeriod) return null;
    const recentPrevious = previous.slice(-this.lookbackPeriod);
    const maxHigh = Math.max(...recentPrevious.map((c) => c.high));
    const minLow = Math.min(...recentPrevious.map((c) => c.low));
    const atr = calculateDeterministicATR([...previous, current], 14);
    if (current.close > maxHigh) {
      const entryPrice = current.close;
      const stopLoss = Math.round(minLow * 1e5) / 1e5;
      const riskAmount = entryPrice - stopLoss;
      if (riskAmount <= 0) return null;
      const takeProfit = Math.round((entryPrice + riskAmount * this.riskRewardRatio) * 1e5) / 1e5;
      return {
        id: `sig_${index}_buy`,
        timestamp: current.timestamp,
        symbol,
        timeframe,
        direction: "BUY",
        entryPrice,
        stopLoss,
        takeProfit,
        reason: `Price breakout above ${this.lookbackPeriod}-candle high (${maxHigh})`,
        confidence: 80
      };
    }
    if (current.close < minLow) {
      const entryPrice = current.close;
      const stopLoss = Math.round(maxHigh * 1e5) / 1e5;
      const riskAmount = stopLoss - entryPrice;
      if (riskAmount <= 0) return null;
      const takeProfit = Math.round((entryPrice - riskAmount * this.riskRewardRatio) * 1e5) / 1e5;
      return {
        id: `sig_${index}_sell`,
        timestamp: current.timestamp,
        symbol,
        timeframe,
        direction: "SELL",
        entryPrice,
        stopLoss,
        takeProfit,
        reason: `Price breakdown below ${this.lookbackPeriod}-candle low (${minLow})`,
        confidence: 80
      };
    }
    return null;
  }
}
import { GaksBacktestStrategy } from "./backtest-gaks-strategy.js";
class TestAlwaysBuyStrategy {
  id = "test-always-buy";
  name = "Test Always Buy";
  evaluate(context) {
    if (context.index === 0) {
      const entryPrice = context.current.close;
      return {
        id: `test_sig_${context.index}`,
        timestamp: context.current.timestamp,
        symbol: context.symbol,
        timeframe: context.timeframe,
        direction: "BUY",
        entryPrice,
        stopLoss: Math.round((entryPrice - 5e-3) * 1e5) / 1e5,
        takeProfit: Math.round((entryPrice + 0.01) * 1e5) / 1e5,
        reason: "Test always buy",
        confidence: 100
      };
    }
    return null;
  }
}
function resolveBacktestStrategy(strategyId, strategyText) {
  const normId = (strategyId || "").toLowerCase();
  if (normId === "test-always-buy") {
    return new TestAlwaysBuyStrategy();
  }
  if (strategyText && strategyText.trim().length > 0) {
    return new GaksBacktestStrategy(strategyText, strategyId);
  }
  if (normId === "breakout") {
    return new DeterministicBreakoutStrategy(20, 2);
  }
  if (normId === "ema-crossover") {
    return new DeterministicEMACrossoverStrategy(9, 21, 2);
  }
  return new GaksBacktestStrategy(strategyText, strategyId);
}
export {
  DeterministicBreakoutStrategy,
  DeterministicEMACrossoverStrategy,
  TestAlwaysBuyStrategy,
  calculateDeterministicATR,
  calculateDeterministicEMA,
  calculateDeterministicRSI,
  resolveBacktestStrategy
};
