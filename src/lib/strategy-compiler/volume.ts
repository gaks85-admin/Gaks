import { ParserResult, StrategyParserModule } from './types';
import { volumeSynonyms } from './synonyms/volume';
import { findSynonymMatch } from './normalizer';

export class VolumeParser implements StrategyParserModule<boolean> {
  parse(text: string): ParserResult<boolean> {
    const match = findSynonymMatch(text, volumeSynonyms, 'VOLUME_CONFIRMATION', 0.95);
    
    return {
      supported: match.matched,
      confidence: match.confidence,
      parsedRule: match.matched,
      matchedPhrase: match.matchedPhrase,
      canonicalRule: match.canonicalRule
    };
  }
}
