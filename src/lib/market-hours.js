import { resolveInstrumentSpec } from "./risk-engine.js";
import { toCanonicalSymbol } from "./market-data-gateway.js";
const CRYPTO_ROOTS = /* @__PURE__ */ new Set([
  "BTC",
  "ETH",
  "SOL",
  "XRP",
  "LTC",
  "DOGE",
  "BNB",
  "ADA",
  "AVAX",
  "DOT",
  "LINK",
  "MATIC",
  "POL",
  "SHIB",
  "UNI",
  "NEAR",
  "TRX",
  "ATOM",
  "BCH",
  "TON",
  "SUI",
  "PEPE",
  "ARB",
  "OP",
  "APT",
  "AAVE",
  "ALGO",
  "FIL",
  "ICP",
  "VET",
  "HBAR",
  "XLM",
  "FTM",
  "SAND",
  "MANA",
  "AXS",
  "CRV",
  "MKR",
  "SNX",
  "COMP",
  "INJ",
  "RUNE",
  "SEI",
  "TIA",
  "WIF",
  "BONK",
  "FLOKI",
  "ETC",
  "XMR",
  "ZEC",
  "DASH",
  "EOS",
  "XTZ",
  "THETA"
]);
const CRYPTO_QUOTE_SUFFIXES = ["USDT", "USDC", "BUSD", "FDUSD", "USD", "EUR", "GBP", "JPY", "BTC", "ETH"];
function isCryptoPair(symbol) {
  if (!symbol) return false;
  const canonical = toCanonicalSymbol(symbol);
  if (canonical.endsWith("USDT") || canonical.endsWith("USDC") || canonical.endsWith("BUSD") || canonical.endsWith("FDUSD")) {
    return true;
  }
  for (const root of CRYPTO_ROOTS) {
    if (canonical === root) return true;
    if (canonical.startsWith(root)) {
      const rest = canonical.slice(root.length);
      if (CRYPTO_QUOTE_SUFFIXES.includes(rest)) {
        return true;
      }
    }
  }
  try {
    const spec = resolveInstrumentSpec(canonical);
    return spec.assetClass === "Crypto";
  } catch {
    return false;
  }
}
function closesOnWeekends(symbol) {
  return !isCryptoPair(symbol);
}
function getNigerianDateTime(date = /* @__PURE__ */ new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Lagos",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  const dayMap = {
    "Sun": 0,
    "Mon": 1,
    "Tue": 2,
    "Wed": 3,
    "Thu": 4,
    "Fri": 5,
    "Sat": 6
  };
  const dayOfWeek = dayMap[map.weekday || "Sun"] ?? 0;
  const hour = parseInt(map.hour || "0", 10);
  const minute = parseInt(map.minute || "0", 10);
  const second = parseInt(map.second || "0", 10);
  const year = parseInt(map.year || "2026", 10);
  const month = parseInt(map.month || "1", 10);
  const day = parseInt(map.day || "1", 10);
  const formatted = `${map.weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} WAT`;
  return {
    weekday: map.weekday || "Sun",
    dayOfWeek,
    year,
    month,
    day,
    hour,
    minute,
    second,
    formatted,
    timeZoneLabel: "WAT (GMT+1)"
  };
}
function getNewYorkDateTime(date = /* @__PURE__ */ new Date()) {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false
  });
  const parts = formatter.formatToParts(date);
  const map = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  const dayMap = {
    "Sun": 0,
    "Mon": 1,
    "Tue": 2,
    "Wed": 3,
    "Thu": 4,
    "Fri": 5,
    "Sat": 6
  };
  const dayOfWeek = dayMap[map.weekday || "Sun"] ?? 0;
  const hour = parseInt(map.hour || "0", 10);
  const minute = parseInt(map.minute || "0", 10);
  const second = parseInt(map.second || "0", 10);
  const year = parseInt(map.year || "2026", 10);
  const month = parseInt(map.month || "1", 10);
  const day = parseInt(map.day || "1", 10);
  const formatted = `${map.weekday} ${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")} ET`;
  return {
    weekday: map.weekday || "Sun",
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
function calculateNextOpenDate(currentNy, reopenHour, referenceDate) {
  const { dayOfWeek, year, month, day } = currentNy;
  const daysUntilSunday = (7 - dayOfWeek) % 7;
  let candidate = new Date(Date.UTC(year, month - 1, day + daysUntilSunday, reopenHour + 4, 0, 0));
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false
  });
  const candHour = parseInt(formatter.format(candidate), 10);
  if (candHour !== reopenHour) {
    const diffHours = reopenHour - candHour;
    candidate = new Date(candidate.getTime() + diffHours * 3600 * 1e3);
  }
  if (candidate.getTime() <= referenceDate.getTime()) {
    candidate = new Date(candidate.getTime() + 7 * 24 * 3600 * 1e3);
  }
  return candidate;
}
function calculateFridayCloseDate(currentNy) {
  const { dayOfWeek, year, month, day } = currentNy;
  let diffDays = 5 - dayOfWeek;
  if (dayOfWeek === 0) {
    diffDays = -2;
  } else if (dayOfWeek === 6) {
    diffDays = -1;
  }
  let candidate = new Date(Date.UTC(year, month - 1, day + diffDays, 17 + 4, 0, 0));
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    hour12: false
  });
  const candHour = parseInt(formatter.format(candidate), 10);
  if (candHour !== 17) {
    candidate = new Date(candidate.getTime() + (17 - candHour) * 3600 * 1e3);
  }
  return candidate;
}
function formatDateInWat(date) {
  if (!date) return null;
  const tzFormat = new Intl.DateTimeFormat("en-US", {
    timeZone: "Africa/Lagos",
    weekday: "long",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
  return `${tzFormat.format(date)} WAT`;
}
function getMarketSchedule(symbol, referenceDate = /* @__PURE__ */ new Date()) {
  const canonical = toCanonicalSymbol(symbol);
  const isCrypto = isCryptoPair(canonical);
  let assetClass = "Forex";
  let isMetal = false;
  if (isCrypto) {
    assetClass = "Crypto";
  } else {
    try {
      const spec = resolveInstrumentSpec(canonical);
      isMetal = String(spec.assetClass) === "Gold" || String(spec.assetClass) === "Silver" || canonical.includes("XAG") || canonical.includes("SILVER");
      assetClass = isMetal ? "Gold" : spec.assetClass;
    } catch {
      assetClass = "Forex";
    }
  }
  const nyTime = getNewYorkDateTime(referenceDate);
  const watTime = getNigerianDateTime(referenceDate);
  if (isCrypto) {
    return {
      symbol,
      canonicalSymbol: canonical,
      assetClass: "Crypto",
      closesOnWeekends: false,
      isOpen: true,
      isWeekendClosed: false,
      reason: "Crypto trades 24/7/365 continuously",
      reasonWat: "Crypto pairs trade 24/7 in Nigeria (WAT) without weekend close",
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
      closureScheduleWat: "24/7 continuous trading in Nigeria"
    };
  }
  const reopenHour = assetClass === "Gold" || assetClass === "Indices" ? 18 : 17;
  const reopenLabelNy = reopenHour === 18 ? "6:00 PM ET" : "5:00 PM ET";
  const reopenLabelWat = reopenHour === 18 ? "11:00 PM WAT" : "10:00 PM WAT";
  const dow = nyTime.dayOfWeek;
  const hr = nyTime.hour;
  let isWeekendClosed = false;
  let reason = "";
  let reasonWat = "";
  if (dow === 6) {
    isWeekendClosed = true;
    reason = "Saturday global market close";
    reasonWat = `Saturday market close in Nigeria (reopens Sunday ${reopenLabelWat})`;
  } else if (dow === 5 && hr >= 17) {
    isWeekendClosed = true;
    reason = "Friday weekly close (after 5:00 PM ET)";
    reasonWat = `Friday weekly close in Nigeria (reopens Sunday ${reopenLabelWat})`;
  } else if (dow === 0 && hr < reopenHour) {
    isWeekendClosed = true;
    reason = `Sunday pre-market (opens at ${reopenLabelNy})`;
    reasonWat = `Sunday pre-market in Nigeria (opens at ${reopenLabelWat})`;
  }
  const nextOpenDate = isWeekendClosed ? calculateNextOpenDate(nyTime, reopenHour, referenceDate) : null;
  const fridayCloseDate = calculateFridayCloseDate(nyTime);
  const fridayCloseWatFormatted = formatDateInWat(fridayCloseDate);
  const nextOpenWatFormatted = formatDateInWat(nextOpenDate);
  let nextOpenTimeFormatted = null;
  if (nextOpenDate) {
    const tzFormat = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      weekday: "long",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZoneName: "short"
    });
    nextOpenTimeFormatted = tzFormat.format(nextOpenDate);
  }
  const closureScheduleWat = `Closes Friday ~10:00 PM WAT \u2022 Reopens Sunday ${reopenLabelWat} (Nigeria Time)`;
  return {
    symbol,
    canonicalSymbol: canonical,
    assetClass,
    closesOnWeekends: true,
    isOpen: !isWeekendClosed,
    isWeekendClosed,
    reason: isWeekendClosed ? reason : "Market is actively trading",
    reasonWat: isWeekendClosed ? reasonWat : "Market is actively trading in Nigeria (WAT)",
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
function isMarketOpen(symbol, referenceDate = /* @__PURE__ */ new Date()) {
  return getMarketSchedule(symbol, referenceDate).isOpen;
}
function getMarketStatusBadge(symbol, referenceDate = /* @__PURE__ */ new Date()) {
  const schedule = getMarketSchedule(symbol, referenceDate);
  if (!schedule.closesOnWeekends) {
    return {
      label: "24/7 Active",
      isOpen: true,
      closesOnWeekends: false,
      status: "24_7",
      detail: "Continuous 24/7 trading in Nigeria (WAT)",
      detailWat: "Trades 24/7 in Nigeria without weekend break",
      nextOpenWatFormatted: null,
      closureScheduleWat: "Continuous 24/7 in Nigeria",
      currentWatFormatted: schedule.currentWatTime.formatted
    };
  }
  if (schedule.isOpen) {
    return {
      label: "Market Open",
      isOpen: true,
      closesOnWeekends: true,
      status: "open",
      detail: `Active \u2022 Closes Friday 10:00 PM WAT`,
      detailWat: `Market is open in Nigeria (WAT). Closes Friday 10:00 PM WAT.`,
      nextOpenWatFormatted: null,
      closureScheduleWat: schedule.closureScheduleWat,
      currentWatFormatted: schedule.currentWatTime.formatted
    };
  }
  return {
    label: "Weekend Closed",
    isOpen: false,
    closesOnWeekends: true,
    status: "closed",
    detail: `Reopens ${schedule.nextOpenWatFormatted || "Sunday 10:00 PM WAT"}`,
    detailWat: `Closed in Nigeria (WAT). Reopens ${schedule.nextOpenWatFormatted || "Sunday 10:00 PM WAT"}.`,
    nextOpenWatFormatted: schedule.nextOpenWatFormatted,
    closureScheduleWat: schedule.closureScheduleWat,
    currentWatFormatted: schedule.currentWatTime.formatted
  };
}
export {
  closesOnWeekends,
  formatDateInWat,
  getMarketSchedule,
  getMarketStatusBadge,
  getNewYorkDateTime,
  getNigerianDateTime,
  isCryptoPair,
  isMarketOpen
};
