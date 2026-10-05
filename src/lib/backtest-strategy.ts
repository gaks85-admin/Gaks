/**
 * GAKS AI — Deterministic Strategy Evaluators & Adapters (Phase 4)
 * Provides pure, deterministic strategy evaluation over historical candle contexts.
 * ABSOLUTE RULE: Zero calls to Gemini API, live market data, or external services.
 */

import {
  BacktestStrategy,
  BacktestCandleContext,
  BacktestSignal
} from './backtest-types.js';
import { ParsedCandle } from './backtest-csv.js';

/**
 * Calculates Exponential Moving Average (EMA) deterministically for an array of numbers.
 */
export function calculateDeterministicEMA(prices: number[], period: number): number | null {
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

/**
 * Calculates Average True Range (ATR) deterministically over historical candles.
 */
export function calculateDeterministicATR(candles: ParsedCandle[], period: number = 14): number {
  if (!candles || candles.length < 2) return 0.0010;

  const count = Math.min(candles.length - 1, period);
  let trSum = 0;

  for (let i = candles.length - count; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;
    const tr = Math.max(high - low, Math.abs(high - prevClose), Math.abs(low - prevClose));
    trSum += tr;
  }

  return count > 0 ? trSum / count : 0.0010;
}

/**
 * Calculates Relative Strength Index (RSI) deterministically.
 */
export function calculateDeterministicRSI(prices: number[], period: number = 14): number | null {
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

/**
 * Deterministic EMA Crossover Strategy
 * BUY when Fast EMA crosses above Slow EMA.
 * SELL when Fast EMA crosses below Slow EMA.
 */
export class DeterministicEMACrossoverStrategy implements BacktestStrategy {
  id = 'ema-crossover';
  name = 'Deterministic EMA Crossover';

  constructor(
    public fastPeriod: number = 9,
    public slowPeriod: number = 21,
    public riskRewardRatio: number = 2.0
  ) {}

  evaluate(context: BacktestCandleContext): BacktestSignal | null {
    const { current, previous, symbol, timeframe, index } = context;
    if (previous.length < this.slowPeriod + 1) return null;

    const allCandles = [...previous, current];
    const closes = allCandles.map(c => c.close);

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

    // Bullish Crossover: Fast crosses above Slow
    if (prevFast <= prevSlow && currFast > currSlow) {
      const entryPrice = current.close;
      const stopLoss = Math.round((entryPrice - slBuffer) * 100000) / 100000;
      const riskPips = entryPrice - stopLoss;
      const takeProfit = Math.round((entryPrice + riskPips * this.riskRewardRatio) * 100000) / 100000;

      return {
        id: `sig_${index}_buy`,
        timestamp: current.timestamp,
        symbol,
        timeframe,
        direction: 'BUY',
        entryPrice,
        stopLoss,
        takeProfit,
        reason: `Deterministic Fast EMA (${this.fastPeriod}) crossed above Slow EMA (${this.slowPeriod})`,
        confidence: 85
      };
    }

    // Bearish Crossover: Fast crosses below Slow
    if (prevFast >= prevSlow && currFast < currSlow) {
      const entryPrice = current.close;
      const stopLoss = Math.round((entryPrice + slBuffer) * 100000) / 100000;
      const riskPips = stopLoss - entryPrice;
      const takeProfit = Math.round((entryPrice - riskPips * this.riskRewardRatio) * 100000) / 100000;

      return {
        id: `sig_${index}_sell`,
        timestamp: current.timestamp,
        symbol,
        timeframe,
        direction: 'SELL',
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

/**
 * Deterministic Price Action Breakout Strategy
 * BUY on breakout above N-candle high.
 * SELL on breakdown below N-candle low.
 */
export class DeterministicBreakoutStrategy implements BacktestStrategy {
  id = 'breakout';
  name = 'Deterministic Donchian/Swing Breakout';

  constructor(
    public lookbackPeriod: number = 20,
    public riskRewardRatio: number = 2.0
  ) {}

  evaluate(context: BacktestCandleContext): BacktestSignal | null {
    const { current, previous, symbol, timeframe, index } = context;
    if (previous.length < this.lookbackPeriod) return null;

    const recentPrevious = previous.slice(-this.lookbackPeriod);
    const maxHigh = Math.max(...recentPrevious.map(c => c.high));
    const minLow = Math.min(...recentPrevious.map(c => c.low));

    const atr = calculateDeterministicATR([...previous, current], 14);

    // Bullish Breakout
    if (current.close > maxHigh) {
      const entryPrice = current.close;
      const stopLoss = Math.round(minLow * 100000) / 100000;
      const riskAmount = entryPrice - stopLoss;
      if (riskAmount <= 0) return null;

      const takeProfit = Math.round((entryPrice + riskAmount * this.riskRewardRatio) * 100000) / 100000;

      return {
        id: `sig_${index}_buy`,
        timestamp: current.timestamp,
        symbol,
        timeframe,
        direction: 'BUY',
        entryPrice,
        stopLoss,
        takeProfit,
        reason: `Price breakout above ${this.lookbackPeriod}-candle high (${maxHigh})`,
        confidence: 80
      };
    }

    // Bearish Breakdown
    if (current.close < minLow) {
      const entryPrice = current.close;
      const stopLoss = Math.round(maxHigh * 100000) / 100000;
      const riskAmount = stopLoss - entryPrice;
      if (riskAmount <= 0) return null;

      const takeProfit = Math.round((entryPrice - riskAmount * this.riskRewardRatio) * 100000) / 100000;

      return {
        id: `sig_${index}_sell`,
        timestamp: current.timestamp,
        symbol,
        timeframe,
        direction: 'SELL',
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

import { GaksBacktestStrategy } from './backtest-gaks-strategy.js';

/**
 * Resolves a deterministic strategy instance for a backtest run.
 */
export function resolveBacktestStrategy(strategyId?: string, strategyText?: string): BacktestStrategy {
  const normId = (strategyId || '').toLowerCase();

  if (strategyText && strategyText.trim().length > 0) {
    return new GaksBacktestStrategy(strategyText, strategyId);
  }

  if (normId === 'breakout') {
    return new DeterministicBreakoutStrategy(20, 2.0);
  }

  if (normId === 'ema-crossover') {
    return new DeterministicEMACrossoverStrategy(9, 21, 2.0);
  }

  // Default: Actual Gaks Strategy
  return new GaksBacktestStrategy(strategyText, strategyId);
}
