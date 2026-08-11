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
  const cooldownMinutes = input.cooldownMinutes ?? 30;
  const now = input.currentTime || new Date();
  const prev = input.previousSignal;

  if (!prev) {
    return { suppressed: false };
  }

  // 1. Check if symbol & direction match
  const symbolMatch = prev.symbol.replace(/[^A-Z0-9]/g, '').toUpperCase() === input.symbol.replace(/[^A-Z0-9]/g, '').toUpperCase();
  const directionMatch = prev.direction === input.direction;

  if (!symbolMatch || !directionMatch) {
    return { suppressed: false };
  }

  // 2. Check entry price proximity (e.g. within 0.1% = 0.001)
  const priceDiffRatio = Math.abs(input.entryPrice - prev.entryPrice) / (prev.entryPrice || 1);
  const entryMatches = priceDiffRatio <= 0.001 || (input.setupCandleTimestamp && input.setupCandleTimestamp === prev.setupCandleTimestamp);

  // 3. Check SL and TP proximity
  const slDiffRatio = Math.abs(input.stopLoss - prev.stopLoss) / (prev.stopLoss || 1);
  const tpDiffRatio = Math.abs(input.takeProfit - prev.takeProfit) / (prev.takeProfit || 1);
  const slTpMatches = slDiffRatio <= 0.002 && tpDiffRatio <= 0.002;

  // 4. Check cooldown timeframe
  let alertedTime = prev.alertedAt ? new Date(prev.alertedAt) : now;
  if (isNaN(alertedTime.getTime())) alertedTime = now;
  const elapsedMs = now.getTime() - alertedTime.getTime();
  const cooldownMs = cooldownMinutes * 60 * 1000;
  const isWithinCooldown = elapsedMs < cooldownMs;

  const isEquivalent = entryMatches && slTpMatches;

  if (isEquivalent && isWithinCooldown) {
    const cooldownUntilDate = new Date(alertedTime.getTime() + cooldownMs);
    const cooldownUntilStr = cooldownUntilDate.toISOString();
    const prevCandleStr = prev.setupCandleTimestamp || alertedTime.toISOString();
    const prevSummary = `${prev.direction} ${prev.symbol}`;

    console.log(`
[Signal Deduplication]
Status: SUPPRESSED
Reason: Equivalent setup already alerted
Previous Signal: ${prevSummary}
Previous Setup Candle: ${prevCandleStr}
Cooldown Until: ${cooldownUntilStr}
`.trim());

    return {
      suppressed: true,
      reason: 'Equivalent setup already alerted within cooldown window',
      previousSignalSummary: prevSummary,
      previousCandleTimestamp: prevCandleStr,
      cooldownUntil: cooldownUntilStr
    };
  }

  return { suppressed: false };
}
