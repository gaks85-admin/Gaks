class OrderBlockEvaluator {
  evaluate(rules, market) {
    if (!rules.order_block && !rules.supply_demand && !rules.unmitigated_zone) {
      return { matched: false, score: 0, scoreOutOf10: 0, reason: "Order Block rule not active in strategy." };
    }
    const isFlatMatched = market.order_block === true || market.order_block?.matched === true || market.supply_demand === true || market.unmitigated_zone === true;
    const hasBullishOb = market.orderBlocks && Array.isArray(market.orderBlocks) && market.orderBlocks.some((b) => b.type === "BULLISH" || b.type === "BULLISH_ORDER_BLOCK");
    const hasBearishOb = market.orderBlocks && Array.isArray(market.orderBlocks) && market.orderBlocks.some((b) => b.type === "BEARISH" || b.type === "BEARISH_ORDER_BLOCK");
    const hasActiveZone = market.zone_status === "ZONE_TAPPED" || market.zone_status === "WAITING_FOR_TAP" || market.zone_status === "CONFIRMED" || market.zone_status === "ACTIVE" || Boolean(market.markedZone && market.markedZone.status !== "INVALIDATED" && market.markedZone.status !== "EXPIRED");
    const hasSupplyDemand = Array.isArray(market.supportZones) && market.supportZones.length > 0 || Array.isArray(market.resistanceZones) && market.resistanceZones.length > 0;
    const isTapped = market.zone_status === "ZONE_TAPPED" || market.zone_status === "CONFIRMED" || market.zone_tapped === true;
    const isWaiting = market.zone_status === "WAITING_FOR_TAP";
    let scoreOutOf10 = 0;
    let matched = false;
    let reason = "";
    if (isFlatMatched || (hasBullishOb || hasBearishOb) || isTapped || hasSupplyDemand) {
      scoreOutOf10 = 10;
      matched = true;
      reason = "Price is aligned with and/or has tapped an unmitigated institutional Order Block / Supply-Demand zone (10/10).";
    } else if (isWaiting) {
      scoreOutOf10 = 2;
      matched = false;
      reason = "Structural Order Block identified but price has not yet tapped the zone (2/10).";
    } else {
      scoreOutOf10 = 0;
      matched = false;
      reason = "No active unmitigated Order Block or Supply-Demand zone found in immediate price structure (0/10).";
    }
    let status = "NO_DISTINCT_ZONE_FOUND";
    if (isTapped) status = "ENTRY_CONDITION_MET";
    else if (isWaiting) status = "WAITING_FOR_TAP";
    else if (hasBullishOb || hasBearishOb || hasSupplyDemand) status = "ZONE_IDENTIFIED";
    return {
      matched,
      score: scoreOutOf10 / 10,
      scoreOutOf10,
      reason,
      status
    };
  }
}
export {
  OrderBlockEvaluator
};
