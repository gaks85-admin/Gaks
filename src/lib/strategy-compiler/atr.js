import { atrSynonyms } from "./synonyms/atr.js";
import { findSynonymMatch } from "./normalizer.js";
class AtrParser {
  parse(text) {
    const match = findSynonymMatch(text, atrSynonyms, "atr", 0.98);
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
export {
  AtrParser
};
