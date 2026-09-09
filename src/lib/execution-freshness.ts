export interface FreshnessRequest {
  signalGeneratedAt: number;
  marketDataTimestamp: number;
  currentPrice: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  instrument: string;
  timeframe: string;
  isBuy: boolean;
  bypassFreshnessCheck?: boolean;
}

export interface FreshnessResult {
  isValid: boolean;
  rejectionReason?: 'STALE_MARKET_DATA' | 'STALE_SIGNAL' | 'ENTRY_PRICE_DRIFT' | 'SPREAD_TOO_WIDE' | 'ENTRY_ALREADY_INVALID';
  dataAgeMs: number;
  signalAgeMs: number;
  entryDistance: number;
}

export const FRESHNESS_CONFIG = {
  maxDataAgeMs: 60000, // 1 minute (Stage 6 Requirement)
  maxSignalAgeMs: 60000, // 1 minute (Stage 6 Requirement)
  maxEntryDriftPercent: 0.03, // 0.03% (Tightened for Stage 6)
  maxSpreadPercent: 0.02,
};

export function validateExecutionFreshness(req: FreshnessRequest, bid?: number, ask?: number): FreshnessResult {
  const now = Date.now();
  const dataAgeMs = now - req.marketDataTimestamp;
  const signalAgeMs = now - req.signalGeneratedAt;
  
  const entryDistance = Math.abs(req.currentPrice - req.entryPrice);

  // NOTE: TEMPORARY DISENGAGEMENT PER USER DIRECTIVE
  // "disengage every confirmation after a signal have been found temporary and leave only the break and retest confirmation note do not audit anything apart from it and also Note it's temporary"
  // Suppressing STALE_MARKET_DATA and all post-signal freshness checks.
  return { isValid: true, dataAgeMs: isNaN(dataAgeMs) ? 0 : dataAgeMs, signalAgeMs: isNaN(signalAgeMs) ? 0 : signalAgeMs, entryDistance };
}
