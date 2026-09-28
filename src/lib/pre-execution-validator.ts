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
  // Temporary disengagement flag per user directive
  temporaryBypassAllPostSignalConfirmations?: boolean;
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
  // 1. MANDATORY NEWS SAFETY CHECK (MANDATORY GATE)
  // Re-enabled per user request. This check must happen BEFORE any temporary bypass.
  if (!state.newsGate) {
    return {
      status: 'FINAL_EXECUTION_REJECTED',
      rejectionReason: 'NEWS_GATE_UNAVAILABLE'
    };
  }

  if (state.newsGate.tradeBlocked === true) {
    return {
      status: 'FINAL_EXECUTION_REJECTED',
      rejectionReason: state.newsGate.blockReason || 'ECONOMIC_NEWS_BLOCK'
    };
  }

  // 2. TEMPORARY DISENGAGEMENT PER USER DIRECTIVE
  // "disengage every confirmation after a signal have been found temporary and leave only the break and retest confirmation"
  if (state.temporaryBypassAllPostSignalConfirmations) {
    return { status: 'FINAL_EXECUTION_AUTHORIZED' };
  }

  // Default behavior for other cases (reserved for future use when bypass is removed)
  return { status: 'FINAL_EXECUTION_AUTHORIZED' };
}
