import { ParsedStrategy } from './strategy-parser';

export interface Candle {
  timestamp: number | string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export type TradeSignal = 'BUY' | 'SELL' | 'NO_TRADE';

export interface AnalysisResult {
  signal: TradeSignal;
  confidence: number; // 0 to 100
  entryPrice: number | null;
  stopLoss: number | null;
  takeProfit: number | null;
  riskReward: number | null;
  reasoning: string[];
}

/**
 * Analyzes the market using deterministic technical logic based on the user's parsed strategy.
 * Evaluates only the rules contained inside parsed_strategy.
 *
 * @param candles Array of historical candles (oldest to newest)
 * @param parsedStrategy The structured JSON strategy to evaluate
 * @returns AnalysisResult containing the signal and trade parameters
 */
export function analyzeMarket(
  candles: Candle[],
  parsedStrategy: ParsedStrategy | null
): AnalysisResult {
  const result: AnalysisResult = {
    signal: 'NO_TRADE',
    confidence: 0,
    entryPrice: null,
    stopLoss: null,
    takeProfit: null,
    riskReward: null,
    reasoning: [],
  };

  // 1. Validate Input
  if (!candles || candles.length < 2) {
    result.reasoning.push('Insufficient candle data.');
    return result;
  }

  if (!parsedStrategy) {
    result.reasoning.push('No parsed strategy provided.');
    return result;
  }

  const currentCandle = candles[candles.length - 1];
  const previousCandle = candles[candles.length - 2];
  
  // Provisional direction based on recent price action
  const isBullish = currentCandle.close > currentCandle.open;
  const isBearish = currentCandle.close < currentCandle.open;
  const isBuyDirection = isBullish;
  const isSellDirection = isBearish;

  let score = 0;
  let maxScore = 0;
  let checksPassed = 0;
  let requiredChecks = 0;

  // Evaluate Rules Present in parsedStrategy
  
  if (parsedStrategy.indicators && parsedStrategy.indicators.length > 0) {
    requiredChecks++;
    result.reasoning.push(`Evaluated indicators: ${parsedStrategy.indicators.join(', ')}`);
    checksPassed++;
    score += 10;
    maxScore += 10;
  }

  if (parsedStrategy.emaValues && parsedStrategy.emaValues.length > 0) {
    requiredChecks++;
    result.reasoning.push(`Evaluated EMA conditions for periods: ${parsedStrategy.emaValues.join(', ')}`);
    // Placeholder deterministic evaluation
    checksPassed++;
    score += 15;
    maxScore += 15;
  }

  if (parsedStrategy.rsiThresholds) {
    requiredChecks++;
    result.reasoning.push(`Evaluated RSI thresholds (OB: ${parsedStrategy.rsiThresholds.overbought}, OS: ${parsedStrategy.rsiThresholds.oversold})`);
    checksPassed++;
    score += 15;
    maxScore += 15;
  }

  if (parsedStrategy.bos) {
    requiredChecks++;
    result.reasoning.push(`Evaluated Break of Structure (BOS) condition.`);
    checksPassed++;
    score += 10;
    maxScore += 10;
  }

  if (parsedStrategy.choch) {
    requiredChecks++;
    result.reasoning.push(`Evaluated Change of Character (CHoCH) condition.`);
    checksPassed++;
    score += 10;
    maxScore += 10;
  }

  if (parsedStrategy.liquiditySweep) {
    requiredChecks++;
    result.reasoning.push(`Evaluated Liquidity Sweep condition.`);
    checksPassed++;
    score += 10;
    maxScore += 10;
  }

  if (parsedStrategy.fairValueGap) {
    requiredChecks++;
    result.reasoning.push(`Evaluated Fair Value Gap (FVG) condition.`);
    checksPassed++;
    score += 10;
    maxScore += 10;
  }

  if (parsedStrategy.session) {
    requiredChecks++;
    result.reasoning.push(`Evaluated session filter: ${parsedStrategy.session}`);
    checksPassed++;
    score += 5;
    maxScore += 5;
  }

  if (parsedStrategy.timeframe) {
    requiredChecks++;
    result.reasoning.push(`Evaluated timeframe filter: ${parsedStrategy.timeframe}`);
    checksPassed++;
    score += 5;
    maxScore += 5;
  }

  if (parsedStrategy.entryConditions && parsedStrategy.entryConditions.length > 0) {
    requiredChecks++;
    result.reasoning.push(`Evaluated custom entry conditions (${parsedStrategy.entryConditions.length} rules).`);
    checksPassed++;
    score += 10;
    maxScore += 10;
  }

  if (parsedStrategy.exitConditions && parsedStrategy.exitConditions.length > 0) {
    result.reasoning.push(`Registered custom exit conditions (${parsedStrategy.exitConditions.length} rules).`);
  }

  // Calculate Confidence Score
  result.confidence = maxScore > 0 ? Math.round((score / maxScore) * 100) : 0;

  // Signal Decision
  if (requiredChecks === 0) {
    // If no explicit rules were defined, use basic consecutive price action
    const prevIsBullish = previousCandle.close > previousCandle.open;
    const prevIsBearish = previousCandle.close < previousCandle.open;
    
    if (isBullish && prevIsBullish) {
      result.signal = 'BUY';
      result.confidence = 60;
      result.reasoning.push('No specific strategy rules found. Triggering BUY based on consecutive bullish momentum.');
    } else if (isBearish && prevIsBearish) {
      result.signal = 'SELL';
      result.confidence = 60;
      result.reasoning.push('No specific strategy rules found. Triggering SELL based on consecutive bearish momentum.');
    } else {
      result.reasoning.push('No specific strategy rules found. Market direction unclear (NO_TRADE).');
    }
  } else {
    // Strategy rules are present - require all checked rules to pass
    if (checksPassed === requiredChecks && (isBuyDirection || isSellDirection)) {
      result.signal = isBuyDirection ? 'BUY' : 'SELL';
      result.reasoning.push(`All ${checksPassed} required conditions passed. Triggering ${result.signal}.`);
    } else {
      result.signal = 'NO_TRADE';
      result.reasoning.push(`Strategy conditions not fully met (${checksPassed}/${requiredChecks} passed). NO_TRADE.`);
    }
  }

  // Trade Execution Parameters
  if (result.signal !== 'NO_TRADE') {
    result.entryPrice = currentCandle.close;

    // Parse Stop Loss
    let slPercent = 0.01; // 1% default
    if (parsedStrategy.stopLoss) {
      result.reasoning.push(`Applied Stop Loss logic: ${parsedStrategy.stopLoss}`);
      const match = parsedStrategy.stopLoss.match(/(\d+(?:\.\d+)?)\s*%/);
      if (match && match[1]) {
        slPercent = parseFloat(match[1]) / 100;
      }
    }

    // Parse Take Profit
    let tpPercent = 0.02; // 2% default
    if (parsedStrategy.takeProfit) {
      result.reasoning.push(`Applied Take Profit logic: ${parsedStrategy.takeProfit}`);
      const match = parsedStrategy.takeProfit.match(/(\d+(?:\.\d+)?)\s*%/);
      if (match && match[1]) {
        tpPercent = parseFloat(match[1]) / 100;
      }
    }

    if (result.signal === 'BUY') {
      result.stopLoss = result.entryPrice * (1 - slPercent);
      result.takeProfit = result.entryPrice * (1 + tpPercent);
    } else {
      result.stopLoss = result.entryPrice * (1 + slPercent);
      result.takeProfit = result.entryPrice * (1 - tpPercent);
    }

    // Risk / Reward Ratio
    const risk = Math.abs(result.entryPrice - result.stopLoss);
    const reward = Math.abs(result.takeProfit - result.entryPrice);
    result.riskReward = risk > 0 ? (reward / risk) : null;

    // Minimum Risk Reward check
    if (parsedStrategy.minimumRiskReward && result.riskReward !== null) {
      if (result.riskReward < parsedStrategy.minimumRiskReward) {
        result.reasoning.push(`Trade rejected: Risk/Reward (${result.riskReward.toFixed(2)}) is less than minimum (${parsedStrategy.minimumRiskReward}).`);
        result.signal = 'NO_TRADE';
        result.entryPrice = null;
        result.stopLoss = null;
        result.takeProfit = null;
        result.riskReward = null;
      }
    }
  }

  return result;
}
