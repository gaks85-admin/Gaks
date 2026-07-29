import { ParserResult, StrategyParserModule } from './types';

export interface RiskRewardRule {
  min_ratio?: number;
}

export class RiskRewardParser implements StrategyParserModule<RiskRewardRule> {
  parse(text: string): ParserResult<RiskRewardRule> {
    const normalized = text.toLowerCase();
    let min_ratio: number | undefined;
    
    // Check for "risk reward", "rr", "r:r", "r/r"
    const hasRr = /risk\s*reward|r\s*(?::|\/)\s*r|\brr\b/i.test(normalized);
    
    // Extract ratio strings like "1:2", "1:3.5", "1 to 2", "minimum of 3"
    const ratioMatches = normalized.match(/(?:1\s*:\s*|1\s*to\s*)(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:rr|r:r|r\/r)|\b(?:ratio\s*of|min|minimum)\s*(\d+(?:\.\d+)?)/i);
    
    if (ratioMatches) {
      const valStr = ratioMatches[1] || ratioMatches[2] || ratioMatches[3];
      if (valStr) {
        const val = parseFloat(valStr);
        if (val > 0 && val < 50) {
          min_ratio = val;
        }
      }
    }
    
    return {
      supported: hasRr || min_ratio !== undefined,
      confidence: (hasRr || min_ratio !== undefined) ? 0.95 : 0.0,
      parsedRule: {
        min_ratio
      }
    };
  }
}
