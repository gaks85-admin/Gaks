export function normalizeCandleTimestamp(symbol, rawTimestamp) {
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
        const sydneyOffsetHours = 10;
        timestampMs -= sydneyOffsetHours * 3600 * 1000;
        dateObj = new Date(timestampMs);
    }
    const normalizedIso = isNaN(timestampMs) ? '' : dateObj.toISOString();
    if (isNaN(timestampMs)) {
        console.warn(`[MARKET DATA TIMESTAMP WARNING] Symbol: ${symbol} | Unparseable raw timestamp: ${rawTimestamp}`);
    }
    return { timestampMs, normalizedIso };
}
export function parseUtcTimestamp(ts, symbol = 'GENERIC') {
    return normalizeCandleTimestamp(symbol, ts).timestampMs;
}
export function validateMarketDataIntegrity(symbol, candleData) {
    const now = new Date();
    const currentUtc = now.toISOString();
    if (!candleData || candleData.length < 2) {
        const res = {
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
    for (let i = 0; i < candleData.length; i++) {
        const currentMs = parseUtcTimestamp(candleData[i].timestamp, symbol);
        if (isNaN(currentMs)) {
            const res = {
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
                const res = {
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
                const res = {
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
    const lastClosedCandle = candleData[candleData.length - 2];
    const lastClosedMs = parseUtcTimestamp(lastClosedCandle.timestamp, symbol);
    const lastClosedUtc = new Date(lastClosedMs).toISOString();
    const latestCandle = candleData[candleData.length - 1];
    const latestCandleMs = parseUtcTimestamp(latestCandle.timestamp, symbol);
    const nowMs = now.getTime();
    if (latestCandleMs > nowMs || lastClosedMs > nowMs) {
        const res = {
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
    const res = {
        valid: true,
        status: 'VALID',
        reason: 'Candle data timestamps are valid and chronological.',
        lastClosedCandleUtc: lastClosedUtc,
        currentUtc
    };
    console.log(`[MARKET DATA] ${symbol} | candles=${candleData.length} | latest=${lastClosedUtc} | normalized=true`);
    return res;
}
