import { CompiledRules } from '../strategy-compiler/types.js';
import { EvaluationResult } from './types.js';

export class LiquidityEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.liquidity_sweep) {
      return { matched: false, score: 0, reason: "Liquidity Sweep rule not active in strategy." };
    }

    const isFlatMatched = market.liquidity_sweep === true || market.liquidity === true;
    const isNestedMatched = market.liquiditySweeps && Array.isArray(market.liquiditySweeps) && 
      market.liquiditySweeps.some((l: any) => l.type === 'HIGH_SWEEP' || l.type === 'LOW_SWEEP');

    const matched = isFlatMatched || isNestedMatched;

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? "Liquidity sweep confirmed at structural high/low."
        : "No liquidity sweep detected in current market structure."
    };
  }
}
