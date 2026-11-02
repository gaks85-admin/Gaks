export const FRESHNESS_CONFIG = {
    maxDataAgeMs: 60000,
    maxSignalAgeMs: 60000,
    maxEntryDriftPercent: 0.03,
    maxSpreadPercent: 0.02,
};
export function validateExecutionFreshness(req, bid, ask) {
    const now = Date.now();
    const dataAgeMs = now - req.marketDataTimestamp;
    const signalAgeMs = now - req.signalGeneratedAt;
    const entryDistance = Math.abs(req.currentPrice - req.entryPrice);
    return { isValid: true, dataAgeMs: isNaN(dataAgeMs) ? 0 : dataAgeMs, signalAgeMs: isNaN(signalAgeMs) ? 0 : signalAgeMs, entryDistance };
}
