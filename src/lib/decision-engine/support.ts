import { CompiledRules } from '../strategy-compiler/types';
import { EvaluationResult } from './types';

export class SupportEvaluator {
  evaluateSupport(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.support) {
      return { matched: false, score: 0, reason: "Support Zone rule not active in strategy." };
    }

    const isFlatMatched = market.support === true;
    const isNestedMatched = market.supportZones && Array.isArray(market.supportZones) && 
      market.supportZones.length > 0;

    const matched = isFlatMatched || isNestedMatched;

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? "Price is trading at or near a key support zone."
        : "No key support zone detected in proximity to current price."
    };
  }

  evaluateSupportRejection(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.support_rejection) {
      return { matched: false, score: 0, reason: "Support Rejection rule not active in strategy." };
    }

    const isFlatMatched = market.support_rejection === true;
    const isNestedMatched = market.retests && Array.isArray(market.retests) && market.retests.length > 0;
    
    // Check for bullish candle patterns (e.g., rejection pin bar, bullish engulfing)
    const isCandleRejection = market.candlePatterns && Array.isArray(market.candlePatterns) &&
      market.candlePatterns.some((p: any) => p.direction === 'BULLISH');

    const matched = isFlatMatched || isNestedMatched || isCandleRejection;

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? "Bullish rejection/bounce from support zone confirmed."
        : "No bullish rejection or bounce detected at support zone."
    };
  }
}
