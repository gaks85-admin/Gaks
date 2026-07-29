import { CompiledRules } from '../strategy-compiler/types';
import { EvaluationResult } from './types';

export class FvgEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.fair_value_gap) {
      return { matched: false, score: 0, reason: "Fair Value Gap (FVG) rule not active in strategy." };
    }

    const isFlatMatched = market.fair_value_gap === true || market.fvg === true;
    const isNestedMatched = market.fairValueGaps && Array.isArray(market.fairValueGaps) && 
      market.fairValueGaps.length > 0;

    const matched = isFlatMatched || isNestedMatched;

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? "Fair Value Gap (FVG) or market imbalance detected."
        : "No Fair Value Gap (FVG) found in current market structure."
    };
  }
}
