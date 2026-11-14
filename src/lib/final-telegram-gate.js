import { validateTradeGeometry } from "./trade-geometry-validator.js";
function computeTradeFingerprint(payload) {
  const dir = (payload.direction || "").toUpperCase().trim();
  const entry = Number.isFinite(Number(payload.entryPrice)) ? Number(payload.entryPrice) : 0;
  const sl = Number.isFinite(Number(payload.stopLoss)) ? Number(payload.stopLoss) : 0;
  const tp = Number.isFinite(Number(payload.takeProfit)) ? Number(payload.takeProfit) : 0;
  const lot = Number.isFinite(Number(payload.lotSize)) ? Number(payload.lotSize) : 0;
  const rawStr = `${dir}|${entry.toFixed(5)}|${sl.toFixed(5)}|${tp.toFixed(5)}|${lot.toFixed(2)}`;
  let hash = 0;
  for (let i = 0; i < rawStr.length; i++) {
    const char = rawStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `FP_${Math.abs(hash).toString(16)}_${dir}_E${entry}_SL${sl}_TP${tp}`;
}
function validateFinalTelegramTradePayload(payload) {
  const symbol = payload.pair || payload.symbol || "UNKNOWN";
  const dir = (payload.direction || "").toUpperCase().trim();
  const entry = Number(payload.entryPrice);
  const sl = Number(payload.stopLoss);
  const tp = Number(payload.takeProfit);
  let reasoningStr = "";
  if (Array.isArray(payload.aiReasoning)) {
    reasoningStr = payload.aiReasoning.join(" ");
  } else if (typeof payload.aiReasoning === "string") {
    reasoningStr = payload.aiReasoning;
  }
  const fingerprint = computeTradeFingerprint(payload);
  console.log(`[TRADE OBJECT FINGERPRINT]
Direction: ${dir}
Entry: ${entry}
SL: ${sl}
TP: ${tp}
RR: ${payload.riskRewardRatio || "N/A"}
Fingerprint: ${fingerprint}`);
  const geoResult = validateTradeGeometry({
    symbol,
    direction: dir,
    entryPrice: entry,
    stopLoss: sl,
    takeProfit: tp,
    explanation: reasoningStr
  });
  const valid = geoResult.valid;
  const geometry = geoResult.geometry;
  const reason = valid ? "ACCEPTABLE_GEOMETRY" : geoResult.reason;
  console.log(`[FINAL TELEGRAM GATE]
Symbol: ${symbol}
Direction: ${dir}
Entry: ${entry}
SL: ${sl}
TP: ${tp}
Geometry: ${valid ? "VALID" : "INVALID"}
Reason: ${reason}
R:R: ${geoResult.calculatedRr}
Risk: ${Number.isFinite(geoResult?.riskDistance) ? geoResult.riskDistance.toFixed(5) : "0.00000"}
Position: ${payload.lotSize !== void 0 ? payload.lotSize : "N/A"}
Quality: ${payload.confidenceScore !== void 0 ? payload.confidenceScore + "%" : "N/A"}
Gemini: ${payload.aiReasoning ? "YES" : "NO"}
Explanation: ${reasoningStr.substring(0, 60)}...
Validation: ${valid ? "PASSED" : "FAILED"}
Telegram: ${valid ? "AUTHORIZED" : "BLOCKED"}`);
  return {
    valid,
    reason,
    fingerprint,
    geometry,
    direction: dir,
    riskDistance: geoResult.riskDistance,
    rewardDistance: geoResult.rewardDistance,
    calculatedRr: geoResult.calculatedRr
  };
}
export {
  computeTradeFingerprint,
  validateFinalTelegramTradePayload
};
