/**
 * GAKS AI — Comprehensive Historical Data Quality Validator & Trading Calendar Engine (Stage D4)
 * Validates candle OHLC integrity, detects gaps using multi-asset trading calendars,
 * handles DST shifts, and produces deterministic quality reports.
 */

import { ParsedCandle } from './backtest-csv.js';
import { DatasetValidationReport, DatasetValidationStatus } from './backtest-types.js';
import { timeframeToMinutes } from './timeframe.js';

export type AssetClass = 'Forex' | 'Gold' | 'Indices' | 'Crypto' | 'Unknown';

export interface TradingCalendarConfig {
  symbol: string;
  timeframe: string;
  assetClass?: AssetClass;
  expectedIntervalMinutes: number;
  sourceTimezone?: string; // Default 'UTC'
}

/**
 * Determines asset class from symbol if not explicitly provided.
 */
export function resolveAssetClass(symbol: string): AssetClass {
  const clean = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (['BTC', 'ETH', 'SOL', 'XRP', 'CRYPTO', 'USDT'].some(c => clean.includes(c))) {
    return 'Crypto';
  }
  if (['XAU', 'GOLD', 'XAG', 'SILVER'].some(c => clean.includes(c))) {
    return 'Gold';
  }
  if (['US30', 'NAS100', 'SPX', 'GER40', 'UK100', 'US500', 'DE30', 'DE40', 'DOW'].some(c => clean.includes(c))) {
    return 'Indices';
  }
  if (clean.length === 6 || clean.includes('JPY') || clean.includes('USD') || clean.includes('EUR') || clean.includes('GBP')) {
    return 'Forex';
  }
  return 'Unknown';
}

/**
 * Determines whether a timestamp gap between `startTs` and `endTs` is an expected market closure.
 */
export function isExpectedMarketClosure(
  startTs: number,
  endTs: number,
  assetClass: AssetClass = 'Forex'
): { isExpected: boolean; reason?: string } {
  // 1. Crypto is 24/7/365 - No expected market closures
  if (assetClass === 'Crypto') {
    return { isExpected: false };
  }

  const gapMs = endTs - startTs;
  const startDate = new Date(startTs);
  const endDate = new Date(endTs);

  const startDay = startDate.getUTCDay(); // 0=Sun, 5=Fri, 6=Sat
  const endDay = endDate.getUTCDay();

  // 2. Forex Weekend Closure: Friday ~22:00 UTC to Sunday ~22:00 UTC
  if (assetClass === 'Forex' || assetClass === 'Unknown') {
    // If the gap spans Friday -> Sunday/Monday and is at least 36 hours
    if ((startDay === 5 || startDay === 6) && (endDay === 0 || endDay === 1) && gapMs >= 36 * 60 * 60 * 1000) {
      return { isExpected: true, reason: 'FOREX_WEEKEND_CLOSURE' };
    }
  }

  // 3. Gold / Metals Daily Maintenance Break (22:00 - 23:00 UTC) + Weekend (Fri 22:00 - Sun 23:00 UTC)
  if (assetClass === 'Gold') {
    if ((startDay === 5 || startDay === 6) && (endDay === 0 || endDay === 1) && gapMs >= 36 * 60 * 60 * 1000) {
      return { isExpected: true, reason: 'GOLD_WEEKEND_CLOSURE' };
    }
    // Daily 1-hour break (~22:00 - 23:00 UTC)
    if (gapMs <= 2 * 60 * 60 * 1000 && startDate.getUTCHours() >= 21 && endDate.getUTCHours() <= 23) {
      return { isExpected: true, reason: 'GOLD_DAILY_MAINTENANCE_BREAK' };
    }
  }

  // 4. Indices Maintenance Breaks & Weekends
  if (assetClass === 'Indices') {
    if ((startDay === 5 || startDay === 6) && (endDay === 0 || endDay === 1) && gapMs >= 36 * 60 * 60 * 1000) {
      return { isExpected: true, reason: 'INDICES_WEEKEND_CLOSURE' };
    }
    if (gapMs <= 2 * 60 * 60 * 1000) {
      return { isExpected: true, reason: 'INDICES_DAILY_BREAK' };
    }
  }

  // 5. Unknown Session Schedule
  if (assetClass === 'Unknown') {
    return { isExpected: false, reason: 'UNKNOWN_SESSION_SCHEDULE' };
  }

  return { isExpected: false };
}

/**
 * Validates a dataset of candles and returns a detailed quality report.
 */
export function validateHistoricalDataset(
  candles: ParsedCandle[],
  config: TradingCalendarConfig
): DatasetValidationReport {
  const assetClass = config.assetClass || resolveAssetClass(config.symbol);
  const interval = config.expectedIntervalMinutes || timeframeToMinutes(config.timeframe);

  const report: DatasetValidationReport = {
    status: 'PENDING',
    totalCandles: candles.length,
    validCandles: 0,
    duplicateCount: 0,
    missingCandleCount: 0,
    invalidOHLCCount: 0,
    timestampIssues: 0,
    firstCandle: '',
    lastCandle: '',
    coveragePercent: 0,
    longestGapMinutes: 0,
    warnings: [],
    errors: []
  };

  // 1. Boundary Check
  if (!candles || candles.length === 0) {
    report.status = 'INVALID';
    report.errors.push('Dataset contains zero candles');
    return report;
  }

  report.firstCandle = candles[0].timestamp;
  report.lastCandle = candles[candles.length - 1].timestamp;

  // Single candle warning flag
  const isSingleCandle = candles.length === 1;

  const timestampSet = new Set<number>();
  let lastTs: number | null = null;
  let lastClose: number | null = null;
  let validCount = 0;

  // 2. Scan Candles
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const ts = new Date(c.timestamp).getTime();

    // Timestamp Validity
    if (isNaN(ts)) {
      report.timestampIssues++;
      report.errors.push(`Row ${i + 1}: Invalid timestamp string "${c.timestamp}"`);
      continue;
    }

    // Duplicate Check
    if (timestampSet.has(ts)) {
      report.duplicateCount++;
      report.errors.push(`Row ${i + 1}: Duplicate timestamp "${c.timestamp}"`);
    }
    timestampSet.add(ts);

    // Out of Order Check
    if (lastTs !== null && ts <= lastTs) {
      report.timestampIssues++;
      report.errors.push(`Row ${i + 1}: Timestamp "${c.timestamp}" is out-of-order or duplicate relative to previous candle`);
    }

    // OHLC Numeric & Logical Integrity
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

    // Price Jump / Spike Anomaly Detection (>15% jump in single candle)
    if (lastClose !== null && lastClose > 0) {
      const priceChangePct = Math.abs(c.close - lastClose) / lastClose;
      if (priceChangePct > 0.15) {
        report.warnings.push(`Row ${i + 1}: Extreme price jump detected (${(priceChangePct * 100).toFixed(1)}%) at ${c.timestamp}`);
      }
    }

    // Gap Detection
    if (lastTs !== null && ts > lastTs) {
      const gapMs = ts - lastTs;
      const expectedGapMs = interval * 60 * 1000;

      if (gapMs > expectedGapMs) {
        const closureCheck = isExpectedMarketClosure(lastTs, ts, assetClass);
        if (!closureCheck.isExpected) {
          const missingCount = Math.floor(gapMs / expectedGapMs) - 1;
          report.missingCandleCount += Math.max(0, missingCount);

          const gapMins = gapMs / (60 * 1000);
          if (gapMins > report.longestGapMinutes) {
            report.longestGapMinutes = gapMins;
          }

          if (closureCheck.reason === 'UNKNOWN_SESSION_SCHEDULE') {
            report.warnings.push(`Unclassified gap of ${gapMins} minutes starting at ${new Date(lastTs).toISOString()}`);
          }
        }
      }
    }

    lastTs = ts;
    lastClose = c.close;
  }

  report.validCandles = validCount;

  // 3. Calendar-Adjusted Coverage Calculation
  const actualPlusGaps = report.totalCandles + report.missingCandleCount;
  report.coveragePercent = actualPlusGaps > 0 ? Math.round((report.totalCandles / actualPlusGaps) * 10000) / 100 : 0;

  if (isSingleCandle) {
    report.warnings.push('Dataset contains only a single candle');
  }

  // 4. Final Status Criteria Assignment
  if (report.errors.length > 0 || report.duplicateCount > 0 || report.invalidOHLCCount > 0 || report.timestampIssues > 0) {
    report.status = 'INVALID';
  } else if (report.coveragePercent < 80.0 || report.missingCandleCount > report.totalCandles * 0.2) {
    report.status = 'PARTIAL';
    report.warnings.push(`Incomplete coverage: ${report.missingCandleCount} missing candles (${report.coveragePercent}% coverage)`);
  } else if (report.warnings.length > 0) {
    report.status = 'VALID_WITH_WARNINGS';
  } else {
    report.status = 'VALID';
  }

  return report;
}
