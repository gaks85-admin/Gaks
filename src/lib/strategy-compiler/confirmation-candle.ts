import { ParserResult, StrategyParserModule } from './types';
import { confirmationCandleSynonyms } from './synonyms/confirmation-candle';
import { findSynonymMatch } from './normalizer';

export class ConfirmationCandleParser implements StrategyParserModule<boolean> {
  parse(text: string): ParserResult<boolean> {
    const match = findSynonymMatch(text, confirmationCandleSynonyms, 'CONFIRMATION_CANDLE', 0.95);
    
    return {
      supported: match.matched,
      confidence: match.confidence,
      parsedRule: match.matched,
      matchedPhrase: match.matchedPhrase,
      canonicalRule: match.canonicalRule
    };
  }
}
