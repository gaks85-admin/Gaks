import { EconomicEventResult } from './economic-event-service.js';
import { FreshnessResult } from './execution-freshness.js';
import { BrokerQuote } from './broker-types.js';

export interface FinalExecutionState {
  marketDataAvailable: boolean;
  marketDataFreshness: FreshnessResult;
  currentPrice: number;
  spread: number;
  entryPrice: number;
  sl: number;
  tp: number;
  rr: number;
  riskGovernorPassed: boolean;
  newsGate: EconomicEventResult;
  positionSizing: number;
  userRiskLimitsPassed: boolean;
  duplicateTradeProtectionPassed: boolean;
  signalExpired: boolean;
  brokerQuote?: BrokerQuote;
  brokerQuoteFreshnessPassed?: boolean;
  maxSpreadThreshold?: number;
  maxEntryDriftThreshold?: number;
  intendedEntryPrice?: number;
}

export interface FinalDecision {
  status: 'FINAL_EXECUTION_AUTHORIZED' | 'FINAL_EXECUTION_REJECTED';
  rejectionReason?: string;
  revalidationDetails?: {
    actualSpread: number;
    actualDrift: number;
    actualPrice: number;
  };
}

export function revalidatePreExecution(state: FinalExecutionState): FinalDecision {
  if (!state.marketDataAvailable) return { status: 'FINAL_EXECUTION_REJECTED', rejectionReason: 'MARKET_DATA_UNAVAILABLE' };
  
  if (!state.marketDataFreshness.isValid) {
     return { status: 'FINAL_EXECUTION_REJECTED', rejectionReason: state.marketDataFreshness.rejectionReason };
  }

  if (state.signalExpired) return { status: 'FINAL_EXECUTION_REJECTED', rejectionReason: 'SIGNAL_EXPIRED' };
  
  if (!state.riskGovernorPassed) return { status: 'FINAL_EXECUTION_REJECTED', rejectionReason: 'RISK_GOVERNOR_REJECTION' };
  
  if (state.newsGate.tradeBlocked) return { status: 'FINAL_EXECUTION_REJECTED', rejectionReason: state.newsGate.blockReason || 'NEWS_HARD_PAUSE' };
  
  if (state.positionSizing <= 0) return { status: 'FINAL_EXECUTION_REJECTED', rejectionReason: 'INVALID_POSITION_SIZE' };
  
  if (!state.userRiskLimitsPassed) return { status: 'FINAL_EXECUTION_REJECTED', rejectionReason: 'USER_RISK_LIMITS_EXCEEDED' };
  
  if (!state.duplicateTradeProtectionPassed) return { status: 'FINAL_EXECUTION_REJECTED', rejectionReason: 'DUPLICATE_TRADE_PROTECTION' };

  if (state.rr < 0.5) return { status: 'FINAL_EXECUTION_REJECTED', rejectionReason: 'INVALID_RR' }; // Baseline safety

  // Broker Quote Validation (Stage 7 Requirement)
  if (!state.brokerQuote) {
    return { status: 'FINAL_EXECUTION_REJECTED', rejectionReason: 'BROKER_QUOTE_UNAVAILABLE' };
  }

  if (state.brokerQuoteFreshnessPassed === false) {
    return { status: 'FINAL_EXECUTION_REJECTED', rejectionReason: 'BROKER_QUOTE_STALE' };
  }

  const actualSpread = state.brokerQuote.spread;
  if (state.maxSpreadThreshold !== undefined && actualSpread > state.maxSpreadThreshold) {
    return { status: 'FINAL_EXECUTION_REJECTED', rejectionReason: 'EXCESSIVE_SPREAD' };
  }

  if (state.intendedEntryPrice !== undefined) {
    const actualPrice = state.currentPrice; // This should be the execution price (bid/ask)
    const drift = Math.abs(actualPrice - state.intendedEntryPrice) / state.intendedEntryPrice;
    if (state.maxEntryDriftThreshold !== undefined && drift > state.maxEntryDriftThreshold) {
      return { status: 'FINAL_EXECUTION_REJECTED', rejectionReason: 'EXCESSIVE_ENTRY_DRIFT' };
    }
  }

  return { status: 'FINAL_EXECUTION_AUTHORIZED' };
}
