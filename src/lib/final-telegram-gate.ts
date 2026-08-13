import { validateTradeGeometry } from './trade-geometry-validator.js';

export interface TelegramTradePayload {
  pair?: string;
  symbol?: string;
  direction: string;
  entryPrice: number;
  stopLoss: number;
  takeProfit: number;
  riskRewardRatio?: string | number;
  confidenceScore?: number;
  aiReasoning?: string | string[];
  lotSize?: number;
  riskAmount?: number;
  [key: string]: any;
}

export interface FinalTelegramGateResult {
  valid: boolean;
  reason: string;
  fingerprint: string;
  geometry: string;
  direction: string;
  riskDistance: number;
  rewardDistance: number;
  calculatedRr: number;
}

export function computeTradeFingerprint(payload: TelegramTradePayload): string {
  const dir = (payload.direction || '').toUpperCase().trim();
  const entry = Number(payload.entryPrice || 0);
  const sl = Number(payload.stopLoss || 0);
  const tp = Number(payload.takeProfit || 0);
  const lot = Number(payload.lotSize || 0);
  const rawStr = `${dir}|${entry.toFixed(5)}|${sl.toFixed(5)}|${tp.toFixed(5)}|${lot.toFixed(2)}`;
  
  // Simple deterministic hash / string representation
  let hash = 0;
  for (let i = 0; i < rawStr.length; i++) {
    const char = rawStr.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash |= 0;
  }
  return `FP_${Math.abs(hash).toString(16)}_${dir}_E${entry}_SL${sl}_TP${tp}`;
}

export function validateFinalTelegramTradePayload(payload: TelegramTradePayload): FinalTelegramGateResult {
  const symbol = payload.pair || payload.symbol || 'UNKNOWN';
  const dir = (payload.direction || '').toUpperCase().trim();
  const entry = Number(payload.entryPrice);
  const sl = Number(payload.stopLoss);
  const tp = Number(payload.takeProfit);
  
  let reasoningStr = '';
  if (Array.isArray(payload.aiReasoning)) {
    reasoningStr = payload.aiReasoning.join(' ');
  } else if (typeof payload.aiReasoning === 'string') {
    reasoningStr = payload.aiReasoning;
  }

  const fingerprint = computeTradeFingerprint(payload);

  console.log(`[TRADE OBJECT FINGERPRINT]
Direction: ${dir}
Entry: ${entry}
SL: ${sl}
TP: ${tp}
RR: ${payload.riskRewardRatio || 'N/A'}
Fingerprint: ${fingerprint}`);

  // Validate geometry using validateTradeGeometry without Math.abs for direction
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
  const reason = valid ? 'ACCEPTABLE_GEOMETRY' : geoResult.reason;

  console.log(`[FINAL TELEGRAM GATE]
Symbol: ${symbol}
Direction: ${dir}
Entry: ${entry}
SL: ${sl}
TP: ${tp}
Geometry: ${valid ? 'VALID' : 'INVALID'}
Reason: ${reason}
R:R: ${geoResult.calculatedRr}
Risk: ${geoResult.riskDistance.toFixed(5)}
Position: ${payload.lotSize !== undefined ? payload.lotSize : 'N/A'}
Quality: ${payload.confidenceScore !== undefined ? payload.confidenceScore + '%' : 'N/A'}
Gemini: ${payload.aiReasoning ? 'YES' : 'NO'}
Explanation: ${reasoningStr.substring(0, 60)}...
Validation: ${valid ? 'PASSED' : 'FAILED'}
Telegram: ${valid ? 'AUTHORIZED' : 'BLOCKED'}`);

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
