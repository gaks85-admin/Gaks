import { CompiledRules } from '../strategy-compiler/types.js';
import { EvaluationResult } from './types.js';

export class SupportEvaluator {
  evaluateSupport(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.support) {
      return { matched: false, score: 0, scoreOutOf10: 0, reason: "Support Zone rule not active in strategy." };
    }

    const isFlatMatched = market.support === true;
    const isNestedMatched = market.supportZones && Array.isArray(market.supportZones) && 
      market.supportZones.length > 0;
    const isSwingLowNear = market.swingLows && Array.isArray(market.swingLows) && market.swingLows.length > 0;
    const isObNear = market.orderBlocks && Array.isArray(market.orderBlocks) && market.orderBlocks.some((b: any) => b.type === 'BULLISH');

    let scoreOutOf10 = 0;
    let matched = false;
    let reason = "";

    if (isFlatMatched || isNestedMatched) {
      scoreOutOf10 = 10;
      matched = true;
      reason = "Price is trading directly at or in a key support zone (10/10).";
    } else if (isObNear || isSwingLowNear) {
      scoreOutOf10 = 7;
      matched = true;
      reason = "Bullish order block or swing low structure detected in close proximity (7/10).";
    } else {
      scoreOutOf10 = 0;
      matched = false;
      reason = "No key support zone or swing low detected in immediate proximity (0/10).";
    }

    return {
      matched,
      score: scoreOutOf10 / 10,
      scoreOutOf10,
      reason
    };
  }

  evaluateSupportRejection(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.support_rejection) {
      return { matched: false, score: 0, scoreOutOf10: 0, reason: "Support Rejection rule not active in strategy." };
    }

    const isFlatMatched = market.support_rejection === true;
    const isNestedMatched = market.retests && Array.isArray(market.retests) && market.retests.length > 0;
    
    // Check for bullish candle patterns (e.g., rejection pin bar, bullish engulfing)
    const isCandleRejection = market.candlePatterns && Array.isArray(market.candlePatterns) &&
      market.candlePatterns.some((p: any) => p.direction === 'BULLISH');
    const isWickRejection = market.lowerWickRejection === true || market.wickRejection === true;

    let scoreOutOf10 = 0;
    let matched = false;
    let reason = "";

    if (isFlatMatched || (isNestedMatched && isCandleRejection)) {
      scoreOutOf10 = 10;
      matched = true;
      reason = "Strong bullish rejection & candle bounce from support zone confirmed (10/10).";
    } else if (isCandleRejection || isNestedMatched || isWickRejection) {
      scoreOutOf10 = 8;
      matched = true;
      reason = "Bullish rejection wick or candle pattern detected near support (8/10).";
    } else {
      scoreOutOf10 = 0;
      matched = false;
      reason = "No bullish rejection or bounce detected at support zone (0/10).";
    }

    return {
      matched,
      score: scoreOutOf10 / 10,
      scoreOutOf10,
      reason
    };
  }
}
