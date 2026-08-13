import { evaluateAdaptiveLearning, filterValidCompletedTrades, computeMetricsForSubset } from './adaptive-learning-engine.js';

export type ExecutionStatus = 'EXECUTE' | 'WAIT' | 'NO_TRADE';
export type TimingQuality = 'GOOD' | 'FAIR' | 'POOR';
export type HistoricalSupport = 'STRONG' | 'MODERATE' | 'WEAK' | 'INSUFFICIENT';

export interface AdaptiveExecutionInput {
  userId?: string;
  pair: string;
  timeframe: string;
  setup: string;
  direction: 'BUY' | 'SELL';
  marketRegime?: string;
  entryPrice?: number;
  structurePrice?: number;
  atr?: number;
  currentSpread?: number;
  candleBodySize?: number;
  averageCandleBody?: number;
  completedTrades?: any[];
  adaptiveQuality?: any;
  riskGovernor?: any;
}

export interface AdaptiveExecutionResult {
  status: ExecutionStatus;
  executionScore: number;
  reasonCodes: string[];
  timingQuality: TimingQuality;
  historicalSupport: HistoricalSupport;
  fallbackLevelUsed: string;
  explanation: string;
}

/**
 * Evaluates adaptive execution timing, entry proximity, chasing protection, and historical execution performance.
 */
export function evaluateAdaptiveExecution(input: AdaptiveExecutionInput): AdaptiveExecutionResult {
  const reasonCodes: string[] = [];
  const pair = (input.pair || 'EURUSD').toUpperCase();
  const timeframe = (input.timeframe || 'M5').toUpperCase();
  const setup = (input.setup || 'HYBRID').toUpperCase();
  const direction = (input.direction || 'BUY').toUpperCase();
  const marketRegime = (input.marketRegime || 'UNKNOWN').toUpperCase();

  const allTrades = filterValidCompletedTrades(input.completedTrades || []);
  const trades = input.userId ? allTrades.filter(t => t.user_id === input.userId) : allTrades;

  // 1. Hierarchical historical execution lookup (similar to Stage 3B hierarchy)
  let matchingTrades: any[] = [];
  let fallbackLevelUsed = 'INSUFFICIENT';

  // Level 1: pair + timeframe + setup + direction + regime
  const l1 = trades.filter(t => 
    (t.pair || '').toUpperCase() === pair &&
    (t.timeframe || '').toUpperCase() === timeframe &&
    ((t.strategy_mode || t.setup) || '').toUpperCase() === setup &&
    (t.direction || '').toUpperCase() === direction &&
    ((t.market_regime || t.regime) || '').toUpperCase() === marketRegime
  );
  if (l1.length >= 10) {
    matchingTrades = l1;
    fallbackLevelUsed = 'PAIR+TF+SETUP+DIRECTION+REGIME';
  } else {
    // Level 2: pair + timeframe + setup + direction
    const l2 = trades.filter(t => 
      (t.pair || '').toUpperCase() === pair &&
      (t.timeframe || '').toUpperCase() === timeframe &&
      ((t.strategy_mode || t.setup) || '').toUpperCase() === setup &&
      (t.direction || '').toUpperCase() === direction
    );
    if (l2.length >= 10) {
      matchingTrades = l2;
      fallbackLevelUsed = 'PAIR+TF+SETUP+DIRECTION';
    } else {
      // Level 3: pair + timeframe + setup
      const l3 = trades.filter(t => 
        (t.pair || '').toUpperCase() === pair &&
        (t.timeframe || '').toUpperCase() === timeframe &&
        ((t.strategy_mode || t.setup) || '').toUpperCase() === setup
      );
      if (l3.length >= 10) {
        matchingTrades = l3;
        fallbackLevelUsed = 'PAIR+TF+SETUP';
      } else {
        // Level 4: pair + timeframe
        const l4 = trades.filter(t => 
          (t.pair || '').toUpperCase() === pair &&
          (t.timeframe || '').toUpperCase() === timeframe
        );
        if (l4.length >= 10) {
          matchingTrades = l4;
          fallbackLevelUsed = 'PAIR+TF';
        } else {
          // Level 5: pair
          const l5 = trades.filter(t => (t.pair || '').toUpperCase() === pair);
          if (l5.length >= 10) {
            matchingTrades = l5;
            fallbackLevelUsed = 'PAIR';
          } else {
            // Level 6: global user performance
            if (trades.length >= 15) {
              matchingTrades = trades;
              fallbackLevelUsed = 'GLOBAL_USER';
            } else {
              matchingTrades = trades;
              fallbackLevelUsed = 'INSUFFICIENT';
            }
          }
        }
      }
    }
  }

  const metrics = computeMetricsForSubset(matchingTrades);
  const sampleSize = metrics.totalTrades;
  const expectancyR = metrics.expectancyR;

  // Determine historical support
  let historicalSupport: HistoricalSupport = 'INSUFFICIENT';
  if (sampleSize >= 30) {
    historicalSupport = expectancyR >= 0.3 ? 'STRONG' : (expectancyR >= 0.0 ? 'MODERATE' : 'WEAK');
  } else if (sampleSize >= 15) {
    historicalSupport = expectancyR >= 0.2 ? 'STRONG' : (expectancyR >= 0.0 ? 'MODERATE' : 'WEAK');
  } else if (sampleSize >= 10) {
    historicalSupport = 'MODERATE';
  } else {
    historicalSupport = 'INSUFFICIENT';
  }

  // 2. Technical Execution Timing Factors (Structure Proximity, ATR Distance, Chasing)
  let timingScore = 80; // Baseline execution score

  // Check entry chasing & structure distance if prices provided
  if (input.entryPrice !== undefined && input.structurePrice !== undefined && input.atr !== undefined && input.atr > 0) {
    const distancePipsOrUnits = Math.abs(input.entryPrice - input.structurePrice);
    const atrMultiple = distancePipsOrUnits / input.atr;

    if (atrMultiple > 2.0) {
      timingScore -= 30;
      reasonCodes.push('EXCESSIVE_ATR_EXPANSION_OR_CHASING');
    } else if (atrMultiple > 1.5) {
      timingScore -= 15;
      reasonCodes.push('EXTENDED_ENTRY_DISTANCE');
    } else {
      timingScore += 5;
      reasonCodes.push('GOOD_STRUCTURAL_PROXIMITY');
    }
  }

  // Check candle expansion volatility if available
  if (input.candleBodySize !== undefined && input.averageCandleBody !== undefined && input.averageCandleBody > 0) {
    const expansionRatio = input.candleBodySize / input.averageCandleBody;
    if (expansionRatio > 2.5) {
      timingScore -= 20;
      reasonCodes.push('EXHAUSTION_CANDLE_VOLATILITY');
    } else if (expansionRatio < 0.3) {
      timingScore -= 10;
      reasonCodes.push('LOW_MOMENTUM_CANDLE');
    }
  }

  // Historical performance penalty / boost
  if (sampleSize >= 10) {
    if (expectancyR < -0.2) {
      timingScore -= 20;
      reasonCodes.push('POOR_HISTORICAL_EXECUTION_EXPECTANCY');
    } else if (expectancyR > 0.4) {
      timingScore += 10;
      reasonCodes.push('STRONG_HISTORICAL_EXECUTION_EXPECTANCY');
    }
  }

  // Risk Governor or adaptive quality penalties
  if (input.riskGovernor && input.riskGovernor.decision === 'RESTRICT') {
    timingScore -= 15;
    reasonCodes.push('RISK_GOVERNOR_RESTRICTION');
  }
  if (input.adaptiveQuality && input.adaptiveQuality.decision === 'RESTRICT') {
    timingScore -= 15;
    reasonCodes.push('ADAPTIVE_QUALITY_RESTRICTION');
  }

  // Clamp timing score between 0 and 100
  timingScore = Math.max(0, Math.min(100, timingScore));

  // Determine timing quality
  let timingQuality: TimingQuality = 'FAIR';
  if (timingScore >= 75) {
    timingQuality = 'GOOD';
  } else if (timingScore >= 60) {
    timingQuality = 'FAIR';
  } else {
    timingQuality = 'POOR';
  }

  // Determine final execution status
  let status: ExecutionStatus = 'EXECUTE';
  if (timingScore < 50 || reasonCodes.includes('EXCESSIVE_ATR_EXPANSION_OR_CHASING')) {
    status = 'NO_TRADE';
  } else if (timingScore < 65) {
    status = 'WAIT';
  } else {
    status = 'EXECUTE';
  }

  const explanation = `Execution Score: ${timingScore}/100 (${timingQuality}), Historical Support: ${historicalSupport} (sample: ${sampleSize}, expectancy: ${expectancyR.toFixed(2)}R), Hierarchy: ${fallbackLevelUsed}, Reasons: ${reasonCodes.join(', ') || 'NONE'}`;

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
