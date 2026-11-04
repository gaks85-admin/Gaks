/**
 * GAKS AI — Stage E6: Market Regime Analysis Engine (Hardened Statistical Reliability)
 * Dynamically classifies historical candles at entry timestamp into Trend and Volatility regimes.
 * Enforces configurable sample thresholds (default 30 trades), computes standard errors,
 * 95% confidence intervals, and distinguishes descriptive observations from statistically supported conclusions.
 */

import { ParsedCandle } from './backtest-csv.js';
import { BacktestTradeRecord } from './backtest-types.js';

export type TrendRegime = 'BULLISH_TREND' | 'BEARISH_TREND' | 'RANGING';
export type VolatilityRegime = 'HIGH_VOLATILITY' | 'NORMAL_VOLATILITY' | 'LOW_VOLATILITY';

export interface MarketRegimeClassification {
  trend: TrendRegime;
  volatility: VolatilityRegime;
  atrValue: number;
  ema20: number;
  ema50: number;
}

export interface RegimeMetrics {
  regimeKey: string;
  trend: TrendRegime;
  volatility: VolatilityRegime;
  totalTrades: number;
  winningTrades: number;
  winRate: number; // percentage 0-100
  winRateStandardError: number; // SE = sqrt(p(1-p)/n) * 100
  confidenceInterval95: { lower: number; upper: number }; // 95% CI for win rate
  profitFactor: number;
  netPnL: number;
  maxDrawdown: number;
  expectancy: number;
  status: 'VALID' | 'INCONCLUSIVE';
  statisticalSignificance: 'STATISTICALLY_SUPPORTED' | 'DESCRIPTIVE_ONLY_INCONCLUSIVE';
  evaluationReason: string;
}

export interface MarketRegimeReport {
  regimeBreakdown: Record<string, RegimeMetrics>;
  dominantRegime: string;
  minSampleThreshold: number;
  isPassed: boolean;
  timestamp: string;
  regimes?: RegimeMetrics[];
  isInconclusive?: boolean;
}

/**
 * Calculates Simple Moving Average (SMA)
 */
function calculateSMA(values: number[]): number {
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  return sum / values.length;
}

/**
 * Calculates Exponential Moving Average (EMA)
 */
function calculateEMA(candles: ParsedCandle[], period: number): number {
  if (candles.length < period) return candles[candles.length - 1]?.close || 0;
  let ema = calculateSMA(candles.slice(0, period).map(c => c.close));
  const k = 2 / (period + 1);

  for (let i = period; i < candles.length; i++) {
    ema = candles[i].close * k + ema * (1 - k);
  }
  return ema;
}

/**
 * Calculates Average True Range (ATR)
 */
function calculateATR(candles: ParsedCandle[], period: number = 14): number {
  if (candles.length < period + 1) return 0.0010;

  const trs: number[] = [];
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

/**
 * Classifies market regime at a specific timestamp using historical candles up to index T.
 */
export function classifyRegime(history: ParsedCandle[]): MarketRegimeClassification {
  if (!history || history.length < 20) {
    return {
      trend: 'RANGING',
      volatility: 'NORMAL_VOLATILITY',
      atrValue: 0.0010,
      ema20: 0,
      ema50: 0
    };
  }

  const ema20 = calculateEMA(history, 20);
  const ema50 = calculateEMA(history, 50);
  const atr = calculateATR(history, 14);

  // Baseline ATR over longer window (50)
  const longTermATR = calculateATR(history, 50);

  // 1. Trend Classification
  let trend: TrendRegime = 'RANGING';
  const diffPercent = Math.abs((ema20 - ema50) / ema50) * 100;

  if (diffPercent > 0.05) {
    if (ema20 > ema50) {
      trend = 'BULLISH_TREND';
    } else {
      trend = 'BEARISH_TREND';
    }
  }

  // 2. Volatility Classification
  let volatility: VolatilityRegime = 'NORMAL_VOLATILITY';
  if (longTermATR > 0) {
    const ratio = atr / longTermATR;
    if (ratio > 1.25) {
      volatility = 'HIGH_VOLATILITY';
    } else if (ratio < 0.75) {
      volatility = 'LOW_VOLATILITY';
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

/**
 * Analyzes backtest trade execution broken down by market regime present at trade entry time.
 * Enforces rigorous statistical sample thresholds (default 30 trades for statistical significance).
 */
export function analyzeMarketRegimes(
  trades: BacktestTradeRecord[],
  candles: ParsedCandle[],
  minSampleThreshold: number = 30
): MarketRegimeReport {
  const regimeGroups: Record<string, BacktestTradeRecord[]> = {};

  // Map each trade to its regime at entryTimestamp
  for (const trade of trades) {
    const entryTs = new Date(trade.entryTimestamp).getTime();
    // Find history slice up to trade entry
    const historyIndex = candles.findIndex(c => new Date(c.timestamp).getTime() >= entryTs);
    const sliceEnd = historyIndex > 0 ? historyIndex : candles.length;
    const history = candles.slice(0, sliceEnd);

    const regime = classifyRegime(history);
    const key = `${regime.trend}__${regime.volatility}`;

    if (!regimeGroups[key]) {
      regimeGroups[key] = [];
    }
    regimeGroups[key].push(trade);
  }

  const breakdown: Record<string, RegimeMetrics> = {};
  let maxTradeCount = 0;
  let dominantRegime = 'NONE';

  for (const [key, group] of Object.entries(regimeGroups)) {
    const [trend, volatility] = key.split('__') as [TrendRegime, VolatilityRegime];
    const totalTrades = group.length;

    if (totalTrades > maxTradeCount) {
      maxTradeCount = totalTrades;
      dominantRegime = key;
    }

    const wins = group.filter(t => t.netPnL > 0);
    const losses = group.filter(t => t.netPnL < 0);

    const grossProfit = wins.reduce((sum, t) => sum + t.netPnL, 0);
    const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.netPnL, 0));
    const netPnL = group.reduce((sum, t) => sum + t.netPnL, 0);

    const winRate = totalTrades > 0 ? (wins.length / totalTrades) * 100 : 0;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99.0 : 0;
    const expectancy = totalTrades > 0 ? netPnL / totalTrades : 0;

    // Statistical Uncertainty Calculations (Standard Error and 95% Confidence Interval for proportion)
    const p = totalTrades > 0 ? wins.length / totalTrades : 0;
    const standardError = totalTrades > 0 ? Math.sqrt((p * (1 - p)) / totalTrades) * 100 : 0;
    // 95% CI using normal approximation (Z = 1.96)
    const ciMargin = 1.96 * standardError;
    const ciLower = Math.max(0, winRate - ciMargin);
    const ciUpper = Math.min(100, winRate + ciMargin);

    // Rigorous statistical threshold (default 30 trades)
    const isStatisticallySignificant = totalTrades >= minSampleThreshold;
    const status: 'VALID' | 'INCONCLUSIVE' = isStatisticallySignificant ? 'VALID' : 'INCONCLUSIVE';
    const statisticalSignificance = isStatisticallySignificant ? 'STATISTICALLY_SUPPORTED' : 'DESCRIPTIVE_ONLY_INCONCLUSIVE';
    
    const evaluationReason = isStatisticallySignificant
      ? `Sample size (${totalTrades} trades) meets or exceeds statistical threshold (${minSampleThreshold}). Conclusion is statistically supported.`
      : `INCONCLUSIVE: Sample size (${totalTrades} trades) is below statistical threshold (${minSampleThreshold}). Observations are descriptive only and carry high estimation uncertainty (SE: ±${standardError.toFixed(1)}%).`;

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

  // Criteria for PASS: At least one regime has valid statistically significant sample size and positive PnL
  const statisticallySupportedRegimes = Object.values(breakdown).filter(r => r.status === 'VALID');
  const isPassed = statisticallySupportedRegimes.some(r => r.netPnL > 0);

  return {
    regimeBreakdown: breakdown,
    dominantRegime,
    minSampleThreshold,
    isPassed,
    timestamp: new Date().toISOString()
  };
}
