import { riskRewardSynonyms } from "./synonyms/risk-reward.js";
import { findSynonymMatch } from "./normalizer.js";
class RiskRewardParser {
  parse(text) {
    const match = findSynonymMatch(text, riskRewardSynonyms, "RISK_REWARD", 0.95);
    let min_ratio;
    const normalized = text.toLowerCase();
    const ratioMatches = normalized.match(/(?:1\s*:\s*|1\s*to\s*)(\d+(?:\.\d+)?)|(\d+(?:\.\d+)?)\s*(?:rr|r:r|r\/r)|\b(?:ratio\s*of|min|minimum)\s*(\d+(?:\.\d+)?)/i);
    if (ratioMatches) {
      const valStr = ratioMatches[1] || ratioMatches[2] || ratioMatches[3];
      if (valStr) {
        const val = parseFloat(valStr);
        if (val > 0 && val < 50) {
          min_ratio = val;
        }
      }
    }
    const supported = match.matched || min_ratio !== void 0;
    return {
      supported,
      confidence: supported ? 0.95 : 0,
      parsedRule: {
        min_ratio
      },
      matchedPhrase: match.matched ? match.matchedPhrase : min_ratio ? "ratio" : "",
      canonicalRule: match.matched ? match.canonicalRule : min_ratio ? "RISK_REWARD" : ""
    };
  }
}
export {
  RiskRewardParser
};
