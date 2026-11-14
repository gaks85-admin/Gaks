import { bosSynonyms } from "./synonyms/bos.js";
import { findSynonymMatch } from "./normalizer.js";
class BosParser {
  parse(text) {
    const match = findSynonymMatch(text, bosSynonyms, "bos", 0.98);
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
  BosParser
};
