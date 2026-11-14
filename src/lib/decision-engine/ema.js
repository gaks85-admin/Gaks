class EmaEvaluator {
  evaluate(rules, market) {
    if (!rules.ema || !rules.ema.enabled) {
      return { matched: false, score: 0, reason: "EMA rule not active in strategy." };
    }
    const isFlatMatched = market.ema === true || market.ema_crossover === true;
    const isFlatFailed = market.ema === false || market.ema_crossover === false;
    const isTrendMatched = market.trend && market.trend !== "SIDEWAYS";
    let matched = false;
    if (isFlatFailed) {
      matched = false;
    } else {
      matched = isFlatMatched || isTrendMatched;
    }
    const periodsStr = rules.ema.periods ? rules.ema.periods.join("/") : "custom";
    return {
      matched,
      score: matched ? 1 : 0,
      reason: matched ? `EMA (${periodsStr}) condition/trend satisfied by current market trend (${market.trend || "Trending"}).` : `EMA (${periodsStr}) trend alignment or crossover not confirmed (Market is ${market.trend || "Sideways"}).`
    };
  }
}
export {
  EmaEvaluator
};
