import { ParserResult, StrategyParserModule } from './types.js';
import { macdSynonyms } from './synonyms/macd.js';
import { findSynonymMatch } from './normalizer.js';

export interface MacdRule {
  enabled: boolean;
}

export class MacdParser implements StrategyParserModule<MacdRule> {
  parse(text: string): ParserResult<MacdRule> {
    const match = findSynonymMatch(text, macdSynonyms, 'macd', 0.98);
    
    return {
      supported: match.matched,
      confidence: match.confidence,
      parsedRule: {
        enabled: match.matched
      },
      matchedPhrase: match.matchedPhrase,
      canonicalRule: match.canonicalRule
    };
  }
}
