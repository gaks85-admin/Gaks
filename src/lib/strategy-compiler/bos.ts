import { ParserResult, StrategyParserModule } from './types.js';
import { bosSynonyms } from './synonyms/bos.js';
import { findSynonymMatch } from './normalizer.js';

export class BosParser implements StrategyParserModule<boolean> {
  parse(text: string): ParserResult<boolean> {
    const match = findSynonymMatch(text, bosSynonyms, 'BREAK_OF_STRUCTURE', 0.98);
    
    return {
      supported: match.matched,
      confidence: match.confidence,
      parsedRule: match.matched,
      matchedPhrase: match.matchedPhrase,
      canonicalRule: match.canonicalRule
    };
  }
}
