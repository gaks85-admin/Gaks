import { ParserResult, StrategyParserModule } from './types.js';
import { fvgSynonyms } from './synonyms/fvg.js';
import { findSynonymMatch } from './normalizer.js';

export class FvgParser implements StrategyParserModule<boolean> {
  parse(text: string): ParserResult<boolean> {
    const match = findSynonymMatch(text, fvgSynonyms, 'fair_value_gap', 0.98);
    
    return {
      supported: match.matched,
      confidence: match.confidence,
      parsedRule: match.matched,
      matchedPhrase: match.matchedPhrase,
      canonicalRule: match.canonicalRule
    };
  }
}
