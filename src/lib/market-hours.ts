import { resolveInstrumentSpec } from './risk-engine.js';
import { toCanonicalSymbol } from './market-data-gateway.js';

export type AssetClassType = 'Crypto' | 'Forex' | 'Gold' | 'Indices';

export interface MarketSchedule {
  symbol: string;
  canonicalSymbol: string;
  assetClass: AssetClassType;
  closesOnWeekends: boolean;
  isOpen: boolean;
  isWeekendClosed: boolean;
  reason: string;
  reasonWat: string;
  currentNyTime: {
    weekday: string;
    dayOfWeek: number;
    hour: number;
    minute: number;
    formatted: string;
  };
  currentWatTime: {
    weekday: string;
    dayOfWeek: number;
    hour: number;
    minute: number;
    formatted: string;
    timeZoneLabel: string;
  };
  nextOpenDate: Date | null;
  nextOpenTimeFormatted: string | null;
  nextOpenWatFormatted: string | null;
  fridayCloseWatFormatted: string | null;
  closureScheduleWat: string;
}

const CRYPTO_ROOTS = new Set([
  'BTC', 'ETH', 'SOL', 'XRP', 'LTC', 'DOGE', 'BNB', 'ADA',
  'AVAX', 'DOT', 'LINK', 'MATIC', 'SHIB', 'UNI', 'NEAR', 'TRX', 'ATOM', 'BCH'
]);

/**
 * Checks whether a given symbol is an always-open cryptocurrency pair.
 * Crypto markets operate 24/7/365 without weekend closure.
 */
export function isCryptoPair(symbol: string): boolean {
  if (!symbol) return false;
  const canonical = toCanonicalSymbol(symbol);

  // Check prefix or contains known crypto tokens
  for (const root of CRYPTO_ROOTS) {
    if (canonical.startsWith(root) || canonical.includes(root)) {
      return true;
    }
  }

  if (canonical.endsWith('USDT') || canonical.endsWith('USDC') || canonical.endsWith('BUSD')) {
    return true;
  }

  try {
    const spec = resolveInstrumentSpec(canonical);
    return spec.assetClass === 'Crypto';
  } catch {
    return false;
  }
}

/**
 * Returns whether a trading pair/instrument closes on weekends.
 * - Crypto (BTC, ETH, SOL, etc.) => false (trades 24/7/365 continuously in Nigeria & globally)
 * - Forex (EURUSD, GBPUSD, etc.) => true (closes Friday ~10:00 PM WAT to Sunday 10:00 PM WAT)
 * - Metals (XAUUSD, XAGUSD, etc.) => true (closes Friday ~10:00 PM WAT to Sunday 11:00 PM WAT)
 * - Indices (NAS100, US30, etc.) => true (closes Friday ~10:00 PM WAT to Sunday 11:00 PM WAT)
 */
export function closesOnWeekends(symbol: string): boolean {
  return !isCryptoPair(symbol);
}

/**
 * Extracts date components in Africa/Lagos timezone (West Africa Time / Nigerian Time, UTC+1).
 * Nigeria does not observe daylight saving time, so it remains strictly UTC+1 year-round.
 */
export function getNigerianDateTime(date: Date = new Date()): {
  weekday: string;
  dayOfWeek: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  formatted: string;
  timeZoneLabel: string;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Lagos',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }

  const dayMap: Record<string, number> = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
  };

  const dayOfWeek = dayMap[map.weekday || 'Sun'] ?? 0;
  const hour = parseInt(map.hour || '0', 10);
  const minute = parseInt(map.minute || '0', 10);
  const second = parseInt(map.second || '0', 10);
  const year = parseInt(map.year || '2026', 10);
  const month = parseInt(map.month || '1', 10);
  const day = parseInt(map.day || '1', 10);

  const formatted = `${map.weekday} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} WAT`;

  return {
    weekday: map.weekday || 'Sun',
    dayOfWeek,
    year,
    month,
    day,
    hour,
    minute,
    second,
    formatted,
    timeZoneLabel: 'WAT (GMT+1)'
  };
}

/**
 * Extracts date components in the America/New_York timezone (standard reference for global market hours).
 */
export function getNewYorkDateTime(date: Date = new Date()): {
  weekday: string;
  dayOfWeek: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  formatted: string;
} {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  });

  const parts = formatter.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }

  const dayMap: Record<string, number> = {
    'Sun': 0, 'Mon': 1, 'Tue': 2, 'Wed': 3, 'Thu': 4, 'Fri': 5, 'Sat': 6
  };

  const dayOfWeek = dayMap[map.weekday || 'Sun'] ?? 0;
  const hour = parseInt(map.hour || '0', 10);
  const minute = parseInt(map.minute || '0', 10);
  const second = parseInt(map.second || '0', 10);
  const year = parseInt(map.year || '2026', 10);
  const month = parseInt(map.month || '1', 10);
  const day = parseInt(map.day || '1', 10);

  const formatted = `${map.weekday} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} ET`;

  return {
    weekday: map.weekday || 'Sun',
    dayOfWeek,
    year,
    month,
    day,
    hour,
    minute,
    second,
    formatted
  };
}

/**
 * Calculates the exact next market open timestamp for weekend-closed instruments.
 */
function calculateNextOpenDate(
  currentNy: ReturnType<typeof getNewYorkDateTime>,
  reopenHour: number,
  referenceDate: Date
): Date {
  const { dayOfWeek, year, month, day } = currentNy;
  
  // Calculate how many days until Sunday
  const daysUntilSunday = (7 - dayOfWeek) % 7;

  // Candidate UTC date roughly matching Sunday in New York
  let candidate = new Date(Date.UTC(year, month - 1, day + daysUntilSunday, reopenHour + 4, 0, 0));

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false
  });

  const candHour = parseInt(formatter.format(candidate), 10);
  if (candHour !== reopenHour) {
    const diffHours = reopenHour - candHour;
    candidate = new Date(candidate.getTime() + diffHours * 3600 * 1000);
  }

  // If already past reopening time on Sunday, target next Friday-Sunday
  if (candidate.getTime() <= referenceDate.getTime()) {
    candidate = new Date(candidate.getTime() + 7 * 24 * 3600 * 1000);
  }

  return candidate;
}

/**
 * Calculates the exact Friday close timestamp (Friday 5:00 PM New York).
 */
function calculateFridayCloseDate(
  currentNy: ReturnType<typeof getNewYorkDateTime>
): Date {
  const { dayOfWeek, year, month, day } = currentNy;
  let diffDays = 5 - dayOfWeek;
  if (dayOfWeek === 0) {
    diffDays = -2;
  } else if (dayOfWeek === 6) {
    diffDays = -1;
  }

  let candidate = new Date(Date.UTC(year, month - 1, day + diffDays, 17 + 4, 0, 0));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric',
    hour12: false
  });
  const candHour = parseInt(formatter.format(candidate), 10);
  if (candHour !== 17) {
    candidate = new Date(candidate.getTime() + (17 - candHour) * 3600 * 1000);
  }
  return candidate;
}

/**
 * Formats a Date object in Nigerian Time (Africa/Lagos, WAT, GMT+1).
 */
export function formatDateInWat(date: Date | null): string | null {
  if (!date) return null;
  const tzFormat = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Africa/Lagos',
    weekday: 'long',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true
  });
  return `${tzFormat.format(date)} WAT`;
}

/**
 * Evaluates the full market schedule and status for a given symbol,
 * providing both New York and Nigerian (WAT) timezone metrics.
 */
export function getMarketSchedule(symbol: string, referenceDate: Date = new Date()): MarketSchedule {
  const canonical = toCanonicalSymbol(symbol);
  const isCrypto = isCryptoPair(canonical);

  let assetClass: AssetClassType = 'Forex';
  if (isCrypto) {
    assetClass = 'Crypto';
  } else {
    try {
      const spec = resolveInstrumentSpec(canonical);
      assetClass = spec.assetClass;
    } catch {
      assetClass = 'Forex';
    }
  }

  const nyTime = getNewYorkDateTime(referenceDate);
  const watTime = getNigerianDateTime(referenceDate);

  // 1. CRYPTO: Trades 24/7/365 continuously in Nigeria and globally
  if (isCrypto) {
    return {
      symbol,
      canonicalSymbol: canonical,
      assetClass: 'Crypto',
      closesOnWeekends: false,
      isOpen: true,
      isWeekendClosed: false,
      reason: 'Crypto trades 24/7/365 continuously',
      reasonWat: 'Crypto pairs trade 24/7 in Nigeria (WAT) without weekend close',
      currentNyTime: {
        weekday: nyTime.weekday,
        dayOfWeek: nyTime.dayOfWeek,
        hour: nyTime.hour,
        minute: nyTime.minute,
        formatted: nyTime.formatted
      },
      currentWatTime: watTime,
      nextOpenDate: null,
      nextOpenTimeFormatted: null,
      nextOpenWatFormatted: null,
      fridayCloseWatFormatted: null,
      closureScheduleWat: '24/7 continuous trading in Nigeria'
    };
  }

  // 2. NON-CRYPTO INSTRUMENTS: Closes on Weekends
  // - Forex: Reopens Sunday 17:00 (5:00 PM) NY => Sunday 10:00 PM WAT (Nigeria Time)
  // - Gold/Metals & Indices: Reopens Sunday 18:00 (6:00 PM) NY => Sunday 11:00 PM WAT (Nigeria Time)
  const reopenHour = (assetClass === 'Gold' || assetClass === 'Indices') ? 18 : 17;
  const reopenLabelNy = reopenHour === 18 ? '6:00 PM ET' : '5:00 PM ET';
  const reopenLabelWat = reopenHour === 18 ? '11:00 PM WAT' : '10:00 PM WAT';

  const dow = nyTime.dayOfWeek;
  const hr = nyTime.hour;

  let isWeekendClosed = false;
  let reason = '';
  let reasonWat = '';

  if (dow === 6) {
    // Entire Saturday is closed globally
    isWeekendClosed = true;
    reason = 'Saturday global market close';
    reasonWat = `Saturday market close in Nigeria (reopens Sunday ${reopenLabelWat})`;
  } else if (dow === 5 && hr >= 17) {
    // Friday after 5:00 PM NY (~10:00 PM Nigerian Time)
    isWeekendClosed = true;
    reason = 'Friday weekly close (after 5:00 PM ET)';
    reasonWat = `Friday weekly close in Nigeria (reopens Sunday ${reopenLabelWat})`;
  } else if (dow === 0 && hr < reopenHour) {
    // Sunday before reopening hour
    isWeekendClosed = true;
    reason = `Sunday pre-market (opens at ${reopenLabelNy})`;
    reasonWat = `Sunday pre-market in Nigeria (opens at ${reopenLabelWat})`;
  }

  const nextOpenDate = isWeekendClosed
    ? calculateNextOpenDate(nyTime, reopenHour, referenceDate)
    : null;

  const fridayCloseDate = calculateFridayCloseDate(nyTime);
  const fridayCloseWatFormatted = formatDateInWat(fridayCloseDate);
  const nextOpenWatFormatted = formatDateInWat(nextOpenDate);

  let nextOpenTimeFormatted: string | null = null;
  if (nextOpenDate) {
    const tzFormat = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday: 'long',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short'
    });
    nextOpenTimeFormatted = tzFormat.format(nextOpenDate);
  }

  const closureScheduleWat = `Closes Friday ~10:00 PM WAT • Reopens Sunday ${reopenLabelWat} (Nigeria Time)`;

  return {
    symbol,
    canonicalSymbol: canonical,
    assetClass,
    closesOnWeekends: true,
    isOpen: !isWeekendClosed,
    isWeekendClosed,
    reason: isWeekendClosed ? reason : 'Market is actively trading',
    reasonWat: isWeekendClosed ? reasonWat : 'Market is actively trading in Nigeria (WAT)',
    currentNyTime: {
      weekday: nyTime.weekday,
      dayOfWeek: nyTime.dayOfWeek,
      hour: nyTime.hour,
      minute: nyTime.minute,
      formatted: nyTime.formatted
    },
    currentWatTime: watTime,
    nextOpenDate,
    nextOpenTimeFormatted,
    nextOpenWatFormatted,
    fridayCloseWatFormatted,
    closureScheduleWat
  };
}

/**
 * Fast boolean check if a market is actively open for trading and candle updates.
 */
export function isMarketOpen(symbol: string, referenceDate: Date = new Date()): boolean {
  return getMarketSchedule(symbol, referenceDate).isOpen;
}

/**
 * UI helper to format a badge for pair cards and watchlist,
 * calibrated with Nigerian Time (WAT).
 */
export function getMarketStatusBadge(symbol: string, referenceDate: Date = new Date()): {
  label: string;
  isOpen: boolean;
  closesOnWeekends: boolean;
  status: '24_7' | 'open' | 'closed';
  detail: string;
  detailWat: string;
  nextOpenWatFormatted: string | null;
  closureScheduleWat: string;
  currentWatFormatted: string;
} {
  const schedule = getMarketSchedule(symbol, referenceDate);

  if (!schedule.closesOnWeekends) {
    return {
      label: '24/7 Active',
      isOpen: true,
      closesOnWeekends: false,
      status: '24_7',
      detail: 'Continuous 24/7 trading in Nigeria (WAT)',
      detailWat: 'Trades 24/7 in Nigeria without weekend break',
      nextOpenWatFormatted: null,
      closureScheduleWat: 'Continuous 24/7 in Nigeria',
      currentWatFormatted: schedule.currentWatTime.formatted
    };
  }

  if (schedule.isOpen) {
    return {
      label: 'Market Open',
      isOpen: true,
      closesOnWeekends: true,
      status: 'open',
      detail: `Active • Closes Friday 10:00 PM WAT`,
      detailWat: `Market is open in Nigeria (WAT). Closes Friday 10:00 PM WAT.`,
      nextOpenWatFormatted: null,
      closureScheduleWat: schedule.closureScheduleWat,
      currentWatFormatted: schedule.currentWatTime.formatted
    };
  }

  return {
    label: 'Weekend Closed',
    isOpen: false,
    closesOnWeekends: true,
    status: 'closed',
    detail: `Reopens ${schedule.nextOpenWatFormatted || 'Sunday 10:00 PM WAT'}`,
    detailWat: `Closed in Nigeria (WAT). Reopens ${schedule.nextOpenWatFormatted || 'Sunday 10:00 PM WAT'}.`,
    nextOpenWatFormatted: schedule.nextOpenWatFormatted,
    closureScheduleWat: schedule.closureScheduleWat,
    currentWatFormatted: schedule.currentWatTime.formatted
  };
}
