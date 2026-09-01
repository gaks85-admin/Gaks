import { ParserResult, StrategyParserModule } from './types.js';
import { orderBlockSynonyms } from './synonyms/order-block.js';
import { findSynonymMatch } from './normalizer.js';

export interface OrderBlockRule {
  order_block: boolean;
  supply_demand: boolean;
  unmitigated_zone: boolean;
}

export class OrderBlockParser implements StrategyParserModule<OrderBlockRule> {
  parse(text: string): ParserResult<OrderBlockRule> {
    const match = findSynonymMatch(text, orderBlockSynonyms, 'order_block', 0.95);
    const lower = (text || '').toLowerCase();
    const hasUnmitigated = lower.includes('unmitigated') || lower.includes('fresh');
    const hasSupplyDemand = lower.includes('supply') || lower.includes('demand');
    
    return {
      supported: match.matched,
      confidence: match.confidence,
      parsedRule: {
        order_block: match.matched,
        supply_demand: match.matched && hasSupplyDemand,
        unmitigated_zone: match.matched && hasUnmitigated,
      },
      matchedPhrase: match.matchedPhrase,
      canonicalRule: match.canonicalRule
    };
  }
}
