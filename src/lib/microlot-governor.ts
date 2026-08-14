import { BrokerExecutionProvider } from './broker-execution-provider.js';

export interface MicrolotLimits {
  maxRiskPerTrade: number;
  maxDailyLoss: number;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  allowedSymbols: string[];
}

export const DEFAULT_MICROLOT_LIMITS: MicrolotLimits = {
  maxRiskPerTrade: 50, // $50 max risk
  maxDailyLoss: 200,   // $200 max daily loss
  maxOpenPositions: 3, // 3 max open positions
  maxTradesPerDay: 5,  // 5 max trades per day
  allowedSymbols: ['EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD']
};

export class SupervisedMicrolotGovernor {
  constructor(
    private broker: BrokerExecutionProvider,
    private limits: MicrolotLimits = DEFAULT_MICROLOT_LIMITS
  ) {}

  async validateExecution(symbol: string, riskAmount: number): Promise<{ accepted: boolean; reason?: string }> {
    // 1. Check Symbol
    if (!this.limits.allowedSymbols.includes(symbol)) {
      return { accepted: false, reason: `Symbol ${symbol} not in allowed microlot list.` };
    }

    // 2. Check Risk Per Trade
    if (riskAmount > this.limits.maxRiskPerTrade) {
      return { accepted: false, reason: `Risk $${riskAmount} exceeds microlot limit of $${this.limits.maxRiskPerTrade}.` };
    }

    // 3. Check Open Positions
    const openPositions = await this.broker.getOpenPositions();
    if (openPositions.length >= this.limits.maxOpenPositions) {
      return { accepted: false, reason: `Max open positions (${this.limits.maxOpenPositions}) reached.` };
    }

    // 4. Check Daily Trades (Simplified check using recent orders)
    const recentOrders = await this.broker.getRecentOrders(50);
    const today = new Date().setHours(0, 0, 0, 0);
    const tradesToday = recentOrders.filter(o => o.createdAt >= today && o.status === 'FILLED').length;
    
    if (tradesToday >= this.limits.maxTradesPerDay) {
      return { accepted: false, reason: `Max daily trades (${this.limits.maxTradesPerDay}) reached.` };
    }

    return { accepted: true };
  }
}
