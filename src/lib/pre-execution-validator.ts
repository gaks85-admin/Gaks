export interface PreExecutionValidationParams {
  symbol?: string;
  lotSize?: number;
  entryPrice?: number;
  stopLoss?: number;
  takeProfit?: number;
  marketDataAvailable?: boolean;
  marketDataFreshness?: any;
  currentPrice?: number;
  spread?: number;
  sl?: number;
  tp?: number;
  rr?: number;
  riskGovernorPassed?: boolean;
  newsGate?: any;
  positionSizing?: number;
  userRiskLimitsPassed?: boolean;
  duplicateTradeProtectionPassed?: boolean;
  signalExpired?: boolean;
  brokerQuote?: any;
  brokerQuoteFreshnessPassed?: boolean;
  maxSpreadThreshold?: number;
  maxEntryDriftThreshold?: number;
  intendedEntryPrice?: number;
}

export interface FinalExecutionState {
  status: 'PENDING' | 'REJECTED' | 'EXECUTED' | 'FAILED' | 'FINAL_EXECUTION_AUTHORIZED' | 'FINAL_EXECUTION_REJECTED';
  rejectionReason?: string;
  orderId?: string;
  timestamp?: string;
  marketDataAvailable?: boolean;
  marketDataFreshness?: any;
  currentPrice?: number;
  spread?: number;
  entryPrice?: number;
  sl?: number;
  tp?: number;
  rr?: number;
  riskGovernorPassed?: boolean;
  newsGate?: any;
  positionSizing?: number;
  userRiskLimitsPassed?: boolean;
  duplicateTradeProtectionPassed?: boolean;
  signalExpired?: boolean;
  intendedEntryPrice?: number;
  brokerQuote?: any;
  brokerQuoteFreshnessPassed?: boolean;
  maxSpreadThreshold?: number;
  maxEntryDriftThreshold?: number;
  symbol?: string;
  lotSize?: number;
  stopLoss?: number;
  takeProfit?: number;
}

export function validatePreExecution(params: PreExecutionValidationParams | FinalExecutionState): {
  valid: boolean;
  status: 'FINAL_EXECUTION_AUTHORIZED' | 'FINAL_EXECUTION_REJECTED' | 'PENDING' | 'REJECTED' | 'EXECUTED' | 'FAILED';
  reason?: string;
  rejectionReason?: string;
} {
  const p = params as any;
  if (p.brokerQuoteFreshnessPassed === false) {
    return { valid: false, status: 'FINAL_EXECUTION_REJECTED', reason: 'BROKER_QUOTE_STALE', rejectionReason: 'BROKER_QUOTE_STALE' };
  }
  if (p.maxSpreadThreshold !== undefined && p.brokerQuote?.spread > p.maxSpreadThreshold) {
    return { valid: false, status: 'FINAL_EXECUTION_REJECTED', reason: 'EXCESSIVE_SPREAD', rejectionReason: 'EXCESSIVE_SPREAD' };
  }
  if (p.maxEntryDriftThreshold !== undefined && p.currentPrice !== undefined && p.intendedEntryPrice !== undefined) {
    const drift = Math.abs(p.currentPrice - p.intendedEntryPrice) / p.intendedEntryPrice;
    if (drift > p.maxEntryDriftThreshold) {
      return { valid: false, status: 'FINAL_EXECUTION_REJECTED', reason: 'EXCESSIVE_ENTRY_DRIFT', rejectionReason: 'EXCESSIVE_ENTRY_DRIFT' };
    }
  }
  if (p.newsGate && p.newsGate.tradeBlocked) {
    const r = p.newsGate.blockReason || 'NEWS_HARD_PAUSE';
    return { valid: false, status: 'FINAL_EXECUTION_REJECTED', reason: r, rejectionReason: r };
  }
  if (p.symbol !== undefined && p.symbol.trim() === '') {
    return { valid: false, status: 'FINAL_EXECUTION_REJECTED', reason: 'Invalid trading symbol', rejectionReason: 'Invalid trading symbol' };
  }
  if (p.lotSize !== undefined && p.lotSize <= 0) {
    return { valid: false, status: 'FINAL_EXECUTION_REJECTED', reason: 'Invalid lot size: must be > 0', rejectionReason: 'Invalid lot size: must be > 0' };
  }
  if ((p.entryPrice !== undefined && p.entryPrice <= 0) || (p.stopLoss !== undefined && p.stopLoss <= 0)) {
    return { valid: false, status: 'FINAL_EXECUTION_REJECTED', reason: 'Invalid entry or stop loss price', rejectionReason: 'Invalid entry or stop loss price' };
  }
  return { valid: true, status: 'FINAL_EXECUTION_AUTHORIZED' };
}

export const revalidatePreExecution = validatePreExecution;

