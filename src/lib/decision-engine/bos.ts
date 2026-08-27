import { CompiledRules } from '../strategy-compiler/types.js';
import { EvaluationResult } from './types.js';

export class BosEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.bos) {
      return { matched: false, score: 0, reason: "BOS rule not active in strategy." };
    }

    const isFlatMatched = market.bos === true || market.bos?.matched === true;
    const isNestedMatched = market.BOS && Array.isArray(market.BOS) && 
      market.BOS.some((b: any) => b.type === 'BULLISH_BOS' || b.type === 'BEARISH_BOS');

    const matched = isFlatMatched || isNestedMatched;

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? "Break of Structure (BOS) confirmed in market structure."
        : "No Break of Structure (BOS) detected in current market structure."
    };
  }
}
