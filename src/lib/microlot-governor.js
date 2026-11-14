const DEFAULT_MICROLOT_LIMITS = {
  maxRiskPerTrade: 50,
  // $50 max risk
  maxDailyLoss: 200,
  // $200 max daily loss
  maxOpenPositions: 3,
  // 3 max open positions
  maxTradesPerDay: 5,
  // 5 max trades per day
  allowedSymbols: ["EURUSD", "GBPUSD", "USDJPY", "AUDUSD"]
};
class SupervisedMicrolotGovernor {
  constructor(broker, limits = DEFAULT_MICROLOT_LIMITS) {
    this.broker = broker;
    this.limits = limits;
  }
  broker;
  limits;
  async validateExecution(symbol, riskAmount) {
    const cleanSym = (symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!this.limits.allowedSymbols.includes("*") && !this.limits.allowedSymbols.includes(symbol) && !this.limits.allowedSymbols.includes(cleanSym)) {
      return { accepted: false, reason: `Symbol ${symbol} not in allowed microlot list.` };
    }
    if (riskAmount > this.limits.maxRiskPerTrade) {
      return { accepted: false, reason: `Risk $${riskAmount} exceeds microlot limit of $${this.limits.maxRiskPerTrade}.` };
    }
    const openPositions = await this.broker.getOpenPositions();
    if (openPositions.length >= this.limits.maxOpenPositions) {
      return { accepted: false, reason: `Max open positions (${this.limits.maxOpenPositions}) reached.` };
    }
    const recentOrders = await this.broker.getRecentOrders(50);
    const today = (/* @__PURE__ */ new Date()).setHours(0, 0, 0, 0);
    const tradesToday = recentOrders.filter((o) => o.createdAt >= today && o.status === "FILLED").length;
    if (tradesToday >= this.limits.maxTradesPerDay) {
      return { accepted: false, reason: `Max daily trades (${this.limits.maxTradesPerDay}) reached.` };
    }
    return { accepted: true };
  }
}
export {
  DEFAULT_MICROLOT_LIMITS,
  SupervisedMicrolotGovernor
};
