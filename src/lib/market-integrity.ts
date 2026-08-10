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

export function parseUtcTimestamp(ts: string | number): number {
  if (!ts) return NaN;
  if (typeof ts === 'number') return ts;
  
  let formatted = ts.trim();
  if (formatted.includes(' ') && !formatted.includes('T')) {
    formatted = formatted.replace(' ', 'T');
  }
  if (!formatted.endsWith('Z') && !formatted.includes('+') && !formatted.includes('-')) {
    formatted += 'Z';
  }
  return new Date(formatted).getTime();
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
    const currentMs = parseUtcTimestamp(candleData[i].timestamp);
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
      const prevMs = parseUtcTimestamp(candleData[i - 1].timestamp);
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
  const lastClosedMs = parseUtcTimestamp(lastClosedCandle.timestamp);
  const lastClosedUtc = new Date(lastClosedMs).toISOString();
  const nowMs = now.getTime();

  // Strict check: if lastClosedCandleTimestamp > currentTimeUTC
  if (lastClosedMs > nowMs) {
    const res: MarketDataIntegrityResult = {
      valid: false,
      status: 'INVALID_FUTURE_CANDLE',
      reason: 'Last closed candle timestamp is later than current server time.',
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
