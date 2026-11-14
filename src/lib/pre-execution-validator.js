function validatePreExecution(params) {
  const p = params;
  const bypassed = p.temporaryBypassAllPostSignalConfirmations === true;
  if (!bypassed) {
    if (p.marketDataAvailable === false) {
      return { valid: false, status: "FINAL_EXECUTION_REJECTED", reason: "MARKET_DATA_UNAVAILABLE", rejectionReason: "MARKET_DATA_UNAVAILABLE" };
    }
    if (p.signalExpired === true) {
      return { valid: false, status: "FINAL_EXECUTION_REJECTED", reason: "SIGNAL_EXPIRED", rejectionReason: "SIGNAL_EXPIRED" };
    }
    if (p.brokerQuoteFreshnessPassed === false) {
      return { valid: false, status: "FINAL_EXECUTION_REJECTED", reason: "BROKER_QUOTE_STALE", rejectionReason: "BROKER_QUOTE_STALE" };
    }
    if (p.maxSpreadThreshold !== void 0 && p.brokerQuote?.spread > p.maxSpreadThreshold) {
      return { valid: false, status: "FINAL_EXECUTION_REJECTED", reason: "EXCESSIVE_SPREAD", rejectionReason: "EXCESSIVE_SPREAD" };
    }
    if (p.maxEntryDriftThreshold !== void 0 && p.currentPrice !== void 0 && p.intendedEntryPrice !== void 0 && p.intendedEntryPrice > 0) {
      const drift = Math.abs(p.currentPrice - p.intendedEntryPrice) / p.intendedEntryPrice;
      if (drift > p.maxEntryDriftThreshold) {
        return { valid: false, status: "FINAL_EXECUTION_REJECTED", reason: "EXCESSIVE_ENTRY_DRIFT", rejectionReason: "EXCESSIVE_ENTRY_DRIFT" };
      }
    }
    if (p.riskGovernorPassed === false) {
      return { valid: false, status: "FINAL_EXECUTION_REJECTED", reason: "RISK_GOVERNOR_REJECTED", rejectionReason: "RISK_GOVERNOR_REJECTED" };
    }
    if (p.userRiskLimitsPassed === false) {
      return { valid: false, status: "FINAL_EXECUTION_REJECTED", reason: "USER_RISK_LIMIT_EXCEEDED", rejectionReason: "USER_RISK_LIMIT_EXCEEDED" };
    }
    if (p.duplicateTradeProtectionPassed === false) {
      return { valid: false, status: "FINAL_EXECUTION_REJECTED", reason: "DUPLICATE_TRADE_DETECTED", rejectionReason: "DUPLICATE_TRADE_DETECTED" };
    }
  }
  if (p.newsGate && p.newsGate.tradeBlocked) {
    const r = p.newsGate.blockReason || "NEWS_HARD_PAUSE";
    return { valid: false, status: "FINAL_EXECUTION_REJECTED", reason: r, rejectionReason: r };
  }
  if (p.symbol !== void 0 && String(p.symbol).trim() === "") {
    return { valid: false, status: "FINAL_EXECUTION_REJECTED", reason: "Invalid trading symbol", rejectionReason: "Invalid trading symbol" };
  }
  const effectiveLot = p.lotSize ?? p.positionSizing;
  if (effectiveLot !== void 0 && effectiveLot <= 0) {
    return { valid: false, status: "FINAL_EXECUTION_REJECTED", reason: "Invalid lot size: must be > 0", rejectionReason: "Invalid lot size: must be > 0" };
  }
  const effectiveSl = p.stopLoss ?? p.sl;
  if (p.entryPrice !== void 0 && p.entryPrice <= 0 || effectiveSl !== void 0 && effectiveSl <= 0) {
    return { valid: false, status: "FINAL_EXECUTION_REJECTED", reason: "Invalid entry or stop loss price", rejectionReason: "Invalid entry or stop loss price" };
  }
  return { valid: true, status: "FINAL_EXECUTION_AUTHORIZED" };
}
const revalidatePreExecution = validatePreExecution;
export {
  revalidatePreExecution,
  validatePreExecution
};
