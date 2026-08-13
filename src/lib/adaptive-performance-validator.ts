import { filterValidCompletedTrades, computeMetricsForSubset } from './adaptive-learning-engine.js';

export type PerformanceValidatorStatus = 
  | 'INSUFFICIENT_DATA'
  | 'OBSERVATIONAL'
  | 'VALIDATED'
  | 'DETERIORATING'
  | 'RECOVERING';

export type EvidenceLevel = 'NONE' | 'WEAK' | 'MODERATE' | 'STRONG';
export type AdaptiveInfluence = 'NONE' | 'INFORMATIONAL' | 'RESTRICTIVE';

export interface PerformanceValidatorInput {
  userId?: string;
  pair: string;
  timeframe: string;
  setup: string;
  direction: 'BUY' | 'SELL';
  marketRegime?: string;
  completedTrades?: any[];
}

export interface PerformanceValidatorResult {
  status: PerformanceValidatorStatus;
  sampleSize: number;
  winRate: number | null;
  expectancyR: number | null;
  averageWinR: number | null;
  averageLossR: number | null;
  consecutiveLosses: number;
  consecutiveWins: number;
  evidenceLevel: EvidenceLevel;
  adaptiveInfluence: AdaptiveInfluence;
  fallbackLevelUsed: string;
  reasonCodes: string[];
  explanation: string;
}

/**
 * Validates adaptive performance, sample-size reliability, out-of-sample deterioration,
 * and anti-overfitting protection.
 */
export function validateAdaptivePerformance(input: PerformanceValidatorInput): PerformanceValidatorResult {
  const reasonCodes: string[] = [];
  const pair = (input.pair || 'EURUSD').toUpperCase();
  const timeframe = (input.timeframe || 'M5').toUpperCase();
  const setup = (input.setup || 'HYBRID').toUpperCase();
  const direction = (input.direction || 'BUY').toUpperCase();
  const marketRegime = (input.marketRegime || 'UNKNOWN').toUpperCase();

  const allTrades = filterValidCompletedTrades(input.completedTrades || []);
  const trades = input.userId ? allTrades.filter(t => t.user_id === input.userId) : allTrades;

  // Hierarchical lookup matching Stage 3B/3D hierarchy
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
            if (trades.length >= 10) {
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

  const sampleSize = matchingTrades.length;
  if (sampleSize === 0) {
    reasonCodes.push('ZERO_COMPLETED_TRADES');
    return {
      status: 'INSUFFICIENT_DATA',
      sampleSize: 0,
      winRate: null,
      expectancyR: null,
      averageWinR: null,
      averageLossR: null,
      consecutiveLosses: 0,
      consecutiveWins: 0,
      evidenceLevel: 'NONE',
      adaptiveInfluence: 'NONE',
      fallbackLevelUsed,
      reasonCodes,
      explanation: 'Insufficient data: zero completed trades in historical scope.'
    };
  }

  const metrics = computeMetricsForSubset(matchingTrades);
  const winRate = metrics.winRate;
  const expectancyR = metrics.expectancyR;
  const wins = matchingTrades.filter(t => (t.outcome || '').toUpperCase() === 'WIN');
  const losses = matchingTrades.filter(t => (t.outcome || '').toUpperCase() === 'LOSS');

  const averageWinR = wins.length > 0 ? wins.reduce((acc, t) => acc + Number(t.rr_achieved || 1.5), 0) / wins.length : null;
  const averageLossR = losses.length > 0 ? losses.reduce((acc, t) => acc + Number(t.rr_achieved || -1.0), 0) / losses.length : null;

  // Calculate consecutive wins / losses from most recent trades (sorted chronologically)
  const sortedTrades = [...matchingTrades].sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime());
  let consecutiveLosses = 0;
  let consecutiveWins = 0;
  let countingWins = true;
  let countingLosses = true;

  for (const t of sortedTrades) {
    const outcome = (t.outcome || '').toUpperCase();
    if (countingWins) {
      if (outcome === 'WIN') consecutiveWins++;
      else countingWins = false;
    }
    if (countingLosses) {
      if (outcome === 'LOSS') consecutiveLosses++;
      else countingLosses = false;
    }
  }

  // Sample-size protection & evidence level
  let evidenceLevel: EvidenceLevel = 'NONE';
  let adaptiveInfluence: AdaptiveInfluence = 'NONE';
  let status: PerformanceValidatorStatus = 'INSUFFICIENT_DATA';

  if (sampleSize < 10) {
    evidenceLevel = 'NONE';
    adaptiveInfluence = 'NONE';
    status = 'INSUFFICIENT_DATA';
    reasonCodes.push('SAMPLE_SIZE_UNDER_10');
  } else if (sampleSize < 20) {
    evidenceLevel = 'WEAK';
    adaptiveInfluence = 'INFORMATIONAL';
    status = 'OBSERVATIONAL';
    reasonCodes.push('OBSERVATIONAL_SAMPLE_10_19');
  } else if (sampleSize < 30) {
    evidenceLevel = 'MODERATE';
    adaptiveInfluence = expectancyR < -0.15 ? 'RESTRICTIVE' : 'INFORMATIONAL';
    status = expectancyR < -0.15 ? 'DETERIORATING' : 'VALIDATED';
    reasonCodes.push('MODERATE_SAMPLE_20_29');
  } else {
    evidenceLevel = 'STRONG';
    adaptiveInfluence = expectancyR < -0.1 ? 'RESTRICTIVE' : 'RESTRICTIVE'; // or VALIDATED
    status = expectancyR < -0.1 ? 'DETERIORATING' : 'VALIDATED';
    reasonCodes.push('STRONG_SAMPLE_30_PLUS');
  }

  // Out-of-sample walk-forward validation (split earlier vs recent if sample >= 20)
  if (sampleSize >= 20) {
    const splitIndex = Math.floor(sortedTrades.length * 0.7); // 70% earlier, 30% recent
    const earlierWindow = sortedTrades.slice(splitIndex); // older
    const recentWindow = sortedTrades.slice(0, splitIndex); // newer

    const earlierMetrics = computeMetricsForSubset(earlierWindow);
    const recentMetrics = computeMetricsForSubset(recentWindow);

    if (recentMetrics.expectancyR < earlierMetrics.expectancyR - 0.25 && recentMetrics.expectancyR < -0.1) {
      status = 'DETERIORATING';
      adaptiveInfluence = 'RESTRICTIVE';
      reasonCodes.push('WALK_FORWARD_DETERIORATING_DETECTED');
    } else if (earlierMetrics.expectancyR < -0.1 && recentMetrics.expectancyR > earlierMetrics.expectancyR + 0.2 && recentMetrics.expectancyR >= 0.0) {
      status = 'RECOVERING';
      adaptiveInfluence = 'INFORMATIONAL';
      reasonCodes.push('WALK_FORWARD_RECOVERING_DETECTED');
    }
  }

  const explanation = `Performance Status: ${status}, Influence: ${adaptiveInfluence}, Evidence: ${evidenceLevel}, Sample: ${sampleSize}, Expectancy: ${expectancyR !== null ? expectancyR.toFixed(2) + 'R' : 'N/A'}, WinRate: ${winRate !== null ? winRate.toFixed(1) + '%' : 'N/A'}, Hierarchy: ${fallbackLevelUsed}`;

  console.log(`[Adaptive Performance] ${explanation}`);

  return {
    status,
    sampleSize,
    winRate,
    expectancyR,
    averageWinR,
    averageLossR,
    consecutiveLosses,
    consecutiveWins,
    evidenceLevel,
    adaptiveInfluence,
    fallbackLevelUsed,
    reasonCodes,
    explanation
  };
}
