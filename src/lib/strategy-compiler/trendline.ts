import { ParserResult, StrategyParserModule } from './types';
import { trendlineSynonyms } from './synonyms/trendline';
import { findSynonymMatch, normalizeText } from './normalizer';

export interface TrendlineRule {
  trendline_breakout: boolean;
  break_and_retest: boolean;
}

export class TrendlineParser implements StrategyParserModule<TrendlineRule> {
  parse(text: string): ParserResult<TrendlineRule> {
    const match = findSynonymMatch(text, trendlineSynonyms, 'TRENDLINE_BREAKOUT', 0.95);
    
    const normalized = normalizeText(text);
    
    const hasTrendline = match.matched || normalized.includes('trendline breakout') || normalized.includes('trendline break') || normalized.includes('trendline violation');
    const hasRetest = normalized.includes('break retest') || normalized.includes('break and retest') || normalized.includes('retest');
    
    const supported = hasTrendline || hasRetest;
    
    return {
      supported,
      confidence: supported ? 0.95 : 0.0,
      parsedRule: {
        trendline_breakout: hasTrendline,
        break_and_retest: hasRetest
      },
      matchedPhrase: match.matched ? match.matchedPhrase : (hasTrendline ? "trendline" : (hasRetest ? "retest" : "")),
      canonicalRule: match.matched ? match.canonicalRule : "TRENDLINE"
    };
  }
}
