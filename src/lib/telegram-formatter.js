function formatPrice(price, pair) {
  if (price === null || price === void 0 || price === "") return "N/A";
  if (typeof price === "string" && price.trim() === "OPEN") return "OPEN";
  const num = typeof price === "number" ? price : parseFloat(String(price));
  if (isNaN(num)) return String(price);
  const cleanPair = (pair || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const isIndexOrMetalOrCrypto = cleanPair.includes("BTC") || cleanPair.includes("ETH") || cleanPair.includes("SOL") || cleanPair.includes("XRP") || cleanPair.includes("LTC") || cleanPair.includes("ADA") || cleanPair.includes("DOGE") || cleanPair.includes("BNB") || cleanPair.includes("AVAX") || cleanPair.includes("DOT") || cleanPair.includes("LINK") || cleanPair.includes("MATIC") || cleanPair.includes("UNI") || cleanPair.includes("TON") || cleanPair.includes("SUI") || cleanPair.endsWith("USDT") || cleanPair.endsWith("USDC") || cleanPair.endsWith("BUSD") || cleanPair.includes("NAS") || cleanPair.includes("NDX") || cleanPair.includes("US100") || cleanPair.includes("US500") || cleanPair.includes("US30") || cleanPair.includes("US2000") || cleanPair.includes("SPX") || cleanPair.includes("GER") || cleanPair.includes("DE30") || cleanPair.includes("DE40") || cleanPair.includes("UK100") || cleanPair.includes("JP225") || cleanPair.includes("HK50") || cleanPair.includes("GOLD") || cleanPair.includes("XAU") || cleanPair.includes("SILVER") || cleanPair.includes("XAG") || cleanPair.includes("INDEX");
  const decimals = isIndexOrMetalOrCrypto ? Math.abs(num) >= 10 ? 2 : Math.abs(num) >= 1 ? 3 : 4 : cleanPair.includes("JPY") ? 3 : 5;
  if (isIndexOrMetalOrCrypto && Number.isInteger(num)) {
    return num.toString();
  }
  const str = num.toFixed(decimals);
  if (!isIndexOrMetalOrCrypto && decimals === 5) {
    return str.replace(/0$/, "");
  }
  return str;
}
function formatRiskReward(rr) {
  if (rr === null || rr === void 0 || rr === "") return "R:R \u2014 N/A";
  if (typeof rr === "string") {
    const trimmed = rr.trim();
    if (trimmed.startsWith("1:")) {
      return `R:R \u2014 ${trimmed}`;
    }
  }
  const num = typeof rr === "number" ? rr : parseFloat(String(rr).replace("1:", ""));
  if (isNaN(num) || num <= 0) return "R:R \u2014 N/A";
  if (Math.abs(num - Math.round(num)) < 0.05) {
    return `R:R \u2014 1:${Math.round(num)}`;
  }
  const formatted = num.toFixed(2).replace(/\.?0+$/, "");
  return `R:R \u2014 1:${formatted}`;
}
function formatDisplayPair(pair) {
  if (!pair) return "";
  if (pair.includes("/")) return pair.toUpperCase();
  const upper = pair.toUpperCase().trim();
  if (upper.length === 6) {
    return `${upper.slice(0, 3)}/${upper.slice(3)}`;
  }
  return upper;
}
function formatTimeframe(tf) {
  if (!tf) return "H1";
  const upper = tf.toUpperCase().trim();
  if (upper === "1M" || upper === "M1" || upper === "1") return "M1";
  if (upper === "5M" || upper === "M5" || upper === "5") return "M5";
  if (upper === "15M" || upper === "M15" || upper === "15") return "M15";
  if (upper === "30M" || upper === "M30" || upper === "30") return "M30";
  if (upper === "1H" || upper === "H1" || upper === "60") return "H1";
  if (upper === "4H" || upper === "H4" || upper === "240") return "H4";
  if (upper === "1D" || upper === "D1" || upper === "D") return "D1";
  return upper;
}
function formatUtcTimestamp(date = /* @__PURE__ */ new Date()) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const dd = String(date.getUTCDate()).padStart(2, "0");
  const mmm = months[date.getUTCMonth()];
  const yyyy = date.getUTCFullYear();
  const hh = String(date.getUTCHours()).padStart(2, "0");
  const min = String(date.getUTCMinutes()).padStart(2, "0");
  return `${dd} ${mmm} ${yyyy} ${hh}:${min} UTC`;
}
function buildTelegramAlertMessage(signal) {
  const cleanPair = (signal.pair || "").toUpperCase().replace("/", "").trim();
  const isBuy = signal.direction.toUpperCase() === "BUY";
  const headerIcon = isBuy ? "\u{1F7E2}" : "\u{1F534}";
  const headerDir = isBuy ? "BUY" : "SELL";
  let entryLine = "";
  if (signal.entryMin !== void 0 && signal.entryMin !== null && signal.entryMax !== void 0 && signal.entryMax !== null) {
    entryLine = `ENTRY ZONE \u2014 ${formatPrice(signal.entryMin, signal.pair)}\u2013${formatPrice(signal.entryMax, signal.pair)}`;
  } else if (signal.entryZone && typeof signal.entryZone === "object" && signal.entryZone.min !== void 0 && signal.entryZone.max !== void 0) {
    entryLine = `ENTRY ZONE \u2014 ${formatPrice(signal.entryZone.min, signal.pair)}\u2013${formatPrice(signal.entryZone.max, signal.pair)}`;
  } else if (typeof signal.entryZone === "string" && signal.entryZone.trim().length > 0) {
    entryLine = `ENTRY ZONE \u2014 ${signal.entryZone.trim()}`;
  } else {
    entryLine = `ENTRY \u2014 ${formatPrice(signal.entryPrice, signal.pair)}`;
  }
  const tpLines = [];
  if (Array.isArray(signal.takeProfits) && signal.takeProfits.length > 0) {
    signal.takeProfits.forEach((tp, idx) => {
      const tpNum = idx + 1;
      if (tp === "OPEN" || tp === null) {
        tpLines.push(`TP${tpNum} \u2014 OPEN`);
      } else {
        tpLines.push(`TP${tpNum} \u2014 ${formatPrice(tp, signal.pair)}`);
      }
    });
  } else if (signal.tp1 !== void 0 || signal.tp2 !== void 0 || signal.tp3 !== void 0) {
    if (signal.tp1 !== void 0 && signal.tp1 !== null) tpLines.push(`TP1 \u2014 ${formatPrice(signal.tp1, signal.pair)}`);
    if (signal.tp2 !== void 0 && signal.tp2 !== null) tpLines.push(`TP2 \u2014 ${formatPrice(signal.tp2, signal.pair)}`);
    if (signal.tp3 !== void 0 && signal.tp3 !== null) {
      tpLines.push(`TP3 \u2014 ${signal.tp3 === "OPEN" ? "OPEN" : formatPrice(signal.tp3, signal.pair)}`);
    }
  } else {
    tpLines.push(`TP1 \u2014 ${formatPrice(signal.takeProfit, signal.pair)}`);
  }
  const slLine = `SL \u2014 ${formatPrice(signal.stopLoss, signal.pair)}`;
  const riskVal = signal.expectedLoss !== void 0 && signal.expectedLoss !== null && Number(signal.expectedLoss) > 0 ? Number(signal.expectedLoss) : Number(signal.riskAmount || 0);
  const riskStr = isNaN(riskVal) ? "$0.00" : `$${riskVal.toFixed(2)}`;
  const rrStr = formatRiskReward(signal.riskRewardRatio);
  let lotNum = signal.lotSize !== void 0 && signal.lotSize !== null ? Number(signal.lotSize) : NaN;
  let posStr = "N/A";
  if (!isNaN(lotNum) && lotNum > 0) {
    posStr = `${lotNum.toFixed(2)} lots`;
  } else if (signal.lotSize === "NONE" || lotNum === 0) {
    posStr = "NONE";
  } else if (signal.lotSize) {
    posStr = `${signal.lotSize} lots`;
  }
  const rawConf = signal.confidenceScore;
  let normalizedConf = 85;
  if (typeof rawConf === "number" && !isNaN(rawConf)) {
    if (rawConf > 0 && rawConf <= 1) {
      normalizedConf = Math.round(rawConf * 100);
    } else {
      normalizedConf = Math.round(rawConf);
    }
  }
  const bulletReasons = "\u2022 Break and retest confirmed.";
  return `${headerIcon} ${headerDir} ${cleanPair} NOW \u{1F6A8}

${entryLine}

${tpLines.join("\n")}

${slLine}

\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501

\u{1F4B0} RISK
Risk \u2014 ${riskStr}
${rrStr}
Position \u2014 ${posStr}
Confidence \u2014 ${normalizedConf}%

\u{1F9E0} WHY
${bulletReasons}

\u26A1 Gaks AI`;
}
function buildTelegramTradeOutcomeMessage(payload) {
  const isWin = payload.outcome === "WIN" || payload.outcome === "BROKER_REALIZED_WIN";
  const cleanPair = (payload.pair || "").toUpperCase().replace("/", "").trim();
  const dir = (payload.direction || "BUY").toUpperCase();
  const dirIcon = dir === "BUY" ? "\u{1F7E2}" : "\u{1F534}";
  const headerIcon = isWin ? "\u{1F3AF}" : "\u{1F6D1}";
  const headerTitle = isWin ? "TAKE PROFIT HIT \u{1F6A8}" : "STOP LOSS HIT \u{1F6A8}";
  const statusLine = isWin ? `${dirIcon} ${cleanPair} ${dir} hit Take Profit` : `${dirIcon} ${cleanPair} ${dir} hit Stop Loss`;
  const pipsVal = payload.pips !== void 0 ? Math.abs(payload.pips) : 0;
  const pipsFormatted = `${isWin ? "+" : "-"}${pipsVal.toFixed(1)} pips`;
  let rFormatted = "";
  if (payload.realizedR !== void 0 && !isNaN(payload.realizedR)) {
    const rVal = Math.abs(payload.realizedR);
    rFormatted = `${isWin ? "+" : "-"}${rVal.toFixed(1)}R`;
  } else {
    rFormatted = isWin ? "+2.0R" : "-1.0R";
  }
  const resultLine = `${pipsFormatted} (${rFormatted})`;
  let postMortemSection = "";
  if (!isWin && payload.lossPostMortem) {
    const pm = payload.lossPostMortem;
    const mfeStr = pm.mfeR !== void 0 && pm.mfeR > 0 ? `+${pm.mfeR.toFixed(1)}R` : "0.0R";
    postMortemSection = `

\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501

\u{1F9E0} AI POST-MORTEM (WHY SL HIT)
\u2022 Root Cause \u2014 ${pm.rootCauseTitle}
\u2022 Max Favorable Excursion \u2014 ${mfeStr}
\u2022 Analysis \u2014 ${pm.summary}
` + (pm.preventiveAdjustment ? `\u2022 AI Adaptation \u2014 ${pm.preventiveAdjustment}` : "");
  }
  let statsSection = "";
  if (payload.totalTrades && payload.totalTrades > 0) {
    const overallWinRateStr = payload.winRate !== void 0 ? `${payload.winRate.toFixed(1)}%` : "0.0%";
    let pairLine = "";
    if (payload.pairTotalTrades && payload.pairTotalTrades > 0 && payload.pairWinRate !== void 0) {
      pairLine = `
\u2022 ${cleanPair} Win Rate \u2014 ${payload.pairWinRate.toFixed(1)}% (${payload.pairWins || 0}/${payload.pairTotalTrades})`;
    }
    statsSection = `

\u{1F4C8} WIN RATE & PERFORMANCE
\u2022 Total Closed Trades \u2014 ${payload.totalTrades}
\u2022 Overall Win Rate \u2014 ${overallWinRateStr} (${payload.wins || 0}W / ${payload.losses || 0}L)${pairLine}`;
  }
  return `${headerIcon} ${headerTitle}

${statusLine}

\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501\u2501

\u{1F4CA} TRADE OUTCOME
ENTRY \u2014 ${formatPrice(payload.entryPrice, payload.pair)}
EXIT \u2014 ${formatPrice(payload.exitPrice, payload.pair)}
RESULT \u2014 ${resultLine}
OUTCOME \u2014 ${isWin ? "WIN \u2705" : "LOSS \u274C"}${postMortemSection}${statsSection}

\u26A1 Gaks AI`;
}
export {
  buildTelegramAlertMessage,
  buildTelegramTradeOutcomeMessage,
  formatDisplayPair,
  formatPrice,
  formatRiskReward,
  formatTimeframe,
  formatUtcTimestamp
};
