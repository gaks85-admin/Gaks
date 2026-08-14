import { ParserResult, StrategyParserModule } from './types.js';
import { chochSynonyms } from './synonyms/choch.js';
import { findSynonymMatch } from './normalizer.js';

export class ChochParser implements StrategyParserModule<boolean> {
  parse(text: string): ParserResult<boolean> {
    const match = findSynonymMatch(text, chochSynonyms, 'choch', 0.98);
    
    return {
      supported: match.matched,
      confidence: match.confidence,
      parsedRule: match.matched,
      matchedPhrase: match.matchedPhrase,
      canonicalRule: match.canonicalRule
    };
  }
}
