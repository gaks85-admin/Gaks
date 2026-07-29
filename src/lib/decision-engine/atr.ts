import { CompiledRules } from '../strategy-compiler/types.js';
import { EvaluationResult } from './types.js';

export class AtrEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.atr || !rules.atr.enabled) {
      return { matched: false, score: 0, reason: "ATR rule not active in strategy." };
    }

    const isFlatMatched = market.atr === true || market.volatility_confirmation === true;
    const isNestedMatched = market.volatilityInformation && 
      (market.volatilityInformation.volatilityLevel !== 'LOW' || market.volatilityInformation.atr > 0);

    const matched = isFlatMatched || !!isNestedMatched;

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? `ATR volatility filter satisfied (Market volatility level: ${market.volatilityInformation?.volatilityLevel || 'NORMAL'}).`
        : "ATR volatility filter failed (Volatility level is too low or undefined)."
    };
  }
}
