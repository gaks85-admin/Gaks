import { getMarketSchedule } from "./market-hours.js";
const MARKET_DATA_PROVIDER_LIMITS = {
  providerName: "Twelve Data",
  minuteCredits: 8,
  // Twelve Data Free/Basic tier limit: 8 credits / minute
  dailyCredits: 800,
  // Twelve Data Free/Basic tier limit: 800 credits / day
  safetyReserve: 1,
  // Keep at least 1 credit safety buffer before hitting hard 429
  requestTimeoutMs: 5e3,
  // 5,000 ms hard timeout per HTTP request
  maxRetries: 1,
  // At most 1 retry for transient 5xx/network errors
  baseDelayMs: 500,
  // Timeframe-aware cache TTLs (ms) matching specification
  timeframeTtlMs: {
    "M1": 45 * 1e3,
    // 30-60s
    "M5": 90 * 1e3,
    // 60-120s
    "M15": 150 * 1e3,
    // 120-180s
    "M30": 240 * 1e3,
    // 180-300s
    "H1": 450 * 1e3,
    // 300-600s
    "H2": 600 * 1e3,
    // 10 minutes
    "H4": 1200 * 1e3,
    // 600-1800s (20m)
    "D1": 2700 * 1e3,
    // 1800-3600s (45m)
    "W1": 14400 * 1e3,
    // 4 hours
    "MN1": 86400 * 1e3
    // 24 hours
  },
  // Maximum acceptable data age thresholds (ms) matching specification
  maxAcceptableAgeMs: {
    "M1": 5 * 60 * 1e3,
    // 5 min
    "M5": 10 * 60 * 1e3,
    // 10 min
    "M15": 30 * 60 * 1e3,
    // 30 min
    "M30": 60 * 60 * 1e3,
    // 60 min
    "H1": 2 * 3600 * 1e3,
    // 2 hours
    "H2": 4 * 3600 * 1e3,
    // 4 hours
    "H4": 8 * 3600 * 1e3,
    // 8 hours
    "D1": 48 * 3600 * 1e3,
    // 48 hours
    "W1": 7 * 86400 * 1e3,
    // 7 days
    "MN1": 30 * 86400 * 1e3
    // 30 days
  },
  priceTtlMs: 30 * 1e3
  // 30 seconds for spot price
};
const KNOWN_CANONICAL_SYMBOLS = /* @__PURE__ */ new Set([
  "EURUSD",
  "GBPUSD",
  "USDJPY",
  "AUDUSD",
  "USDCAD",
  "USDCHF",
  "NZDUSD",
  "EURGBP",
  "EURJPY",
  "GBPJPY",
  "AUDJPY",
  "EURAUD",
  "EURCAD",
  "EURCHF",
  "EURNZD",
  "GBPCHF",
  "GBPAUD",
  "GBPCAD",
  "GBPNZD",
  "AUDCAD",
  "AUDNZD",
  "AUDCHF",
  "CADJPY",
  "CADCHF",
  "CHFJPY",
  "NZDJPY",
  "NZDCAD",
  "NZDCHF",
  "XAUUSD",
  "XAGUSD",
  "BTCUSD",
  "ETHUSD",
  "SOLUSD",
  "XRPUSD",
  "LTCUSD",
  "ADAUSD",
  "DOGEUSD",
  "BNBUSD",
  "AVAXUSD",
  "DOTUSD",
  "LINKUSD",
  "MATICUSD",
  "POLUSD",
  "UNIUSD",
  "NEARUSD",
  "TRXUSD",
  "ATOMUSD",
  "BCHUSD",
  "TONUSD",
  "SUIUSD",
  "SHIBUSD",
  "BTCUSDT",
  "ETHUSDT",
  "SOLUSDT",
  "XRPUSDT",
  "LTCUSDT",
  "ADAUSDT",
  "DOGEUSDT",
  "BNBUSDT",
  "AVAXUSDT",
  "DOTUSDT",
  "LINKUSDT",
  "MATICUSDT",
  "SUIUSDT",
  "TONUSDT",
  "BTCUSDC",
  "ETHUSDC",
  "SOLUSDC",
  "XRPUSDC",
  "NAS100",
  "US100",
  "NDX",
  "USTEC",
  "US30",
  "DJ30",
  "WS30",
  "SPX500",
  "SPX",
  "US500",
  "US2000",
  "RUT",
  "GER30",
  "GER40",
  "DE30",
  "DE40",
  "DAX",
  "UK100",
  "FTSE",
  "FRA40",
  "EU50",
  "JP225",
  "HK50",
  "AUS200"
]);
function mapTimeframeToInterval(timeframe) {
  const mapping = {
    "M1": "1min",
    "M5": "5min",
    "M15": "15min",
    "M30": "30min",
    "H1": "1h",
    "H2": "2h",
    "H4": "4h",
    "D1": "1day",
    "W1": "1week",
    "MN1": "1month"
  };
  return mapping[timeframe] || "1h";
}
function toCanonicalSymbol(symbol) {
  if (!symbol) return "EURUSD";
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, "");
}
function toDisplaySymbol(symbol) {
  const upper = toCanonicalSymbol(symbol);
  if (!upper) return "EUR/USD";
  if (upper.endsWith("USDT") && upper.length > 4) {
    return `${upper.slice(0, -4)}/USDT`;
  }
  if (upper.endsWith("USDC") && upper.length > 4) {
    return `${upper.slice(0, -4)}/USDC`;
  }
  if (upper.endsWith("BUSD") && upper.length > 4) {
    return `${upper.slice(0, -4)}/BUSD`;
  }
  const hasDigits = /\d/.test(upper);
  if (!hasDigits && upper.length === 6) {
    return `${upper.slice(0, 3)}/${upper.slice(3)}`;
  }
  if (!hasDigits && upper.length > 6 && (upper.endsWith("USD") || upper.endsWith("EUR") || upper.endsWith("GBP") || upper.endsWith("JPY"))) {
    return `${upper.slice(0, -3)}/${upper.slice(-3)}`;
  }
  return upper;
}
function isKnownStandardSymbol(symbol) {
  const canonical = toCanonicalSymbol(symbol);
  return KNOWN_CANONICAL_SYMBOLS.has(canonical);
}
class MarketDataGateway {
  healthState;
  primaryApiKey;
  secondaryApiKey;
  // Server-side cache storage (Provider agnostic, shared across cron, manual scans, watchers)
  candleCache = /* @__PURE__ */ new Map();
  priceCache = /* @__PURE__ */ new Map();
  symbolCache = /* @__PURE__ */ new Map();
  // In-flight request deduplication map (prevents duplicate simultaneous requests)
  inFlightCandleRequests = /* @__PURE__ */ new Map();
  inFlightPriceRequests = /* @__PURE__ */ new Map();
  inFlightSymbolRequests = /* @__PURE__ */ new Map();
  // Minute rate tracking
  currentMinuteWindowStart = Math.floor(Date.now() / 6e4) * 6e4;
  minuteRequestCount = 0;
  // Daily rate tracking
  currentDailyWindowStart = (/* @__PURE__ */ new Date()).setUTCHours(0, 0, 0, 0);
  dailyRequestCount = 0;
  constructor() {
    this.primaryApiKey = process.env.TWELVE_DATA_API_KEY_PRIMARY || process.env.TWELVE_DATA_API_KEY || "";
    this.secondaryApiKey = process.env.TWELVE_DATA_API_KEY_SECONDARY || null;
    this.healthState = {
      status: "HEALTHY",
      providerName: MARKET_DATA_PROVIDER_LIMITS.providerName,
      creditsUsed: null,
      creditsRemaining: null,
      currentMinuteUsage: 0,
      dailyUsage: 0,
      lastSuccessfulRequest: null,
      lastQuotaError: null,
      lastFailure: null,
      lastHttpStatus: null,
      cooldownUntil: null,
      consecutiveFailures: 0,
      watchersWaitingForRecovery: 0,
      totalRequests: 0,
      cacheHits: 0,
      requestsSaved: 0,
      deduplicatedRequests: 0,
      quotaBlockedRequests: 0
    };
  }
  getHealth() {
    this.refreshRollingWindows();
    return { ...this.healthState };
  }
  resetHealth() {
    this.healthState.status = "HEALTHY";
    this.healthState.cooldownUntil = null;
    this.healthState.consecutiveFailures = 0;
    this.healthState.watchersWaitingForRecovery = 0;
  }
  /**
   * Refreshes minute and daily rate limit windows and auto-recovers cooldowns.
   */
  refreshRollingWindows() {
    const now = Date.now();
    const currentMinute = Math.floor(now / 6e4) * 6e4;
    if (currentMinute > this.currentMinuteWindowStart) {
      this.currentMinuteWindowStart = currentMinute;
      this.minuteRequestCount = 0;
      this.healthState.currentMinuteUsage = 0;
      if ((this.healthState.status === "QUOTA_EXHAUSTED" || this.healthState.status === "LIMITED") && (!this.healthState.cooldownUntil || now >= this.healthState.cooldownUntil)) {
        console.log(`[MARKET DATA GATEWAY] Minute window reset. Status auto-recovered to HEALTHY.`);
        this.healthState.status = "HEALTHY";
        this.healthState.cooldownUntil = null;
        this.healthState.watchersWaitingForRecovery = 0;
      }
    }
    const todayMidnight = (/* @__PURE__ */ new Date()).setUTCHours(0, 0, 0, 0);
    if (todayMidnight > this.currentDailyWindowStart) {
      this.currentDailyWindowStart = todayMidnight;
      this.dailyRequestCount = 0;
      this.healthState.dailyUsage = 0;
    }
    if (this.healthState.cooldownUntil && now >= this.healthState.cooldownUntil) {
      this.healthState.cooldownUntil = null;
      if (this.healthState.status === "QUOTA_EXHAUSTED" || this.healthState.status === "LIMITED") {
        this.healthState.status = "HEALTHY";
        this.healthState.watchersWaitingForRecovery = 0;
      }
    }
  }
  /**
   * Inspects and parses response headers for Twelve Data quota metrics.
   */
  inspectQuotaHeaders(headers) {
    const used = headers.get("api-credits-used");
    const left = headers.get("api-credits-left");
    if (used) {
      const parsedUsed = parseInt(used, 10);
      if (!isNaN(parsedUsed)) {
        this.healthState.creditsUsed = parsedUsed;
      }
    }
    if (left) {
      const parsedLeft = parseInt(left, 10);
      if (!isNaN(parsedLeft)) {
        this.healthState.creditsRemaining = parsedLeft;
        if (parsedLeft <= MARKET_DATA_PROVIDER_LIMITS.safetyReserve) {
          console.warn(`[MARKET DATA QUOTA] API credits remaining (${parsedLeft}) <= safety reserve (${MARKET_DATA_PROVIDER_LIMITS.safetyReserve}). Setting status to LIMITED.`);
          this.healthState.status = "LIMITED";
          this.healthState.cooldownUntil = Math.max(this.healthState.cooldownUntil || 0, Date.now() + 6e4);
        }
      }
    }
  }
  /**
   * Checks local quota budget before issuing any network request.
   * Returns true if quota is available, false if blocked.
   */
  checkQuotaBudget(logContext) {
    this.refreshRollingWindows();
    const now = Date.now();
    if (this.healthState.cooldownUntil && now < this.healthState.cooldownUntil) {
      const remainingCooldownMs = this.healthState.cooldownUntil - now;
      this.healthState.watchersWaitingForRecovery++;
      this.healthState.quotaBlockedRequests++;
      return {
        allowed: false,
        reason: `Provider in quota cooldown for next ${(remainingCooldownMs / 1e3).toFixed(1)}s`
      };
    }
    const maxMinuteCredits = MARKET_DATA_PROVIDER_LIMITS.minuteCredits - MARKET_DATA_PROVIDER_LIMITS.safetyReserve;
    if (this.minuteRequestCount >= maxMinuteCredits) {
      const secondsUntilMinuteReset = Math.ceil((this.currentMinuteWindowStart + 6e4 - now) / 1e3);
      this.healthState.status = "LIMITED";
      this.healthState.cooldownUntil = this.currentMinuteWindowStart + 6e4;
      this.healthState.watchersWaitingForRecovery++;
      this.healthState.quotaBlockedRequests++;
      return {
        allowed: false,
        reason: `Local minute budget reached (${this.minuteRequestCount}/${MARKET_DATA_PROVIDER_LIMITS.minuteCredits}). Cooldown active for ${secondsUntilMinuteReset}s.`
      };
    }
    if (this.healthState.creditsRemaining !== null && this.healthState.creditsRemaining <= MARKET_DATA_PROVIDER_LIMITS.safetyReserve) {
      this.healthState.status = "QUOTA_EXHAUSTED";
      this.healthState.cooldownUntil = Date.now() + 6e4;
      this.healthState.watchersWaitingForRecovery++;
      this.healthState.quotaBlockedRequests++;
      return {
        allowed: false,
        reason: `Provider credits remaining (${this.healthState.creditsRemaining}) exhausted safety reserve.`
      };
    }
    if (this.dailyRequestCount >= MARKET_DATA_PROVIDER_LIMITS.dailyCredits) {
      this.healthState.status = "QUOTA_EXHAUSTED";
      this.healthState.quotaBlockedRequests++;
      return {
        allowed: false,
        reason: `Daily quota limit reached (${this.dailyRequestCount}/${MARKET_DATA_PROVIDER_LIMITS.dailyCredits}).`
      };
    }
    return { allowed: true };
  }
  /**
   * Records a successfully executed network request.
   */
  recordRequestSuccess(headers) {
    this.healthState.status = "HEALTHY";
    this.healthState.lastSuccessfulRequest = Date.now();
    this.healthState.consecutiveFailures = 0;
    this.healthState.totalRequests++;
    this.minuteRequestCount++;
    this.dailyRequestCount++;
    this.healthState.currentMinuteUsage = this.minuteRequestCount;
    this.healthState.dailyUsage = this.dailyRequestCount;
    this.inspectQuotaHeaders(headers);
  }
  /**
   * Records a failed network request.
   */
  recordRequestFailure(status, errorMessage, headers) {
    this.healthState.lastFailure = Date.now();
    this.healthState.lastHttpStatus = status;
    this.healthState.consecutiveFailures++;
    this.healthState.totalRequests++;
    this.minuteRequestCount++;
    this.dailyRequestCount++;
    this.healthState.currentMinuteUsage = this.minuteRequestCount;
    this.healthState.dailyUsage = this.dailyRequestCount;
    if (headers) {
      this.inspectQuotaHeaders(headers);
    }
    if (status === 429 || errorMessage.includes("429") || errorMessage.includes("limit") || errorMessage.includes("RATE_LIMITED") || errorMessage.includes("credits")) {
      this.healthState.status = "QUOTA_EXHAUSTED";
      this.healthState.lastQuotaError = Date.now();
      this.healthState.cooldownUntil = Date.now() + 6e4;
      console.warn(`[MARKET DATA QUOTA EXHAUSTED] HTTP 429 detected. Cooldown set to 60s. Credits Used: ${this.healthState.creditsUsed ?? "N/A"}, Credits Left: ${this.healthState.creditsRemaining ?? "N/A"}`);
    } else if (status === 401 || status === 403 || errorMessage.includes("apikey") || errorMessage.includes("API key")) {
      this.healthState.status = "INVALID_CREDENTIAL";
    } else if (status && status >= 500) {
      this.healthState.status = "UNAVAILABLE";
    } else {
      this.healthState.status = "LIMITED";
    }
  }
  /**
   * Structured diagnostic logger. Never logs API keys.
   */
  logRequest(details) {
    console.log(
      `[MARKET DATA GATEWAY] Watcher: ${details.watcherId || "N/A"} | User: ${details.userId || "N/A"} | Pair: ${details.symbol} ${details.timeframe || ""} | Endpoint: ${details.endpoint} | Purpose: ${details.purpose} | Status: ${details.httpStatus ?? "N/A"} (${details.quotaStatus}) | Credits Used/Left: ${details.creditsUsed ?? "?"}/${details.creditsRemaining ?? "?"} | Dedup: ${details.dedupStatus} | Retry: ${details.retryCount}`
    );
  }
  /**
   * Validates a symbol locally or via cache/Twelve Data search.
   * Standard symbols are validated instantly without consuming API credits!
   */
  async validateSymbol(symbol, apiKeyOverride) {
    const rawUpper = (symbol || "").toUpperCase().trim();
    const canonical = toCanonicalSymbol(rawUpper);
    const display = toDisplaySymbol(rawUpper);
    if (isKnownStandardSymbol(canonical)) {
      const isCryptoSym = canonical.endsWith("USDT") || canonical.endsWith("USDC") || canonical.endsWith("BUSD") || canonical.includes("BTC") || canonical.includes("ETH") || canonical.includes("SOL") || canonical.includes("XRP") || canonical.includes("LTC") || canonical.includes("ADA") || canonical.includes("DOGE") || canonical.includes("BNB") || canonical.includes("AVAX") || canonical.includes("DOT") || canonical.includes("LINK") || canonical.includes("MATIC") || canonical.includes("POL") || canonical.includes("UNI") || canonical.includes("NEAR") || canonical.includes("TRX") || canonical.includes("ATOM") || canonical.includes("BCH") || canonical.includes("TON") || canonical.includes("SUI") || canonical.includes("SHIB");
      const isMetalSym = canonical.includes("XAU") || canonical.includes("XAG") || canonical.includes("GOLD") || canonical.includes("SILVER");
      const isIndexSym = /\d/.test(canonical) || canonical.includes("NDX") || canonical.includes("SPX") || canonical.includes("DAX") || canonical.includes("FTSE") || canonical.includes("DOW");
      const result = {
        isValid: true,
        matchedSymbol: display,
        instrumentType: isCryptoSym ? "Crypto" : isMetalSym ? "Commodity" : isIndexSym ? "Index" : "Physical Currency"
      };
      this.symbolCache.set(canonical, result);
      return result;
    }
    if (this.symbolCache.has(canonical)) {
      this.healthState.cacheHits++;
      this.healthState.requestsSaved++;
      return this.symbolCache.get(canonical);
    }
    const inFlightKey = `sym_${canonical}`;
    if (this.inFlightSymbolRequests.has(inFlightKey)) {
      this.healthState.deduplicatedRequests++;
      this.healthState.requestsSaved++;
      return this.inFlightSymbolRequests.get(inFlightKey);
    }
    const quotaCheck = this.checkQuotaBudget({ symbol: display });
    if (!quotaCheck.allowed) {
      return {
        isValid: false,
        reason: "MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED"
      };
    }
    const key = apiKeyOverride || this.primaryApiKey;
    if (!key) {
      return { isValid: false, reason: "Twelve Data API key not configured" };
    }
    const promise = (async () => {
      const searchUrl = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(display)}&apikey=${key}`;
      try {
        const response = await fetch(searchUrl, { signal: AbortSignal.timeout(MARKET_DATA_PROVIDER_LIMITS.requestTimeoutMs) });
        if (response.status === 429) {
          this.recordRequestFailure(429, "Rate limit", response.headers);
          this.logRequest({
            symbol: display,
            endpoint: "/symbol_search",
            purpose: "Symbol Validation",
            creditsUsed: this.healthState.creditsUsed,
            creditsRemaining: this.healthState.creditsRemaining,
            httpStatus: 429,
            quotaStatus: "RATE_LIMITED",
            retryCount: 0,
            dedupStatus: "FRESH_NETWORK"
          });
          return { isValid: false, reason: "MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED" };
        }
        const data = await response.json();
        if (data.status === "error") {
          if (data.code === 429 || String(data.message).includes("limit")) {
            this.recordRequestFailure(429, data.message, response.headers);
            return { isValid: false, reason: "MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED" };
          }
          this.recordRequestFailure(response.status, data.message, response.headers);
          return { isValid: false, reason: data.message };
        }
        if (response.ok) {
          this.recordRequestSuccess(response.headers);
          if (data.data && data.data.length > 0) {
            const exactMatch = data.data.find((item) => toCanonicalSymbol(item.symbol) === canonical);
            const match = exactMatch || data.data[0];
            const result = { isValid: true, matchedSymbol: match.symbol, instrumentType: match.instrument_type };
            this.symbolCache.set(canonical, result);
            return result;
          }
          const notFoundResult = { isValid: false, reason: `Symbol ${display} not found on Twelve Data.` };
          this.symbolCache.set(canonical, notFoundResult);
          return notFoundResult;
        }
        this.recordRequestFailure(response.status, "HTTP Error", response.headers);
        return { isValid: false, reason: `HTTP error ${response.status}` };
      } catch (err) {
        this.recordRequestFailure(null, err.message);
        return { isValid: false, reason: err.message || "Symbol search network failure" };
      }
    })();
    this.inFlightSymbolRequests.set(inFlightKey, promise);
    try {
      return await promise;
    } finally {
      this.inFlightSymbolRequests.delete(inFlightKey);
    }
  }
  /**
   * Fetches latest spot price with short-lived cache and deduplication.
   */
  async fetchCurrentPrice(symbol, apiKeyOverride) {
    const canonical = toCanonicalSymbol(symbol);
    const display = toDisplaySymbol(symbol);
    const schedule = getMarketSchedule(canonical);
    if (!schedule.isOpen && schedule.closesOnWeekends) {
      const cached2 = this.priceCache.get(canonical);
      if (cached2) {
        return cached2.price;
      }
      return null;
    }
    const cached = this.priceCache.get(canonical);
    if (cached && Date.now() - cached.timestamp < MARKET_DATA_PROVIDER_LIMITS.priceTtlMs) {
      this.healthState.cacheHits++;
      this.healthState.requestsSaved++;
      return cached.price;
    }
    if (this.inFlightPriceRequests.has(canonical)) {
      this.healthState.deduplicatedRequests++;
      this.healthState.requestsSaved++;
      return this.inFlightPriceRequests.get(canonical);
    }
    const quotaCheck = this.checkQuotaBudget({ symbol: display });
    if (!quotaCheck.allowed) {
      console.warn(`[MARKET DATA QUOTA] fetchCurrentPrice(${display}) blocked by quota governor: ${quotaCheck.reason}`);
      return cached ? cached.price : null;
    }
    const key = apiKeyOverride || this.primaryApiKey;
    if (!key) return null;
    const promise = (async () => {
      const priceUrl = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(display)}&apikey=${key}`;
      try {
        const response = await fetch(priceUrl, { signal: AbortSignal.timeout(MARKET_DATA_PROVIDER_LIMITS.requestTimeoutMs) });
        if (response.status === 429) {
          this.recordRequestFailure(429, "Rate limit", response.headers);
          return cached ? cached.price : null;
        }
        const data = await response.json();
        if (data.status === "error") {
          this.recordRequestFailure(response.status, data.message, response.headers);
          return cached ? cached.price : null;
        }
        if (response.ok && data.price) {
          this.recordRequestSuccess(response.headers);
          const parsed = parseFloat(String(data.price));
          if (!isNaN(parsed) && parsed > 0) {
            this.priceCache.set(canonical, { timestamp: Date.now(), price: parsed });
            return parsed;
          }
        }
        return cached ? cached.price : null;
      } catch (err) {
        this.recordRequestFailure(null, err.message);
        return cached ? cached.price : null;
      }
    })();
    this.inFlightPriceRequests.set(canonical, promise);
    try {
      return await promise;
    } finally {
      this.inFlightPriceRequests.delete(canonical);
    }
  }
  /**
   * Primary Authoritative Entry Point: Fetch Candles & Market Data with Deduplication,
   * Multi-Timeframe TTL Caching, Rate Governor, Hard Timeout, and Fail-Closed Safety.
   */
  async getMarketData(req, apiKeyOverride) {
    const canonical = toCanonicalSymbol(req.symbol);
    const display = toDisplaySymbol(req.symbol);
    const interval = mapTimeframeToInterval(req.timeframe);
    const cacheTtlMs = MARKET_DATA_PROVIDER_LIMITS.timeframeTtlMs[req.timeframe] || 6e4;
    const cacheKey = `twelve-data:${canonical}:${interval}:${req.requiredCount}`;
    const now = Date.now();
    const cached = this.candleCache.get(cacheKey);
    if (cached && now - cached.cachedAt < cacheTtlMs) {
      const cacheAgeMs = now - cached.cachedAt;
      this.healthState.cacheHits++;
      this.healthState.requestsSaved++;
      console.log(`[TWELVE DATA CACHE HIT]
Symbol: ${canonical}
Timeframe: ${req.timeframe}
Age: ${cacheAgeMs}ms`);
      this.logRequest({
        watcherId: req.watcherId,
        userId: req.userId,
        symbol: display,
        timeframe: req.timeframe,
        endpoint: "/time_series",
        purpose: req.purpose || "Market Watcher Scan",
        creditsUsed: this.healthState.creditsUsed,
        creditsRemaining: this.healthState.creditsRemaining,
        httpStatus: 200,
        quotaStatus: "HEALTHY",
        retryCount: 0,
        dedupStatus: "CACHE_HIT"
      });
      return {
        ...cached.result,
        fromCache: true,
        cacheAgeMs,
        creditsUsed: this.healthState.creditsUsed,
        creditsRemaining: this.healthState.creditsRemaining
      };
    }
    const schedule = getMarketSchedule(canonical);
    if (!schedule.isOpen && schedule.closesOnWeekends) {
      if (cached && cached.result && cached.result.candles && cached.result.candles.length >= 2) {
        this.healthState.cacheHits++;
        this.healthState.requestsSaved++;
        console.log(`[WEEKEND MARKET DATA] ${canonical} closed for weekend (${schedule.reason}). Serving Friday close candles from cache.`);
        return {
          ...cached.result,
          fromCache: true,
          cacheAgeMs: now - cached.cachedAt,
          reason: "MARKET_CLOSED_WEEKEND_CACHED",
          creditsUsed: this.healthState.creditsUsed,
          creditsRemaining: this.healthState.creditsRemaining
        };
      }
      console.log(`[WEEKEND CANDLE DOWNLOAD EXCLUDED] ${canonical} skipped: Market closed for weekend (${schedule.reasonWat}). Reopens ${schedule.nextOpenWatFormatted || "Sunday 10:00 PM WAT"} (${schedule.nextOpenTimeFormatted || "Sunday 5:00 PM ET"}). Zero API credits burned.`);
      return {
        isValid: false,
        candles: [],
        reason: `MARKET_CLOSED_WEEKEND: ${schedule.reasonWat}. Reopens ${schedule.nextOpenWatFormatted || "Sunday 10:00 PM WAT"}`,
        errorType: "UNAVAILABLE"
      };
    }
    if (this.inFlightCandleRequests.has(cacheKey)) {
      this.healthState.deduplicatedRequests++;
      this.healthState.requestsSaved++;
      console.log(`[TWELVE DATA REQUEST DEDUP]
Symbol: ${canonical}
Timeframe: ${req.timeframe}`);
      this.logRequest({
        watcherId: req.watcherId,
        userId: req.userId,
        symbol: display,
        timeframe: req.timeframe,
        endpoint: "/time_series",
        purpose: req.purpose || "Market Watcher Scan",
        creditsUsed: this.healthState.creditsUsed,
        creditsRemaining: this.healthState.creditsRemaining,
        httpStatus: 200,
        quotaStatus: "HEALTHY",
        retryCount: 0,
        dedupStatus: "IN_FLIGHT_DEDUP"
      });
      return this.inFlightCandleRequests.get(cacheKey);
    }
    const quotaCheck = this.checkQuotaBudget({
      watcherId: req.watcherId,
      userId: req.userId,
      symbol: display
    });
    if (!quotaCheck.allowed) {
      this.healthState.quotaBlockedRequests++;
      console.warn(`[TWELVE DATA RATE LIMIT]
Symbol: ${canonical}
Timeframe: ${req.timeframe}
Action: CACHE_ONLY`);
      this.logRequest({
        watcherId: req.watcherId,
        userId: req.userId,
        symbol: display,
        timeframe: req.timeframe,
        endpoint: "/time_series",
        purpose: req.purpose || "Market Watcher Scan",
        creditsUsed: this.healthState.creditsUsed,
        creditsRemaining: this.healthState.creditsRemaining,
        httpStatus: 429,
        quotaStatus: this.healthState.status,
        retryCount: 0,
        dedupStatus: "BLOCKED_QUOTA"
      });
      return {
        isValid: false,
        candles: [],
        reason: "TWELVE_DATA_RATE_LIMITED",
        errorType: "QUOTA_EXHAUSTED",
        creditsUsed: this.healthState.creditsUsed,
        creditsRemaining: this.healthState.creditsRemaining
      };
    }
    const key = apiKeyOverride || this.primaryApiKey;
    if (!key) {
      return {
        isValid: false,
        candles: [],
        reason: "TWELVE_DATA_AUTH_ERROR",
        errorType: "INVALID_CREDENTIAL"
      };
    }
    const promise = (async () => {
      const reqStart = Date.now();
      console.log(`[TWELVE DATA REQUEST]
Symbol: ${canonical}
Timeframe: ${req.timeframe}
OutputSize: ${req.requiredCount}`);
      this.healthState.totalRequests++;
      const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(display)}&interval=${interval}&outputsize=${req.requiredCount}&timezone=UTC&apikey=${key}`;
      let attempt = 0;
      const maxRetries = MARKET_DATA_PROVIDER_LIMITS.maxRetries;
      while (attempt < maxRetries) {
        attempt++;
        try {
          const response = await fetch(timeSeriesUrl, { signal: AbortSignal.timeout(MARKET_DATA_PROVIDER_LIMITS.requestTimeoutMs) });
          this.inspectQuotaHeaders(response.headers);
          if (this.healthState.creditsUsed !== null || this.healthState.creditsRemaining !== null) {
            console.log(`[TWELVE DATA USAGE]
Credits Used: ${this.healthState.creditsUsed ?? "N/A"}
Credits Left: ${this.healthState.creditsRemaining ?? "N/A"}`);
          }
          if (response.status === 429) {
            this.recordRequestFailure(429, "Rate limit", response.headers);
            console.warn(`[TWELVE DATA RATE LIMIT]
Symbol: ${canonical}
Timeframe: ${req.timeframe}
Action: CACHE_ONLY`);
            return {
              isValid: false,
              candles: [],
              reason: "TWELVE_DATA_RATE_LIMITED",
              errorType: "QUOTA_EXHAUSTED",
              creditsUsed: this.healthState.creditsUsed,
              creditsRemaining: this.healthState.creditsRemaining
            };
          }
          if (response.status === 401 || response.status === 403) {
            this.recordRequestFailure(response.status, "Authentication Error", response.headers);
            return {
              isValid: false,
              candles: [],
              reason: "TWELVE_DATA_AUTH_ERROR",
              errorType: "INVALID_CREDENTIAL",
              creditsUsed: this.healthState.creditsUsed,
              creditsRemaining: this.healthState.creditsRemaining
            };
          }
          const data = await response.json();
          if (data.status === "error") {
            const rawMsg = String(data.message || "");
            const lowerMsg = rawMsg.toLowerCase();
            if (data.code === 429 || lowerMsg.includes("limit") || lowerMsg.includes("credits") || lowerMsg.includes("quota")) {
              this.recordRequestFailure(429, data.message, response.headers);
              console.warn(`[TWELVE DATA RATE LIMIT]
Symbol: ${canonical}
Timeframe: ${req.timeframe}
Action: CACHE_ONLY`);
              return {
                isValid: false,
                candles: [],
                reason: "TWELVE_DATA_RATE_LIMITED",
                errorType: "QUOTA_EXHAUSTED",
                creditsUsed: this.healthState.creditsUsed,
                creditsRemaining: this.healthState.creditsRemaining
              };
            }
            if (data.code === 400 || lowerMsg.includes("not found") || lowerMsg.includes("invalid")) {
              this.recordRequestFailure(404, data.message, response.headers);
              return {
                isValid: false,
                candles: [],
                reason: "TWELVE_DATA_NOT_FOUND",
                creditsUsed: this.healthState.creditsUsed,
                creditsRemaining: this.healthState.creditsRemaining
              };
            }
            if (data.code === 401 || data.code === 403) {
              this.recordRequestFailure(data.code, data.message, response.headers);
              return {
                isValid: false,
                candles: [],
                reason: "TWELVE_DATA_AUTH_ERROR",
                errorType: "INVALID_CREDENTIAL",
                creditsUsed: this.healthState.creditsUsed,
                creditsRemaining: this.healthState.creditsRemaining
              };
            }
            this.recordRequestFailure(response.status, data.message, response.headers);
            return {
              isValid: false,
              candles: [],
              reason: "TWELVE_DATA_UNKNOWN_ERROR",
              creditsUsed: this.healthState.creditsUsed,
              creditsRemaining: this.healthState.creditsRemaining
            };
          }
          if (response.ok && data.status === "ok" && data.values && Array.isArray(data.values) && data.values.length > 0) {
            this.recordRequestSuccess(response.headers);
            const candleData = [];
            for (let i = data.values.length - 1; i >= 0; i--) {
              const v = data.values[i];
              const o = parseFloat(v.open);
              const h = parseFloat(v.high);
              const l = parseFloat(v.low);
              const c = parseFloat(v.close);
              const vol = v.volume ? parseFloat(v.volume) : void 0;
              if (isNaN(o) || isNaN(h) || isNaN(l) || isNaN(c) || !isFinite(o) || !isFinite(h) || !isFinite(l) || !isFinite(c)) {
                return {
                  isValid: false,
                  candles: [],
                  reason: "MARKET_DATA_INVALID",
                  errorType: "TEMPORARY_ERROR"
                };
              }
              if (h < l || h < Math.max(o, c) || l > Math.min(o, c)) {
                return {
                  isValid: false,
                  candles: [],
                  reason: "MARKET_DATA_INVALID",
                  errorType: "TEMPORARY_ERROR"
                };
              }
              let dtStr = String(v.datetime || "");
              if (dtStr.includes(" ") && !dtStr.includes("T")) {
                dtStr = dtStr.replace(" ", "T");
              }
              if (!dtStr.endsWith("Z") && !dtStr.includes("+")) {
                dtStr += "Z";
              }
              candleData.push({
                timestamp: dtStr,
                open: o,
                high: h,
                low: l,
                close: c,
                volume: vol
              });
            }
            if (candleData.length < 5) {
              return {
                isValid: false,
                candles: [],
                reason: "MARKET_DATA_INVALID",
                errorType: "TEMPORARY_ERROR"
              };
            }
            const latestCandle = candleData[candleData.length - 1];
            const latestCandleMs = new Date(latestCandle.timestamp).getTime();
            const candleAgeMs = Math.max(0, now - latestCandleMs);
            const isCrypto = canonical.endsWith("USDT") || canonical.endsWith("USDC") || canonical.endsWith("BUSD") || canonical.includes("BTC") || canonical.includes("ETH") || canonical.includes("SOL") || canonical.includes("XRP") || canonical.includes("LTC") || canonical.includes("ADA") || canonical.includes("DOGE") || canonical.includes("BNB") || canonical.includes("AVAX") || canonical.includes("DOT") || canonical.includes("LINK") || canonical.includes("MATIC") || canonical.includes("SUI") || canonical.includes("TON");
            const maxAgeMs = MARKET_DATA_PROVIDER_LIMITS.maxAcceptableAgeMs[req.timeframe] || (isCrypto ? 2 * 3600 * 1e3 : 4 * 3600 * 1e3);
            if (candleAgeMs > maxAgeMs) {
              console.warn(`[TWELVE DATA STALE]
Symbol: ${canonical}
Timeframe: ${req.timeframe}
Latest Candle: ${latestCandle.timestamp}
Age: ${candleAgeMs}ms
Action: SKIP`);
              return {
                isValid: false,
                candles: [],
                reason: "TWELVE_DATA_STALE",
                errorType: "UNAVAILABLE"
              };
            }
            const currentPrice = latestCandle.close;
            const durationMs = Date.now() - reqStart;
            console.log(`[TWELVE DATA SUCCESS]
Symbol: ${canonical}
Timeframe: ${req.timeframe}
Duration: ${durationMs}ms`);
            const finalRes = {
              isValid: true,
              candles: candleData,
              currentPrice,
              fromCache: false,
              creditsUsed: this.healthState.creditsUsed,
              creditsRemaining: this.healthState.creditsRemaining
            };
            this.candleCache.set(cacheKey, { timestamp: now, result: finalRes, cachedAt: now });
            if (currentPrice) {
              this.priceCache.set(canonical, { timestamp: now, price: currentPrice });
            }
            return finalRes;
          }
          this.recordRequestFailure(response.status, "Unexpected provider payload", response.headers);
          return {
            isValid: false,
            candles: [],
            reason: "TWELVE_DATA_INVALID_RESPONSE",
            errorType: "TEMPORARY_ERROR"
          };
        } catch (err) {
          const durationMs = Date.now() - reqStart;
          if (err.name === "TimeoutError" || err.name === "AbortError" || err.message?.includes("timeout") || err.message?.includes("aborted")) {
            this.recordRequestFailure(null, "TWELVE_DATA_TIMEOUT");
            console.warn(`[TWELVE DATA TIMEOUT]
Symbol: ${canonical}
Timeframe: ${req.timeframe}
Duration: ${durationMs}ms`);
            return {
              isValid: false,
              candles: [],
              reason: "TWELVE_DATA_TIMEOUT",
              errorType: "NETWORK_TIMEOUT"
            };
          }
          if (attempt >= maxRetries) {
            this.recordRequestFailure(null, err.message);
            return {
              isValid: false,
              candles: [],
              reason: "TWELVE_DATA_TEMPORARY_ERROR",
              errorType: "NETWORK_TIMEOUT"
            };
          }
          await new Promise((resolve) => setTimeout(resolve, MARKET_DATA_PROVIDER_LIMITS.baseDelayMs));
        }
      }
      return {
        isValid: false,
        candles: [],
        reason: "TWELVE_DATA_TEMPORARY_ERROR",
        errorType: "UNAVAILABLE"
      };
    })();
    this.inFlightCandleRequests.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      this.inFlightCandleRequests.delete(cacheKey);
    }
  }
}
const marketDataGateway = new MarketDataGateway();
export {
  MARKET_DATA_PROVIDER_LIMITS,
  MarketDataGateway,
  isKnownStandardSymbol,
  mapTimeframeToInterval,
  marketDataGateway,
  toCanonicalSymbol,
  toDisplaySymbol
};
