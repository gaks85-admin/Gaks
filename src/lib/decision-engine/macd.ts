import { CompiledRules } from '../strategy-compiler/types';
import { EvaluationResult } from './types';

export class MacdEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.macd || !rules.macd.enabled) {
      return { matched: false, score: 0, reason: "MACD rule not active in strategy." };
    }

    const isFlatMatched = market.macd === true || market.macd_crossover === true || market.macd_signal === true;
    
    // Check if there is any custom signal in market
    const matched = isFlatMatched;

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? "MACD crossover or trigger line alignment confirmed."
        : "No MACD crossover or signal detected in current market structure."
    };
  }
}
