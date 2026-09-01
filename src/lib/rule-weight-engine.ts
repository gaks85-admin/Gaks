export const RULE_WEIGHTS = {
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
  session: 10,
  timeframe: 8,
  volume_confirmation: 8,
  atr: 6,
  ema: 5,
  macd: 4,
  rsi: 4,
  risk_reward: 3
};

export type RuleWeightKey = keyof typeof RULE_WEIGHTS;

/**
 * Helper to get the weight of a rule, allowing fallback or override.
 */
export function getRuleWeight(ruleKey: string, customWeights?: Record<string, number>): number {
  const weights = customWeights || RULE_WEIGHTS;
  return (weights as any)[ruleKey] ?? 0;
}
