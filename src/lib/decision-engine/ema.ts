import { CompiledRules } from '../strategy-compiler/types';
import { EvaluationResult } from './types';

export class EmaEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.ema || !rules.ema.enabled) {
      return { matched: false, score: 0, reason: "EMA rule not active in strategy." };
    }

    const isFlatMatched = market.ema === true || market.ema_crossover === true;
    const isTrendMatched = market.trend && market.trend !== 'SIDEWAYS';
    
    // Fallback matched condition if any of the above is true
    const matched = isFlatMatched || isTrendMatched;

    const periodsStr = rules.ema.periods ? rules.ema.periods.join('/') : 'custom';
    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? `EMA (${periodsStr}) condition/trend satisfied by current market trend (${market.trend || 'Trending'}).`
        : `EMA (${periodsStr}) trend alignment or crossover not confirmed (Market is ${market.trend || 'Sideways'}).`
    };
  }
}
