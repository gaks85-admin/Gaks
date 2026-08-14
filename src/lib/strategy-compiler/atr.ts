import { ParserResult, StrategyParserModule } from './types.js';
import { atrSynonyms } from './synonyms/atr.js';
import { findSynonymMatch } from './normalizer.js';

export interface AtrRule {
  enabled: boolean;
}

export class AtrParser implements StrategyParserModule<AtrRule> {
  parse(text: string): ParserResult<AtrRule> {
    const match = findSynonymMatch(text, atrSynonyms, 'atr', 0.98);
    
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
