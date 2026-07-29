import { CompiledRules } from '../strategy-compiler/types';
import { EvaluationResult } from './types';

export class TimeframeEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.timeframes || !Array.isArray(rules.timeframes) || rules.timeframes.length === 0) {
      return { matched: false, score: 0, reason: "Timeframe Filter rule not active in strategy." };
    }

    const compiledTfs = rules.timeframes.map(t => t.toLowerCase().trim());
    
    let matched = false;
    let marketTfVal = "";

    if (typeof market.timeframe === 'string') {
      marketTfVal = market.timeframe;
      const lowerT = marketTfVal.toLowerCase().trim();
      matched = compiledTfs.some(ct => lowerT.includes(ct) || ct.includes(lowerT));
    } else if (Array.isArray(market.timeframes)) {
      marketTfVal = market.timeframes.join(", ");
      matched = market.timeframes.some((mt: string) => 
        compiledTfs.some(ct => mt.toLowerCase().trim().includes(ct) || ct.includes(mt.toLowerCase().trim()))
      );
    } else if (market.timeframe === true) {
      matched = true;
      marketTfVal = "any";
    }

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? `Current market timeframe (${marketTfVal}) is allowed by the strategy: ${rules.timeframes.join(', ')}.`
        : `Current market timeframe (${marketTfVal || 'None'}) is not in allowed strategy timeframes: ${rules.timeframes.join(', ')}.`
    };
  }
}
