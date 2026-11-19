function detectConfirmationCandles(sortedCandles, atr) {
  const patterns = [];
  if (!sortedCandles || sortedCandles.length < 2) return patterns;
  const startIdx = Math.max(1, sortedCandles.length - 3);
  for (let i = startIdx; i < sortedCandles.length; i++) {
    const curr = sortedCandles[i];
    const prev = sortedCandles[i - 1];
    const range = Math.max(1e-6, curr.high - curr.low);
    const body = Math.abs(curr.close - curr.open);
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;
    const prevBody = Math.abs(prev.close - prev.open);
    if (curr.close > curr.open && prev.close < prev.open && curr.close >= prev.open && curr.open <= prev.close && body > prevBody * 1.05) {
      patterns.push({ pattern: "BULLISH_ENGULFING", candleIndex: i, direction: "BULLISH" });
    } else if (curr.close < curr.open && prev.close > prev.open && curr.close <= prev.open && curr.open >= prev.close && body > prevBody * 1.05) {
      patterns.push({ pattern: "BEARISH_ENGULFING", candleIndex: i, direction: "BEARISH" });
    }
    if (lowerWick >= body * 2 && lowerWick / range >= 0.5 && upperWick / range <= 0.2) {
      patterns.push({ pattern: "BULLISH_PIN_BAR", candleIndex: i, direction: "BULLISH" });
    } else if (upperWick >= body * 2 && upperWick / range >= 0.5 && lowerWick / range <= 0.2) {
      patterns.push({ pattern: "BEARISH_PIN_BAR", candleIndex: i, direction: "BEARISH" });
    }
    if (body / range >= 0.7 && (atr <= 0 || body >= atr * 0.6)) {
      patterns.push({
        pattern: curr.close > curr.open ? "BULLISH_MOMENTUM" : "BEARISH_MOMENTUM",
        candleIndex: i,
        direction: curr.close > curr.open ? "BULLISH" : "BEARISH"
      });
    }
  }
  return patterns;
}
const ConfirmationCandleModule = {
  id: "confirmation_candle",
  name: "Confirmation Candle",
  category: "PRICE_ACTION",
  aliases: ["confirmation_candle", "confirmation"],
  requiresSwings: false,
  requiresAtr: true,
  execute: (ctx) => {
    const patterns = detectConfirmationCandles(ctx.sortedCandles, ctx.atr);
    const latest = patterns[patterns.length - 1];
    const matched = patterns.length > 0;
    return {
      moduleId: "confirmation_candle",
      moduleName: "Confirmation Candle",
      category: "PRICE_ACTION",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10: matched ? 10 : 0,
      direction: latest ? latest.direction : "NEUTRAL",
      reason: latest ? `Confirmed candle pattern: ${latest.pattern} (${latest.direction}) at candle index ${latest.candleIndex}.` : "No bullish/bearish confirmation candle pattern (Engulfing, Pin Bar, Momentum) in recent bars.",
      evidence: patterns.map((p) => `${p.pattern} (${p.direction}) at bar ${p.candleIndex}`),
      metrics: {
        patternCount: patterns.length,
        latestPattern: latest?.pattern || "NONE"
      },
      structurePatch: {
        candlePatterns: patterns,
        confirmation_candle: matched
      }
    };
  }
};
export {
  ConfirmationCandleModule,
  detectConfirmationCandles
};
