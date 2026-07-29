import { CompiledRules } from '../strategy-compiler/types';
import { EvaluationResult } from './types';

export class ConfirmationCandleEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.confirmation_candle) {
      return { matched: false, score: 0, reason: "Confirmation Candle rule not active in strategy." };
    }

    const isFlatMatched = market.confirmation_candle === true || market.candle_confirmation === true;
    const isNestedMatched = market.candlePatterns && Array.isArray(market.candlePatterns) && 
      market.candlePatterns.length > 0;

    const matched = isFlatMatched || isNestedMatched;

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? "Confirmation candle pattern (e.g. Pin bar or Engulfing) confirmed."
        : "No confirmation candle pattern found in recent price action."
    };
  }
}
