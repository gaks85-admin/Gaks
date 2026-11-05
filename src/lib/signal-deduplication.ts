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

export function checkSignalDeduplication(input: DeduplicationCheckInput): DeduplicationCheckResult & { isDuplicate: boolean } {
  const { symbol, direction, timeframe, entryPrice, previousSignal, cooldownMinutes = 30, currentTime = new Date() } = input;

  if (!previousSignal) {
    return { suppressed: false, isDuplicate: false };
  }

  // Symbol check
  if (previousSignal.symbol !== symbol) {
    return { suppressed: false, isDuplicate: false };
  }

  // Direction check
  if (previousSignal.direction !== direction) {
    return { suppressed: false, isDuplicate: false };
  }

  // Cooldown time check
  const prevTime = previousSignal.alertedAt
    ? new Date(previousSignal.alertedAt).getTime()
    : (input as any).previousSignal?.timestamp
      ? new Date((input as any).previousSignal.timestamp).getTime()
      : 0;

  const now = currentTime.getTime();
  const diffMinutes = (now - prevTime) / (60 * 1000);

  if (diffMinutes < 0 || diffMinutes > cooldownMinutes) {
    return { suppressed: false, isDuplicate: false };
  }

  // Price proximity check: within 0.5% (approx 50 pips on forex, or within entry threshold)
  const prevEntry = previousSignal.entryPrice;
  const priceDiffPct = Math.abs(entryPrice - prevEntry) / (prevEntry || 1);

  if (priceDiffPct <= 0.005) {
    const cooldownUntil = new Date(prevTime + cooldownMinutes * 60000).toISOString();
    return {
      suppressed: true,
      isDuplicate: true,
      reason: `Equivalent ${direction} signal on ${symbol} already generated ${Math.round(diffMinutes)}m ago (within ${cooldownMinutes}m cooldown window)`,
      previousSignalSummary: `${previousSignal.direction} @ ${previousSignal.entryPrice}`,
      cooldownUntil
    };
  }

  return { suppressed: false, isDuplicate: false };
}
