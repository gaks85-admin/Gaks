import { orderBlockSynonyms } from "./synonyms/order-block.js";
import { findSynonymMatch } from "./normalizer.js";
class OrderBlockParser {
  parse(text) {
    const match = findSynonymMatch(text, orderBlockSynonyms, "order_block", 0.95);
    const lower = (text || "").toLowerCase();
    const hasUnmitigated = lower.includes("unmitigated") || lower.includes("fresh");
    const hasSupplyDemand = lower.includes("supply") || lower.includes("demand");
    return {
      supported: match.matched,
      confidence: match.confidence,
      parsedRule: {
        order_block: match.matched,
        supply_demand: match.matched && hasSupplyDemand,
        unmitigated_zone: match.matched && hasUnmitigated
      },
      matchedPhrase: match.matchedPhrase,
      canonicalRule: match.canonicalRule
    };
  }
}
export {
  OrderBlockParser
};
