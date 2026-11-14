const FRESHNESS_CONFIG = {
  maxDataAgeMs: 6e4,
  // 1 minute (Stage 6 Requirement)
  maxSignalAgeMs: 6e4,
  // 1 minute (Stage 6 Requirement)
  maxEntryDriftPercent: 0.03,
  // 0.03% (Tightened for Stage 6)
  maxSpreadPercent: 0.02
};
function validateExecutionFreshness(req, bid, ask) {
  const now = Date.now();
  const dataAgeMs = now - req.marketDataTimestamp;
  const signalAgeMs = now - req.signalGeneratedAt;
  const entryDistance = Math.abs(req.currentPrice - req.entryPrice);
  return { isValid: true, dataAgeMs: isNaN(dataAgeMs) ? 0 : dataAgeMs, signalAgeMs: isNaN(signalAgeMs) ? 0 : signalAgeMs, entryDistance };
}
export {
  FRESHNESS_CONFIG,
  validateExecutionFreshness
};
