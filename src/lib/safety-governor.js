class SafetyGovernor {
  constructor(limits) {
    this.limits = limits;
  }
  limits;
  halt = null;
  async checkGlobalSafety(account, dailyPnL, consecutiveLosses) {
    if (process.env.GLOBAL_TRADING_ENABLED === "false") {
      return { isHalted: true, reason: "Emergency Kill Switch Active", type: "GLOBAL_KILL_SWITCH", haltedAt: Date.now() };
    }
    const dailyLossPercent = dailyPnL / account.balance * 100;
    if (dailyPnL < 0 && Math.abs(dailyLossPercent) >= this.limits.maxDailyLossPercentage) {
      return { isHalted: true, reason: `Daily loss limit exceeded: ${dailyLossPercent.toFixed(2)}%`, type: "DAILY_LOSS_LIMIT", haltedAt: Date.now() };
    }
    if (consecutiveLosses >= this.limits.maxConsecutiveLosses) {
      return { isHalted: true, reason: `Max consecutive losses reached: ${consecutiveLosses}`, type: "MAX_CONSECUTIVE_LOSSES", haltedAt: Date.now() };
    }
    return { isHalted: false, type: "GLOBAL_KILL_SWITCH" };
  }
  isHalted() {
    return this.halt?.isHalted || false;
  }
  getHaltReason() {
    return this.halt?.reason;
  }
}
const defaultSafetyLimits = {
  maxDailyLossPercentage: 3,
  maxConsecutiveLosses: 5,
  maxOpenPositions: 10,
  maxDailyExecutions: 20,
  maxSpreadPips: 5,
  maxSlippagePips: 10
};
export {
  SafetyGovernor,
  defaultSafetyLimits
};
