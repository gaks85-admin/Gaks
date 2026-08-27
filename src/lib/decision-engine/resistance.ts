import { CompiledRules } from '../strategy-compiler/types.js';
import { EvaluationResult } from './types.js';

export class ResistanceEvaluator {
  evaluateResistance(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.resistance) {
      return { matched: false, score: 0, scoreOutOf10: 0, reason: "Resistance Zone rule not active in strategy." };
    }

    const isFlatMatched = market.resistance === true;
    const isNestedMatched = market.resistanceZones && Array.isArray(market.resistanceZones) && 
      market.resistanceZones.length > 0;
    const isSwingHighNear = market.swingHighs && Array.isArray(market.swingHighs) && market.swingHighs.length > 0;
    const isObNear = market.orderBlocks && Array.isArray(market.orderBlocks) && market.orderBlocks.some((b: any) => b.type === 'BEARISH');

    let scoreOutOf10 = 0;
    let matched = false;
    let reason = "";

    if (isFlatMatched || isNestedMatched) {
      scoreOutOf10 = 10;
      matched = true;
      reason = "Price is trading directly at or in a key resistance zone (10/10).";
    } else if (isObNear || isSwingHighNear) {
      scoreOutOf10 = 7;
      matched = true;
      reason = "Bearish order block or swing high structure detected in close proximity (7/10).";
    } else {
      scoreOutOf10 = 0;
      matched = false;
      reason = "No key resistance zone or swing high detected in immediate proximity (0/10).";
    }

    return {
      matched,
      score: scoreOutOf10 / 10,
      scoreOutOf10,
      reason
    };
  }

  evaluateResistanceRejection(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.resistance_rejection) {
      return { matched: false, score: 0, scoreOutOf10: 0, reason: "Resistance Rejection rule not active in strategy." };
    }

    const isFlatMatched = market.resistance_rejection === true;
    const isNestedMatched = market.retests && Array.isArray(market.retests) && market.retests.length > 0;
    
    // Check for bearish candle patterns (rejection)
    const isCandleRejection = market.candlePatterns && Array.isArray(market.candlePatterns) &&
      market.candlePatterns.some((p: any) => p.direction === 'BEARISH');
    const isWickRejection = market.upperWickRejection === true || market.wickRejection === true;

    let scoreOutOf10 = 0;
    let matched = false;
    let reason = "";

    if (isFlatMatched || (isNestedMatched && isCandleRejection)) {
      scoreOutOf10 = 10;
      matched = true;
      reason = "Strong bearish rejection & candle bounce from resistance zone confirmed (10/10).";
    } else if (isCandleRejection || isNestedMatched || isWickRejection) {
      scoreOutOf10 = 8;
      matched = true;
      reason = "Bearish rejection wick or candle pattern detected near resistance (8/10).";
    } else {
      scoreOutOf10 = 0;
      matched = false;
      reason = "No bearish rejection or bounce detected at resistance zone (0/10).";
    }

    return {
      matched,
      score: scoreOutOf10 / 10,
      scoreOutOf10,
      reason
    };
  }
}
