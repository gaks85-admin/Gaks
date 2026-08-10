export function formatPrice(price: number | string | null | undefined, pair: string): string {
  if (price === null || price === undefined || price === '') return "N/A";
  if (typeof price === 'string' && price.trim() === 'OPEN') return 'OPEN';
  const num = typeof price === "number" ? price : parseFloat(String(price));
  if (isNaN(num)) return String(price);

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

  if (isIndexOrCrypto && Number.isInteger(num)) {
    return num.toString();
  }

  const str = num.toFixed(decimals);
  if (!isIndexOrCrypto && decimals === 5) {
    return str.replace(/0$/, '');
  }
  return str;
}

export function formatRiskReward(rr: number | string | null | undefined): string {
  if (rr === null || rr === undefined || rr === '') return "R:R — N/A";
  if (typeof rr === 'string') {
    const trimmed = rr.trim();
    if (trimmed.startsWith('1:')) {
      return `R:R — ${trimmed}`;
    }
  }
  const num = typeof rr === "number" ? rr : parseFloat(String(rr).replace('1:', ''));
  if (isNaN(num) || num <= 0) return "R:R — N/A";

  if (Math.abs(num - Math.round(num)) < 0.05) {
    return `R:R — 1:${Math.round(num)}`;
  }

  const formatted = num.toFixed(2).replace(/\.?0+$/, '');
  return `R:R — 1:${formatted}`;
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
  entryZone?: { min: number | string; max: number | string } | string | null;
  entryMin?: number | string | null;
  entryMax?: number | string | null;
  stopLoss: number | string | null;
  takeProfit: number | string | null;
  takeProfits?: (number | string | null)[];
  tp1?: number | string | null;
  tp2?: number | string | null;
  tp3?: number | string | null;
  riskRewardRatio: number | string | null;
  confidenceScore: number;
  aiReasoning: string | string[];
  lotSize?: number | string | null;
  riskAmount?: number | string | null;
  expectedLoss?: number | string | null;
  lotType?: string;
}

export function buildTelegramAlertMessage(signal: SignalTelegramPayload): string {
  const cleanPair = (signal.pair || "").toUpperCase().replace('/', '').trim();
  const isBuy = signal.direction.toUpperCase() === 'BUY';
  const headerIcon = isBuy ? '🟢' : '🔴';
  const headerDir = isBuy ? 'BUY' : 'SELL';

  // 1. ENTRY section
  let entryLine = '';
  if (signal.entryMin !== undefined && signal.entryMin !== null && signal.entryMax !== undefined && signal.entryMax !== null) {
    entryLine = `ENTRY ZONE — ${formatPrice(signal.entryMin, signal.pair)}–${formatPrice(signal.entryMax, signal.pair)}`;
  } else if (signal.entryZone && typeof signal.entryZone === 'object' && signal.entryZone.min !== undefined && signal.entryZone.max !== undefined) {
    entryLine = `ENTRY ZONE — ${formatPrice(signal.entryZone.min, signal.pair)}–${formatPrice(signal.entryZone.max, signal.pair)}`;
  } else if (typeof signal.entryZone === 'string' && signal.entryZone.trim().length > 0) {
    entryLine = `ENTRY ZONE — ${signal.entryZone.trim()}`;
  } else {
    entryLine = `ENTRY — ${formatPrice(signal.entryPrice, signal.pair)}`;
  }

  // 2. TP section
  const tpLines: string[] = [];
  if (Array.isArray(signal.takeProfits) && signal.takeProfits.length > 0) {
    signal.takeProfits.forEach((tp, idx) => {
      const tpNum = idx + 1;
      if (tp === 'OPEN' || tp === null) {
        tpLines.push(`TP${tpNum} — OPEN`);
      } else {
        tpLines.push(`TP${tpNum} — ${formatPrice(tp, signal.pair)}`);
      }
    });
  } else if (signal.tp1 !== undefined || signal.tp2 !== undefined || signal.tp3 !== undefined) {
    if (signal.tp1 !== undefined && signal.tp1 !== null) tpLines.push(`TP1 — ${formatPrice(signal.tp1, signal.pair)}`);
    if (signal.tp2 !== undefined && signal.tp2 !== null) tpLines.push(`TP2 — ${formatPrice(signal.tp2, signal.pair)}`);
    if (signal.tp3 !== undefined && signal.tp3 !== null) {
      tpLines.push(`TP3 — ${signal.tp3 === 'OPEN' ? 'OPEN' : formatPrice(signal.tp3, signal.pair)}`);
    }
  } else {
    tpLines.push(`TP1 — ${formatPrice(signal.takeProfit, signal.pair)}`);
  }

  // 3. SL section
  const slLine = `SL — ${formatPrice(signal.stopLoss, signal.pair)}`;

  // 4. RISK section
  const riskVal = (signal.expectedLoss !== undefined && signal.expectedLoss !== null && Number(signal.expectedLoss) > 0)
    ? Number(signal.expectedLoss)
    : Number(signal.riskAmount || 0);
  const riskStr = isNaN(riskVal) ? '$0.00' : `$${riskVal.toFixed(2)}`;

  const rrStr = formatRiskReward(signal.riskRewardRatio);

  let lotNum = (signal.lotSize !== undefined && signal.lotSize !== null) ? Number(signal.lotSize) : NaN;
  let posStr = 'N/A';
  if (!isNaN(lotNum) && lotNum > 0) {
    posStr = `${lotNum.toFixed(2)} lots`;
  } else if (signal.lotSize === 'NONE' || lotNum === 0) {
    posStr = 'NONE';
  } else if (signal.lotSize) {
    posStr = `${signal.lotSize} lots`;
  }

  const rawConf = signal.confidenceScore;
  let normalizedConf = 85;
  if (typeof rawConf === 'number' && !isNaN(rawConf)) {
    if (rawConf > 0 && rawConf <= 1.0) {
      normalizedConf = Math.round(rawConf * 100);
    } else {
      normalizedConf = Math.round(rawConf);
    }
  }

  // 5. WHY section
  let reasons: string[] = [];
  if (Array.isArray(signal.aiReasoning)) {
    reasons = signal.aiReasoning.map(r => String(r).trim()).filter(Boolean);
  } else if (typeof signal.aiReasoning === 'string') {
    reasons = signal.aiReasoning.split(/\||\n|;/).map(s => s.trim()).filter(Boolean);
  }

  reasons = reasons.filter(r =>
    !r.toLowerCase().includes('api_key') &&
    !r.toLowerCase().includes('telegram') &&
    !r.toLowerCase().includes('supabase') &&
    !r.startsWith('{')
  );

  if (reasons.length === 0) {
    reasons = [
      isBuy ? "Bullish structure confirmed" : "Bearish structure confirmed",
      isBuy ? "Break above key structural level" : "Rejection from key structural level",
      "Strategy conditions satisfied"
    ];
  }

  const bulletReasons = reasons
    .slice(0, 4)
    .map(r => r.startsWith('•') ? r : `• ${r}`)
    .join('\n');

  return (
    `${headerIcon} ${headerDir} ${cleanPair} NOW 🚨\n\n` +
    `${entryLine}\n\n` +
    `${tpLines.join('\n')}\n\n` +
    `${slLine}\n\n` +
    `━━━━━━━━━━━━\n\n` +
    `💰 RISK\n` +
    `Risk — ${riskStr}\n` +
    `${rrStr}\n` +
    `Position — ${posStr}\n` +
    `Confidence — ${normalizedConf}%\n\n` +
    `🧠 WHY\n` +
    `${bulletReasons}\n\n` +
    `⚡ Gaks AI`
  );
}
