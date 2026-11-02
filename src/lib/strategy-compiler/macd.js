import { macdSynonyms } from './synonyms/macd.js';
import { findSynonymMatch } from './normalizer.js';
export class MacdParser {
    parse(text) {
        const match = findSynonymMatch(text, macdSynonyms, 'macd', 0.98);
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
