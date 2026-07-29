import { CompiledRules } from '../strategy-compiler/types';
import { EvaluationResult } from './types';

export class SessionEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.session || !Array.isArray(rules.session) || rules.session.length === 0) {
      return { matched: false, score: 0, reason: "Session Filter rule not active in strategy." };
    }

    const compiledSessions = rules.session.map(s => s.toLowerCase().trim());
    
    let matched = false;
    let marketSessionVal = "";

    if (typeof market.session === 'string') {
      marketSessionVal = market.session;
      const lowerS = marketSessionVal.toLowerCase().trim();
      matched = compiledSessions.some(cs => lowerS.includes(cs) || cs.includes(lowerS));
    } else if (Array.isArray(market.sessions)) {
      marketSessionVal = market.sessions.join(", ");
      matched = market.sessions.some((ms: string) => 
        compiledSessions.some(cs => ms.toLowerCase().trim().includes(cs) || cs.includes(ms.toLowerCase().trim()))
      );
    } else if (market.session === true) {
      matched = true;
      marketSessionVal = "any";
    }

    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched
        ? `Current market session (${marketSessionVal}) matches allowed trading sessions: ${rules.session.join(', ')}.`
        : `Current market session (${marketSessionVal || 'None'}) is outside allowed trading sessions: ${rules.session.join(', ')}.`
    };
  }
}
