const RULE_WEIGHTS = {
  trendline_breakout: 25,
  break_and_retest: 20,
  bos: 20,
  choch: 15,
  confirmation_candle: 15,
  liquidity_sweep: 15,
  fair_value_gap: 12,
  order_block: 20,
  supply_demand: 20,
  unmitigated_zone: 15,
  demand_zone: 20,
  supply_zone: 20,
  support: 10,
  resistance: 10,
  support_rejection: 10,
  resistance_rejection: 10,
  tap_and_rejection: 20,
  session: 10,
  timeframe: 8,
  volume_confirmation: 8,
  atr: 6,
  ema: 5,
  macd: 4,
  rsi: 4,
  risk_reward: 3
};
function getRuleWeight(ruleKey, customWeights) {
  const weights = customWeights || RULE_WEIGHTS;
  return weights[ruleKey] ?? 0;
}
export {
  RULE_WEIGHTS,
  getRuleWeight
};
