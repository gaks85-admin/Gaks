import { timeframeToMinutes } from "./timeframe.js";
function resolveAssetClass(symbol) {
  const clean = (symbol || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  if (["BTC", "ETH", "SOL", "XRP", "CRYPTO", "USDT"].some((c) => clean.includes(c))) {
    return "Crypto";
  }
  if (["XAU", "GOLD", "XAG", "SILVER"].some((c) => clean.includes(c))) {
    return "Gold";
  }
  if (["US30", "NAS100", "SPX", "GER40", "UK100", "US500", "DE30", "DE40", "DOW"].some((c) => clean.includes(c))) {
    return "Indices";
  }
  if (clean.length === 6 || clean.includes("JPY") || clean.includes("USD") || clean.includes("EUR") || clean.includes("GBP")) {
    return "Forex";
  }
  return "Unknown";
}
function isExpectedMarketClosure(startTs, endTs, assetClass = "Forex") {
  if (assetClass === "Crypto") {
    return { isExpected: false };
  }
  const gapMs = endTs - startTs;
  const startDate = new Date(startTs);
  const endDate = new Date(endTs);
  const startDay = startDate.getUTCDay();
  const endDay = endDate.getUTCDay();
  if (assetClass === "Forex" || assetClass === "Unknown") {
    if ((startDay === 5 || startDay === 6) && (endDay === 0 || endDay === 1) && gapMs >= 36 * 60 * 60 * 1e3) {
      return { isExpected: true, reason: "FOREX_WEEKEND_CLOSURE" };
    }
  }
  if (assetClass === "Gold") {
    if ((startDay === 5 || startDay === 6) && (endDay === 0 || endDay === 1) && gapMs >= 36 * 60 * 60 * 1e3) {
      return { isExpected: true, reason: "GOLD_WEEKEND_CLOSURE" };
    }
    if (gapMs <= 2 * 60 * 60 * 1e3 && startDate.getUTCHours() >= 21 && endDate.getUTCHours() <= 23) {
      return { isExpected: true, reason: "GOLD_DAILY_MAINTENANCE_BREAK" };
    }
  }
  if (assetClass === "Indices") {
    if ((startDay === 5 || startDay === 6) && (endDay === 0 || endDay === 1) && gapMs >= 36 * 60 * 60 * 1e3) {
      return { isExpected: true, reason: "INDICES_WEEKEND_CLOSURE" };
    }
    if (gapMs <= 2 * 60 * 60 * 1e3) {
      return { isExpected: true, reason: "INDICES_DAILY_BREAK" };
    }
  }
  if (assetClass === "Unknown") {
    return { isExpected: false, reason: "UNKNOWN_SESSION_SCHEDULE" };
  }
  return { isExpected: false };
}
function validateHistoricalDataset(candles, config) {
  const assetClass = config.assetClass || resolveAssetClass(config.symbol);
  const interval = config.expectedIntervalMinutes || timeframeToMinutes(config.timeframe);
  const report = {
    status: "PENDING",
    totalCandles: candles.length,
    validCandles: 0,
    duplicateCount: 0,
    missingCandleCount: 0,
    invalidOHLCCount: 0,
    timestampIssues: 0,
    firstCandle: "",
    lastCandle: "",
    coveragePercent: 0,
    longestGapMinutes: 0,
    warnings: [],
    errors: []
  };
  if (!candles || candles.length === 0) {
    report.status = "INVALID";
    report.errors.push("Dataset contains zero candles");
    return report;
  }
  report.firstCandle = candles[0].timestamp;
  report.lastCandle = candles[candles.length - 1].timestamp;
  const isSingleCandle = candles.length === 1;
  const timestampSet = /* @__PURE__ */ new Set();
  let lastTs = null;
  let lastClose = null;
  let validCount = 0;
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const ts = new Date(c.timestamp).getTime();
    if (isNaN(ts)) {
      report.timestampIssues++;
      report.errors.push(`Row ${i + 1}: Invalid timestamp string "${c.timestamp}"`);
      continue;
    }
    if (timestampSet.has(ts)) {
      report.duplicateCount++;
      report.errors.push(`Row ${i + 1}: Duplicate timestamp "${c.timestamp}"`);
    }
    timestampSet.add(ts);
    if (lastTs !== null && ts <= lastTs) {
      report.timestampIssues++;
      report.errors.push(`Row ${i + 1}: Timestamp "${c.timestamp}" is out-of-order or duplicate relative to previous candle`);
    }
    let isInvalidOHLC = false;
    if (c.open <= 0 || c.high <= 0 || c.low <= 0 || c.close <= 0) {
      isInvalidOHLC = true;
      report.errors.push(`Row ${i + 1}: Non-positive price found (O:${c.open}, H:${c.high}, L:${c.low}, C:${c.close})`);
    }
    if (isNaN(c.open) || isNaN(c.high) || isNaN(c.low) || isNaN(c.close)) {
      isInvalidOHLC = true;
      report.errors.push(`Row ${i + 1}: NaN price value found`);
    }
    if (c.high < c.low - 1e-7) {
      isInvalidOHLC = true;
      report.errors.push(`Row ${i + 1}: High price (${c.high}) is less than Low price (${c.low})`);
    }
    if (c.high < Math.max(c.open, c.close) - 1e-7) {
      isInvalidOHLC = true;
      report.errors.push(`Row ${i + 1}: High price (${c.high}) is less than max(open, close)`);
    }
    if (c.low > Math.min(c.open, c.close) + 1e-7) {
      isInvalidOHLC = true;
      report.errors.push(`Row ${i + 1}: Low price (${c.low}) is greater than min(open, close)`);
    }
    if (isInvalidOHLC) {
      report.invalidOHLCCount++;
    } else {
      validCount++;
    }
    if (lastClose !== null && lastClose > 0) {
      const priceChangePct = Math.abs(c.close - lastClose) / lastClose;
      if (priceChangePct > 0.15) {
        report.warnings.push(`Row ${i + 1}: Extreme price jump detected (${(priceChangePct * 100).toFixed(1)}%) at ${c.timestamp}`);
      }
    }
    if (lastTs !== null && ts > lastTs) {
      const gapMs = ts - lastTs;
      const expectedGapMs = interval * 60 * 1e3;
      if (gapMs > expectedGapMs) {
        const closureCheck = isExpectedMarketClosure(lastTs, ts, assetClass);
        if (!closureCheck.isExpected) {
          const missingCount = Math.floor(gapMs / expectedGapMs) - 1;
          report.missingCandleCount += Math.max(0, missingCount);
          const gapMins = gapMs / (60 * 1e3);
          if (gapMins > report.longestGapMinutes) {
            report.longestGapMinutes = gapMins;
          }
          if (closureCheck.reason === "UNKNOWN_SESSION_SCHEDULE") {
            report.warnings.push(`Unclassified gap of ${gapMins} minutes starting at ${new Date(lastTs).toISOString()}`);
          }
        }
      }
    }
    lastTs = ts;
    lastClose = c.close;
  }
  report.validCandles = validCount;
  const actualPlusGaps = report.totalCandles + report.missingCandleCount;
  report.coveragePercent = actualPlusGaps > 0 ? Math.round(report.totalCandles / actualPlusGaps * 1e4) / 100 : 0;
  if (isSingleCandle) {
    report.warnings.push("Dataset contains only a single candle");
  }
  if (report.errors.length > 0 || report.duplicateCount > 0 || report.invalidOHLCCount > 0 || report.timestampIssues > 0) {
    report.status = "INVALID";
  } else if (report.coveragePercent < 80 || report.missingCandleCount > report.totalCandles * 0.2) {
    report.status = "PARTIAL";
    report.warnings.push(`Incomplete coverage: ${report.missingCandleCount} missing candles (${report.coveragePercent}% coverage)`);
  } else if (report.warnings.length > 0) {
    report.status = "VALID_WITH_WARNINGS";
  } else {
    report.status = "VALID";
  }
  return report;
}
export {
  isExpectedMarketClosure,
  resolveAssetClass,
  validateHistoricalDataset
};
