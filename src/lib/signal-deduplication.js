function checkSignalDeduplication(input) {
  const { symbol, direction, timeframe, entryPrice, previousSignal, cooldownMinutes = 30, currentTime = /* @__PURE__ */ new Date() } = input;
  if (!previousSignal) {
    return { suppressed: false, isDuplicate: false };
  }
  if (previousSignal.symbol !== symbol) {
    return { suppressed: false, isDuplicate: false };
  }
  if (previousSignal.direction !== direction) {
    return { suppressed: false, isDuplicate: false };
  }
  const prevTime = previousSignal.alertedAt ? new Date(previousSignal.alertedAt).getTime() : input.previousSignal?.timestamp ? new Date(input.previousSignal.timestamp).getTime() : 0;
  const now = currentTime.getTime();
  const diffMinutes = (now - prevTime) / (60 * 1e3);
  if (diffMinutes < 0 || diffMinutes > cooldownMinutes) {
    return { suppressed: false, isDuplicate: false };
  }
  const prevEntry = previousSignal.entryPrice;
  const priceDiffPct = Math.abs(entryPrice - prevEntry) / (prevEntry || 1);
  if (priceDiffPct <= 5e-3) {
    const cooldownUntil = new Date(prevTime + cooldownMinutes * 6e4).toISOString();
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
export {
  checkSignalDeduplication
};
