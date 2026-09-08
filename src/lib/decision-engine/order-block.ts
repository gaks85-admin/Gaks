import { CompiledRules } from '../strategy-compiler/types.js';
import { EvaluationResult } from './types.js';

export class OrderBlockEvaluator {
  evaluate(rules: CompiledRules, market: any): EvaluationResult {
    if (!rules.order_block && !rules.supply_demand && !rules.unmitigated_zone) {
      return { matched: false, score: 0, scoreOutOf10: 0, reason: "Order Block rule not active in strategy." };
    }

    const isFlatMatched = market.order_block === true || market.order_block?.matched === true ||
                          market.supply_demand === true || market.unmitigated_zone === true;

    const hasBullishOb = market.orderBlocks && Array.isArray(market.orderBlocks) && market.orderBlocks.some((b: any) => b.type === 'BULLISH' || b.type === 'BULLISH_ORDER_BLOCK');
    const hasBearishOb = market.orderBlocks && Array.isArray(market.orderBlocks) && market.orderBlocks.some((b: any) => b.type === 'BEARISH' || b.type === 'BEARISH_ORDER_BLOCK');
    
    // Also check active marked zone from zone engine or market structure
    const hasActiveZone = market.zone_status === 'ZONE_TAPPED' || 
                          market.zone_status === 'WAITING_FOR_TAP' || 
                          market.zone_status === 'CONFIRMED' ||
                          market.zone_status === 'ACTIVE' ||
                          Boolean(market.markedZone && market.markedZone.status !== 'INVALIDATED' && market.markedZone.status !== 'EXPIRED');

    const hasSupplyDemand = (Array.isArray(market.supportZones) && market.supportZones.length > 0) ||
                            (Array.isArray(market.resistanceZones) && market.resistanceZones.length > 0);

    let scoreOutOf10 = 0;
    let matched = false;
    let reason = "";

    if (isFlatMatched || (hasBullishOb || hasBearishOb) || hasActiveZone || hasSupplyDemand) {
      scoreOutOf10 = 10;
      matched = true;
      reason = "Price is aligned with an unmitigated institutional Order Block / Supply-Demand zone (10/10).";
    } else {
      scoreOutOf10 = 0;
      matched = false;
      reason = "No active unmitigated Order Block or Supply-Demand zone found in immediate price structure (0/10).";
    }

    return {
      matched,
      score: scoreOutOf10 / 10,
      scoreOutOf10,
      reason
    };
  }
}
