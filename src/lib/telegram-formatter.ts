export function formatPrice(price: number | string | null | undefined, pair: string): string {
  if (price === null || price === undefined || price === '') return "N/A";
  const num = typeof price === "number" ? price : parseFloat(String(price));
  if (isNaN(num)) return "N/A";

  const cleanPair = (pair || "").toUpperCase().replace('/', '');
  const isIndexOrCrypto = (
    cleanPair.includes("BTC") ||
    cleanPair.includes("ETH") ||
    cleanPair.includes("NAS") ||
    cleanPair.includes("US100") ||
    cleanPair.includes("US500") ||
    cleanPair.includes("US30") ||
    cleanPair.includes("SPX") ||
    cleanPair.includes("GOLD") ||
    cleanPair.includes("XAU") ||
    cleanPair.includes("INDEX")
  );

  const decimals = isIndexOrCrypto ? 2 : (cleanPair.includes("JPY") ? 3 : 5);

  return num.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

export function formatRiskReward(rr: number | string | null | undefined): string {
  if (rr === null || rr === undefined || rr === '') return "R:R = N/A";
  const num = typeof rr === "number" ? rr : parseFloat(String(rr));
  if (isNaN(num) || num <= 0) return "R:R = N/A";

  if (Math.abs(num - Math.round(num)) < 0.05) {
    return `R:R = 1:${Math.round(num)}`;
  }

  const formatted = num.toFixed(2).replace(/\.?0+$/, '');
  return `R:R = 1:${formatted}`;
}

export function formatDisplayPair(pair: string): string {
  if (!pair) return "";
  if (pair.includes('/')) return pair.toUpperCase();
  const upper = pair.toUpperCase().trim();
  if (upper.length === 6) {
    return `${upper.slice(0, 3)}/${upper.slice(3)}`;
  }
  return upper;
}

export function formatTimeframe(tf: string): string {
  if (!tf) return "H1";
  const upper = tf.toUpperCase().trim();
  if (upper === '1M' || upper === 'M1' || upper === '1') return 'M1';
  if (upper === '5M' || upper === 'M5' || upper === '5') return 'M5';
  if (upper === '15M' || upper === 'M15' || upper === '15') return 'M15';
  if (upper === '30M' || upper === 'M30' || upper === '30') return 'M30';
  if (upper === '1H' || upper === 'H1' || upper === '60') return 'H1';
  if (upper === '4H' || upper === 'H4' || upper === '240') return 'H4';
  if (upper === '1D' || upper === 'D1' || upper === 'D') return 'D1';
  return upper;
}

export function formatUtcTimestamp(date = new Date()): string {
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dd = String(date.getUTCDate()).padStart(2, '0');
  const mmm = months[date.getUTCMonth()];
  const yyyy = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, '0');
  const min = String(date.getUTCMinutes()).padStart(2, '0');
  return `${dd} ${mmm} ${yyyy} ${hh}:${min} UTC`;
}

export interface SignalTelegramPayload {
  pair: string;
  timeframe: string;
  direction: string;
  strategySummary?: string;
  entryPrice: number | string | null;
  stopLoss: number | string | null;
  takeProfit: number | string | null;
  riskRewardRatio: number | string | null;
  confidenceScore: number;
  aiReasoning: string | string[];
}

export function buildTelegramAlertMessage(signal: SignalTelegramPayload): string {
  const pairStr = formatDisplayPair(signal.pair);
  const tfStr = formatTimeframe(signal.timeframe);
  const isBuy = signal.direction.toUpperCase() === 'BUY';
  const dirStr = isBuy ? '🟢 BUY' : '🔴 SELL';
  const stratSummary = (signal.strategySummary && signal.strategySummary.trim())
    ? signal.strategySummary.trim()
    : 'Custom Strategy';
  const entryStr = formatPrice(signal.entryPrice, signal.pair);
  const slStr = formatPrice(signal.stopLoss, signal.pair);
  const tpStr = formatPrice(signal.takeProfit, signal.pair);
  const rrStr = formatRiskReward(signal.riskRewardRatio);
  const confStr = `${Math.round(signal.confidenceScore)}%`;

  let reasons: string[] = [];
  if (Array.isArray(signal.aiReasoning)) {
    reasons = signal.aiReasoning;
  } else if (typeof signal.aiReasoning === 'string') {
    reasons = signal.aiReasoning.split(/\||\n/).map(s => s.trim()).filter(Boolean);
  }

  if (reasons.length === 0) {
    reasons = [
      isBuy ? "Bullish trend confirmed." : "Bearish trend confirmed.",
      isBuy ? "Price rejected support level." : "Price rejected resistance level.",
      "Strategy conditions satisfied."
    ];
  }

  const bulletReasons = reasons
    .map(r => r.startsWith('•') ? r : `• ${r}`)
    .join('\n');

  const timeStr = formatUtcTimestamp();

  return (
    `🚨 Autonomous AI Trading Alert 🚨\n\n` +
    `Pair: ${pairStr} (${tfStr})\n\n` +
    `Direction: ${dirStr}\n\n` +
    `Strategy: ${stratSummary}\n\n` +
    `Entry Price: ${entryStr}\n\n` +
    `Stop Loss: ${slStr}\n\n` +
    `Take Profit: ${tpStr}\n\n` +
    `Risk/Reward: ${rrStr}\n\n` +
    `Confidence: ${confStr}\n\n` +
    `AI Reasoning:\n` +
    `${bulletReasons}\n\n` +
    `Time:\n` +
    `${timeStr}`
  );
}
