import { chochSynonyms } from "./synonyms/choch.js";
import { findSynonymMatch } from "./normalizer.js";
class ChochParser {
  parse(text) {
    const match = findSynonymMatch(text, chochSynonyms, "choch", 0.98);
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
  ChochParser
};
