import { CompiledRules } from '../strategy-compiler/types.js';
import { EvaluationResult } from './types.js';

export class EmaEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.ema || !rules.ema.enabled) {
      return { matched: false, score: 0, reason: "EMA rule not active in strategy." };
    }

    const isFlatMatched = market.ema === true || market.ema_crossover === true;
    const isFlatFailed = market.ema === false || market.ema_crossover === false;
    const isTrendMatched = market.trend && market.trend !== 'SIDEWAYS';
    
    // Strict priority: If market data explicitly says it failed, then it failed.
    // Otherwise, if it passed or if trend is strong, it passes.
    let matched = false;
    if (isFlatFailed) {
      matched = false;
    } else {
      matched = isFlatMatched || isTrendMatched;
    }

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
