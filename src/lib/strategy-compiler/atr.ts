import { ParserResult, StrategyParserModule } from './types';
import { atrSynonyms } from './synonyms/atr';
import { findSynonymMatch } from './normalizer';

export interface AtrRule {
  enabled: boolean;
}

export class AtrParser implements StrategyParserModule<AtrRule> {
  parse(text: string): ParserResult<AtrRule> {
    const match = findSynonymMatch(text, atrSynonyms, 'ATR_FILTER', 0.98);
    
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
