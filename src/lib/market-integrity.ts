export interface MarketCandle {
  timestamp: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
}

export interface MarketDataIntegrityResult {
  valid: boolean;
  status: 'VALID' | 'INVALID_FUTURE_CANDLE' | 'INVALID_CHRONOLOGY' | 'INVALID_DUPLICATE' | 'INSUFFICIENT_DATA';
  reason: string;
  lastClosedCandleUtc?: string;
  currentUtc?: string;
}

export function normalizeCandleTimestamp(symbol: string, rawTimestamp: string | number): { timestampMs: number; normalizedIso: string } {
  const now = new Date();
  const serverUtc = now.toISOString();
  if (!rawTimestamp) {
    return { timestampMs: NaN, normalizedIso: '' };
  }

  let rawStr = String(rawTimestamp).trim();
  let providerTimezone = 'UTC (via &timezone=UTC)';
  let isSydneyTime = rawStr.includes('Australia/Sydney') || rawStr.includes('Sydney');
  if (isSydneyTime) {
    providerTimezone = 'Australia/Sydney (AEST/AEDT)';
    rawStr = rawStr.replace('Australia/Sydney', '').replace('Sydney', '').trim();
  }

  let formatted = rawStr;
  if (formatted.includes(' ') && !formatted.includes('T')) {
    formatted = formatted.replace(' ', 'T');
  }
  if (!formatted.endsWith('Z') && !formatted.includes('+') && !formatted.includes('-')) {
    formatted += 'Z';
  }

  let dateObj = new Date(formatted);
  let timestampMs = dateObj.getTime();

  if (isSydneyTime && !isNaN(timestampMs)) {
    // Australia/Sydney AEST is UTC+10 (August). Subtract 10 hours to normalize to UTC.
    const sydneyOffsetHours = 10;
    timestampMs -= sydneyOffsetHours * 3600 * 1000;
    dateObj = new Date(timestampMs);
  }

  const normalizedIso = isNaN(timestampMs) ? '' : dateObj.toISOString();
  const deltaMs = isNaN(timestampMs) ? 0 : timestampMs - now.getTime();
  const status = isNaN(timestampMs) ? 'INVALID' : 'NORMALIZED';

  console.log(`[Market Data Timestamp Normalization]
Symbol: ${symbol}
Provider Timezone: ${providerTimezone}
Raw Timestamp: ${rawTimestamp}
Normalized UTC: ${normalizedIso}
Server UTC: ${serverUtc}
Timestamp Delta: ${deltaMs} ms
Status: ${status}`);

  return { timestampMs, normalizedIso };
}

export function parseUtcTimestamp(ts: string | number, symbol: string = 'GENERIC'): number {
  return normalizeCandleTimestamp(symbol, ts).timestampMs;
}

export function validateMarketDataIntegrity(
  symbol: string,
  candleData: MarketCandle[]
): MarketDataIntegrityResult {
  const now = new Date();
  const currentUtc = now.toISOString();

  if (!candleData || candleData.length < 2) {
    const res: MarketDataIntegrityResult = {
      valid: false,
      status: 'INSUFFICIENT_DATA',
      reason: 'Fewer than 2 market candles available.',
      currentUtc
    };
    console.log(`[Market Data Integrity]
Symbol: ${symbol}
Current UTC: ${currentUtc}
Last Closed Candle UTC: N/A
Status: INSUFFICIENT_DATA
Action: NO_TRADE
Reason: ${res.reason}`.trim());
    return res;
  }

  // 1. Validate chronology and duplicates
  for (let i = 0; i < candleData.length; i++) {
    const currentMs = parseUtcTimestamp(candleData[i].timestamp, symbol);
    if (isNaN(currentMs)) {
      const res: MarketDataIntegrityResult = {
        valid: false,
        status: 'INVALID_CHRONOLOGY',
        reason: `Unparseable timestamp: ${candleData[i].timestamp}`,
        currentUtc
      };
      console.log(`[Market Data Integrity]
Symbol: ${symbol}
Current UTC: ${currentUtc}
Last Closed Candle UTC: N/A
Status: INVALID_CHRONOLOGY
Action: NO_TRADE
Reason: ${res.reason}`.trim());
      return res;
    }

    if (i > 0) {
      const prevMs = parseUtcTimestamp(candleData[i - 1].timestamp, symbol);
      if (currentMs === prevMs) {
        const res: MarketDataIntegrityResult = {
          valid: false,
          status: 'INVALID_DUPLICATE',
          reason: `Duplicate candle timestamp detected: ${candleData[i].timestamp}`,
          currentUtc
        };
        console.log(`[Market Data Integrity]
Symbol: ${symbol}
Current UTC: ${currentUtc}
Last Closed Candle UTC: ${candleData[i - 1].timestamp}
Status: INVALID_DUPLICATE
Action: NO_TRADE
Reason: ${res.reason}`.trim());
        return res;
      }
      if (currentMs < prevMs) {
        const res: MarketDataIntegrityResult = {
          valid: false,
          status: 'INVALID_CHRONOLOGY',
          reason: `Out-of-order candle timestamp: ${candleData[i - 1].timestamp} followed by ${candleData[i].timestamp}`,
          currentUtc
        };
        console.log(`[Market Data Integrity]
Symbol: ${symbol}
Current UTC: ${currentUtc}
Last Closed Candle UTC: ${candleData[i - 1].timestamp}
Status: INVALID_CHRONOLOGY
Action: NO_TRADE
Reason: ${res.reason}`.trim());
        return res;
      }
    }
  }

  // 2. Identify last closed candle (second to last candle in array if latest is open candle)
  const lastClosedCandle = candleData[candleData.length - 2];
  const lastClosedMs = parseUtcTimestamp(lastClosedCandle.timestamp, symbol);
  const lastClosedUtc = new Date(lastClosedMs).toISOString();

  const latestCandle = candleData[candleData.length - 1];
  const latestCandleMs = parseUtcTimestamp(latestCandle.timestamp, symbol);
  const nowMs = now.getTime();

  // Strict check: if any candle timestamp (last closed or latest) > currentTimeUTC
  if (latestCandleMs > nowMs || lastClosedMs > nowMs) {
    const res: MarketDataIntegrityResult = {
      valid: false,
      status: 'INVALID_FUTURE_CANDLE',
      reason: 'Candle timestamp is later than current server time.',
      lastClosedCandleUtc: lastClosedUtc,
      currentUtc
    };
    console.log(`[Market Data Integrity]
Symbol: ${symbol}
Current UTC: ${currentUtc}
Last Closed Candle UTC: ${lastClosedUtc}
Status: INVALID_FUTURE_CANDLE
Action: NO_TRADE
Reason: ${res.reason}`.trim());
    return res;
  }

  const res: MarketDataIntegrityResult = {
    valid: true,
    status: 'VALID',
    reason: 'Candle data timestamps are valid and chronological.',
    lastClosedCandleUtc: lastClosedUtc,
    currentUtc
  };
  console.log(`[Market Data Integrity]
Symbol: ${symbol}
Current UTC: ${currentUtc}
Last Closed Candle UTC: ${lastClosedUtc}
Status: VALID
Action: PROCEED
Reason: ${res.reason}`.trim());
  return res;
}
