import { CompiledRules } from '../strategy-compiler/types.js';
import { EvaluationResult } from './types.js';

export class ChochEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.choch) {
      return { matched: false, score: 0, reason: "CHOCH rule not active in strategy." };
    }

    const isFlatMatched = market.choch === true || market.choch?.matched === true;
    const isNestedMatched = market.CHOCH && Array.isArray(market.CHOCH) && 
      market.CHOCH.some((c: any) => c.type === 'BULLISH_CHOCH' || c.type === 'BEARISH_CHOCH');

    const matched = isFlatMatched || isNestedMatched;

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? "Change of Character (CHOCH) confirmed in market structure."
        : "No Change of Character (CHOCH) detected in current market structure."
    };
  }
}
