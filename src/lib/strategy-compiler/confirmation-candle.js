import { confirmationCandleSynonyms } from "./synonyms/confirmation-candle.js";
import { findSynonymMatch } from "./normalizer.js";
class ConfirmationCandleParser {
  parse(text) {
    const match = findSynonymMatch(text, confirmationCandleSynonyms, "CONFIRMATION_CANDLE", 0.95);
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
  ConfirmationCandleParser
};
