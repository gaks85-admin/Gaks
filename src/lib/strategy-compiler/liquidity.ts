import { ParserResult, StrategyParserModule } from './types.js';
import { liquiditySynonyms } from './synonyms/liquidity.js';
import { findSynonymMatch } from './normalizer.js';

export class LiquidityParser implements StrategyParserModule<boolean> {
  parse(text: string): ParserResult<boolean> {
    const match = findSynonymMatch(text, liquiditySynonyms, 'LIQUIDITY_SWEEP', 0.95);
    
    return {
      supported: match.matched,
      confidence: match.confidence,
      parsedRule: match.matched,
      matchedPhrase: match.matchedPhrase,
      canonicalRule: match.canonicalRule
    };
  }
}
