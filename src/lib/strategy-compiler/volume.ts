import { ParserResult, StrategyParserModule } from './types.js';
import { volumeSynonyms } from './synonyms/volume.js';
import { findSynonymMatch } from './normalizer.js';

export class VolumeParser implements StrategyParserModule<boolean> {
  parse(text: string): ParserResult<boolean> {
    const match = findSynonymMatch(text, volumeSynonyms, 'volume_confirmation', 0.95);
    
    return {
      supported: match.matched,
      confidence: match.confidence,
      parsedRule: match.matched,
      matchedPhrase: match.matchedPhrase,
      canonicalRule: match.canonicalRule
    };
  }
}
