import { CompiledRules } from '../strategy-compiler/types.js';
import { EvaluationResult } from './types.js';

export class TrendlineEvaluator {
  evaluateBreakout(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.trendline_breakout) {
      return { matched: false, score: 0, reason: "Trendline Breakout rule not active in strategy." };
    }

    // Support both flat representation (e.g. market.trendline_breakout = true) and nested (e.g. breakouts)
    const isFlatMatched = market.trendline_breakout === true || market.trendline_breakout?.matched === true;
    const isNestedMatched = market.breakouts && Array.isArray(market.breakouts) && 
      market.breakouts.some((b: any) => b.type === 'UPPER_BREAKOUT' || b.type === 'LOWER_BREAKOUT');
    const isTrendlinePresent = market.trendlines && Array.isArray(market.trendlines) && market.trendlines.length > 0;

    const matched = isFlatMatched || isNestedMatched || isTrendlinePresent;

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched 
        ? "Market structure confirms a trendline breakout." 
        : "No trendline breakout detected in current market structure."
    };
  }

  evaluateRetest(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.break_and_retest) {
      return { matched: false, score: 0, reason: "Break and Retest rule not active in strategy." };
    }

    const isFlatMatched = market.break_and_retest === true || market.break_and_retest?.matched === true;
    const isNestedMatched = market.retests && Array.isArray(market.retests) && 
      market.retests.some((r: any) => r.confirmed === true);

    const matched = isFlatMatched || isNestedMatched;

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? "Market structure confirms a break and retest level."
        : "No break and retest pattern confirmed in current market structure."
    };
  }
}
