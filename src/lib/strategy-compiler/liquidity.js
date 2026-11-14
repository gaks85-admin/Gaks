import { liquiditySynonyms } from "./synonyms/liquidity.js";
import { findSynonymMatch } from "./normalizer.js";
class LiquidityParser {
  parse(text) {
    const match = findSynonymMatch(text, liquiditySynonyms, "liquidity_sweep", 0.95);
    return {
      supported: match.matched,
      confidence: match.confidence,
      parsedRule: match.matched,
      matchedPhrase: match.matchedPhrase,
      canonicalRule: match.canonicalRule
    };
  }
}
export {
  LiquidityParser
};
