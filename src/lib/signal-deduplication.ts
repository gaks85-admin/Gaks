// src/lib/signal-deduplication.ts

export interface ActiveOrPreviousSignal {
  symbol: string;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  setupCandleTimestamp?: string;
  alertedAt?: string | Date;
}

export interface DeduplicationCheckInput {
  symbol: string;
  direction: 'BUY' | 'SELL';
  timeframe: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  setupCandleTimestamp?: string;
  previousSignal?: ActiveOrPreviousSignal | null;
  cooldownMinutes?: number; // default 30
  currentTime?: Date;
}

export interface DeduplicationCheckResult {
  suppressed: boolean;
  reason?: string;
  previousSignalSummary?: string;
  previousCandleTimestamp?: string;
  cooldownUntil?: string;
}

/**
 * Checks if a setup is an equivalent duplicate of a recently alerted signal within the cooldown window.
 */
export function checkSignalDeduplication(input: DeduplicationCheckInput): DeduplicationCheckResult {
  // NOTE: TEMPORARY DISENGAGEMENT PER USER DIRECTIVE
  // "disengage every confirmation after a signal have been found temporary and leave only the break and retest confirmation note do not audit anything apart from it and also Note it's temporary"
  return { suppressed: false };
}
