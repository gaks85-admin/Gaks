import { CompiledRules } from '../strategy-compiler/types.js';
import { EvaluationResult } from './types.js';

export class RiskRewardEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.risk_reward || rules.risk_reward.min_ratio === undefined) {
      return { matched: false, score: 0, reason: "Risk Reward rule not active in strategy." };
    }

    const minRatio = rules.risk_reward.min_ratio;
    let matched = false;
    let detail = "";

    const marketRatio = market.risk_reward_ratio !== undefined 
      ? market.risk_reward_ratio 
      : (market.rr !== undefined ? market.rr : undefined);

    if (marketRatio !== undefined) {
      matched = marketRatio >= minRatio;
      detail = `Market risk-reward ratio is ${marketRatio} (Required min: ${minRatio}).`;
    } else if (market.risk_reward === true || market.rr_validation_passed === true) {
      matched = true;
      detail = "Risk-reward criteria confirmed by market structure.";
    } else if (market.risk_reward === false || market.rr_validation_passed === false) {
      matched = false;
      detail = "Risk-reward criteria rejected by market structure.";
    } else {
      // If not specified in market structure, we can assume it's acceptable (default to matched)
      matched = true;
      detail = `No market risk-reward specified. Assuming strategy minimum ${minRatio}:1 is feasible.`;
    }

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched ? `Risk Reward matched: ${detail}` : `Risk Reward failed: ${detail}`
    };
  }
}
