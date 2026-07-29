import { ParserResult, StrategyParserModule } from './types';
import { chochSynonyms } from './synonyms/choch';
import { findSynonymMatch } from './normalizer';

export class ChochParser implements StrategyParserModule<boolean> {
  parse(text: string): ParserResult<boolean> {
    const match = findSynonymMatch(text, chochSynonyms, 'CHANGE_OF_CHARACTER', 0.98);
    
    return {
      supported: match.matched,
      confidence: match.confidence,
      parsedRule: match.matched,
      matchedPhrase: match.matchedPhrase,
      canonicalRule: match.canonicalRule
    };
  }
}
