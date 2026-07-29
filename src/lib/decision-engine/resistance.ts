import { CompiledRules } from '../strategy-compiler/types.js';
import { EvaluationResult } from './types.js';

export class ResistanceEvaluator {
  evaluateResistance(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.resistance) {
      return { matched: false, score: 0, reason: "Resistance Zone rule not active in strategy." };
    }

    const isFlatMatched = market.resistance === true;
    const isNestedMatched = market.resistanceZones && Array.isArray(market.resistanceZones) && 
      market.resistanceZones.length > 0;

    const matched = isFlatMatched || isNestedMatched;

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? "Price is trading at or near a key resistance zone."
        : "No key resistance zone detected in proximity to current price."
    };
  }

  evaluateResistanceRejection(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.resistance_rejection) {
      return { matched: false, score: 0, reason: "Resistance Rejection rule not active in strategy." };
    }

    const isFlatMatched = market.resistance_rejection === true;
    const isNestedMatched = market.retests && Array.isArray(market.retests) && market.retests.length > 0;
    
    // Check for bearish candle patterns (rejection)
    const isCandleRejection = market.candlePatterns && Array.isArray(market.candlePatterns) &&
      market.candlePatterns.some((p: any) => p.direction === 'BEARISH');

    const matched = isFlatMatched || isNestedMatched || isCandleRejection;

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? "Bearish rejection/bounce from resistance zone confirmed."
        : "No bearish rejection or bounce detected at resistance zone."
    };
  }
}
