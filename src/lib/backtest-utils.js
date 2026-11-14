function aggregateCandles(candles, timeframeMinutes) {
  if (timeframeMinutes <= 1) return candles;
  if (!candles || candles.length === 0) return [];
  const aggregated = [];
  let currentGroup = [];
  let currentGroupStartTime = null;
  for (const candle of candles) {
    const timestamp = new Date(candle.timestamp).getTime();
    const timeframeMs = timeframeMinutes * 60 * 1e3;
    const bucketStart = Math.floor(timestamp / timeframeMs) * timeframeMs;
    if (currentGroupStartTime === null) {
      currentGroupStartTime = bucketStart;
      currentGroup.push(candle);
    } else if (bucketStart === currentGroupStartTime) {
      currentGroup.push(candle);
    } else {
      aggregated.push(finalizeGroup(currentGroup, currentGroupStartTime));
      currentGroup = [candle];
      currentGroupStartTime = bucketStart;
    }
  }
  if (currentGroup.length > 0 && currentGroupStartTime !== null) {
    aggregated.push(finalizeGroup(currentGroup, currentGroupStartTime));
  }
  return aggregated;
}
function finalizeGroup(group, bucketStart) {
  const open = group[0].open;
  const close = group[group.length - 1].close;
  const high = Math.max(...group.map((c) => c.high));
  const low = Math.min(...group.map((c) => c.low));
  const volume = group.reduce((acc, c) => acc + (c.volume || 0), 0);
  return {
    timestamp: new Date(bucketStart).toISOString(),
    open,
    high,
    low,
    close,
    volume: volume || null
  };
}
export {
  aggregateCandles
};
