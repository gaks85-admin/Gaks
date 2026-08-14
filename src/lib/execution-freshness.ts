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
  const entryDriftPercent = (entryDistance / req.entryPrice) * 100;

  if (dataAgeMs > FRESHNESS_CONFIG.maxDataAgeMs) {
    return { isValid: false, rejectionReason: 'STALE_MARKET_DATA', dataAgeMs, signalAgeMs, entryDistance };
  }

  if (signalAgeMs > FRESHNESS_CONFIG.maxSignalAgeMs) {
    return { isValid: false, rejectionReason: 'STALE_SIGNAL', dataAgeMs, signalAgeMs, entryDistance };
  }

  if (entryDriftPercent > FRESHNESS_CONFIG.maxEntryDriftPercent) {
    return { isValid: false, rejectionReason: 'ENTRY_PRICE_DRIFT', dataAgeMs, signalAgeMs, entryDistance };
  }

  if (bid !== undefined && ask !== undefined) {
    const spreadPercent = ((ask - bid) / req.currentPrice) * 100;
    if (spreadPercent > FRESHNESS_CONFIG.maxSpreadPercent) {
      return { isValid: false, rejectionReason: 'SPREAD_TOO_WIDE', dataAgeMs, signalAgeMs, entryDistance };
    }
  }

  // ENTRY_ALREADY_INVALID
  // Check if price already crossed SL or TP
  if (req.isBuy) {
    if (req.currentPrice <= req.stopLoss || req.currentPrice >= req.takeProfit) {
      return { isValid: false, rejectionReason: 'ENTRY_ALREADY_INVALID', dataAgeMs, signalAgeMs, entryDistance };
    }
  } else {
    if (req.currentPrice >= req.stopLoss || req.currentPrice <= req.takeProfit) {
      return { isValid: false, rejectionReason: 'ENTRY_ALREADY_INVALID', dataAgeMs, signalAgeMs, entryDistance };
    }
  }

  return { isValid: true, dataAgeMs, signalAgeMs, entryDistance };
}
