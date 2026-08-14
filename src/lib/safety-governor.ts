
import { BrokerAccount } from './broker-types.js';

export interface SafetyHalt {
  isHalted: boolean;
  reason?: string;
  haltedAt?: number;
  type: 'GLOBAL_KILL_SWITCH' | 'DAILY_LOSS_LIMIT' | 'MAX_CONSECUTIVE_LOSSES' | 'BROKER_ERROR_LIMIT' | 'RECONCILIATION_CRITICAL';
}

export interface TradingLimits {
  maxDailyLossPercentage: number;
  maxConsecutiveLosses: number;
  maxOpenPositions: number;
  maxDailyExecutions: number;
  maxSpreadPips: number;
  maxSlippagePips: number;
}

export class SafetyGovernor {
  private halt: SafetyHalt | null = null;
  
  constructor(private limits: TradingLimits) {}

  async checkGlobalSafety(account: BrokerAccount, dailyPnL: number, consecutiveLosses: number): Promise<SafetyHalt> {
    // 1. Emergency Kill Switch
    if (process.env.GLOBAL_TRADING_ENABLED === 'false') {
      return { isHalted: true, reason: 'Emergency Kill Switch Active', type: 'GLOBAL_KILL_SWITCH', haltedAt: Date.now() };
    }

    // 2. Daily Loss Limit
    const dailyLossPercent = (dailyPnL / account.balance) * 100;
    if (dailyPnL < 0 && Math.abs(dailyLossPercent) >= this.limits.maxDailyLossPercentage) {
      return { isHalted: true, reason: `Daily loss limit exceeded: ${dailyLossPercent.toFixed(2)}%`, type: 'DAILY_LOSS_LIMIT', haltedAt: Date.now() };
    }

    // 3. Consecutive Losses
    if (consecutiveLosses >= this.limits.maxConsecutiveLosses) {
      return { isHalted: true, reason: `Max consecutive losses reached: ${consecutiveLosses}`, type: 'MAX_CONSECUTIVE_LOSSES', haltedAt: Date.now() };
    }

    return { isHalted: false, type: 'GLOBAL_KILL_SWITCH' }; // Default not halted
  }

  isHalted(): boolean {
    return this.halt?.isHalted || false;
  }

  getHaltReason(): string | undefined {
    return this.halt?.reason;
  }
}

export const defaultSafetyLimits: TradingLimits = {
  maxDailyLossPercentage: 3.0,
  maxConsecutiveLosses: 5,
  maxOpenPositions: 10,
  maxDailyExecutions: 20,
  maxSpreadPips: 5,
  maxSlippagePips: 10
};
