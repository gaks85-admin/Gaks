export const DEFAULT_MICROLOT_LIMITS = {
    maxRiskPerTrade: 50,
    maxDailyLoss: 200,
    maxOpenPositions: 3,
    maxTradesPerDay: 5,
    allowedSymbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD']
};
export class SupervisedMicrolotGovernor {
    broker;
    limits;
    constructor(broker, limits = DEFAULT_MICROLOT_LIMITS) {
        this.broker = broker;
        this.limits = limits;
    }
    async validateExecution(symbol, riskAmount) {
        if (!this.limits.allowedSymbols.includes(symbol)) {
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
        const today = new Date().setHours(0, 0, 0, 0);
        const tradesToday = recentOrders.filter(o => o.createdAt >= today && o.status === 'FILLED').length;
        if (tradesToday >= this.limits.maxTradesPerDay) {
            return { accepted: false, reason: `Max daily trades (${this.limits.maxTradesPerDay}) reached.` };
        }
        return { accepted: true };
    }
}
