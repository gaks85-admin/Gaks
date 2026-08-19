import { Candle } from "./strategy-engine.js";

export interface MarketDataRequest {
  symbol: string;
  timeframe: string;
  requiredCount: number;
  watcherId?: string;
  userId?: string;
  purpose?: string;
}

export interface MarketDataResult {
  isValid: boolean;
  candles: Candle[];
  reason?: string;
  currentPrice?: number;
  fromCache?: boolean;
  cacheAgeMs?: number;
  creditsUsed?: number | null;
  creditsRemaining?: number | null;
  errorType?: 'QUOTA_EXHAUSTED' | 'RATE_LIMITED' | 'NETWORK_TIMEOUT' | 'INVALID_CREDENTIAL' | 'UNAVAILABLE' | 'TEMPORARY_ERROR';
}

export type GatewayProviderStatus = 'HEALTHY' | 'LIMITED' | 'QUOTA_EXHAUSTED' | 'UNAVAILABLE' | 'INVALID_CREDENTIAL';

export interface GatewayHealthState {
  status: GatewayProviderStatus;
  providerName: string;
  creditsUsed: number | null;
  creditsRemaining: number | null;
  currentMinuteUsage: number;
  dailyUsage: number;
  lastSuccessfulRequest: number | null;
  lastQuotaError: number | null;
  lastFailure: number | null;
  lastHttpStatus: number | null;
  cooldownUntil: number | null;
  consecutiveFailures: number;
  watchersWaitingForRecovery: number;
  totalRequests: number;
  cacheHits: number;
  requestsSaved: number;
  deduplicatedRequests: number;
  quotaBlockedRequests: number;
}

// ----------------------------------------------------
// Centrally Configured Provider Limits & Policies
// ----------------------------------------------------
export const MARKET_DATA_PROVIDER_LIMITS = {
  providerName: 'Twelve Data',
  minuteCredits: 8,           // Twelve Data Free/Basic tier limit: 8 credits / minute
  dailyCredits: 800,          // Twelve Data Free/Basic tier limit: 800 credits / day
  safetyReserve: 1,           // Keep at least 1 credit safety buffer before hitting hard 429
  requestTimeoutMs: 6500,     // 6.5s hard timeout per HTTP request
  maxRetries: 2,              // Max retries for transient non-429 failures
  baseDelayMs: 500,

  // Conservative freshness TTLs by timeframe (ms)
  timeframeTtlMs: {
    'M1': 25 * 1000,          // 25 seconds
    'M5': 60 * 1000,          // 1 minute
    'M15': 120 * 1000,        // 2 minutes
    'M30': 240 * 1000,        // 4 minutes
    'H1': 360 * 1000,         // 6 minutes
    'H2': 600 * 1000,         // 10 minutes
    'H4': 900 * 1000,         // 15 minutes
    'D1': 3600 * 1000,        // 1 hour
    'W1': 14400 * 1000,       // 4 hours
    'MN1': 86400 * 1000       // 24 hours
  } as Record<string, number>,

  priceTtlMs: 30 * 1000       // 30 seconds for spot price
};

// ----------------------------------------------------
// Canonical Local Symbol Formatting & Validation
// Avoids costly remote symbol_search API credit consumption for standard instruments
// ----------------------------------------------------
const KNOWN_CANONICAL_SYMBOLS = new Set([
  'EURUSD', 'GBPUSD', 'USDJPY', 'AUDUSD', 'USDCAD', 'USDCHF', 'NZDUSD',
  'EURGBP', 'EURJPY', 'GBPJPY', 'AUDJPY', 'EURAUD', 'EURCAD', 'GBPCHF',
  'AUDCAD', 'AUDNZD', 'CADJPY', 'CHFJPY', 'NZDJPY', 'GBPAUD', 'GBPCAD',
  'XAUUSD', 'XAGUSD', 'BTCUSD', 'ETHUSD', 'SOLUSD', 'LTCUSD',
  'NAS100', 'US30', 'SPX500', 'GER30', 'UK100', 'US500', 'US2000'
]);

export function mapTimeframeToInterval(timeframe: string): string {
  const mapping: Record<string, string> = {
    'M1': '1min', 'M5': '5min', 'M15': '15min', 'M30': '30min',
    'H1': '1h', 'H2': '2h', 'H4': '4h',
    'D1': '1day', 'W1': '1week', 'MN1': '1month'
  };
  return mapping[timeframe] || '1h';
}

export function toCanonicalSymbol(symbol: string): string {
  if (!symbol) return 'EURUSD';
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

export function toDisplaySymbol(symbol: string): string {
  const upper = toCanonicalSymbol(symbol);
  if (upper.length === 6 && !upper.includes('/')) {
    return `${upper.slice(0, 3)}/${upper.slice(3)}`;
  }
  return upper;
}

export function isKnownStandardSymbol(symbol: string): boolean {
  const canonical = toCanonicalSymbol(symbol);
  return KNOWN_CANONICAL_SYMBOLS.has(canonical);
}

// ----------------------------------------------------
// Market Data Gateway Class
// ----------------------------------------------------
export class MarketDataGateway {
  private healthState: GatewayHealthState;
  private primaryApiKey: string;
  private secondaryApiKey: string | null;

  // Server-side cache storage (Provider agnostic, shared across cron, manual scans, watchers)
  private candleCache = new Map<string, { timestamp: number; result: MarketDataResult; cachedAt: number }>();
  private priceCache = new Map<string, { timestamp: number; price: number }>();
  private symbolCache = new Map<string, { isValid: boolean; matchedSymbol?: string; instrumentType?: string; reason?: string }>();

  // In-flight request deduplication map (prevents duplicate simultaneous requests)
  private inFlightCandleRequests = new Map<string, Promise<MarketDataResult>>();
  private inFlightPriceRequests = new Map<string, Promise<number | null>>();
  private inFlightSymbolRequests = new Map<string, Promise<{ isValid: boolean; matchedSymbol?: string; instrumentType?: string; reason?: string }>>();

  // Minute rate tracking
  private currentMinuteWindowStart = Math.floor(Date.now() / 60000) * 60000;
  private minuteRequestCount = 0;

  // Daily rate tracking
  private currentDailyWindowStart = new Date().setUTCHours(0, 0, 0, 0);
  private dailyRequestCount = 0;

  constructor() {
    this.primaryApiKey = process.env.TWELVE_DATA_API_KEY_PRIMARY || process.env.TWELVE_DATA_API_KEY || '';
    this.secondaryApiKey = process.env.TWELVE_DATA_API_KEY_SECONDARY || null;

    this.healthState = {
      status: 'HEALTHY',
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

  public getHealth(): GatewayHealthState {
    this.refreshRollingWindows();
    return { ...this.healthState };
  }

  public resetHealth(): void {
    this.healthState.status = 'HEALTHY';
    this.healthState.cooldownUntil = null;
    this.healthState.consecutiveFailures = 0;
    this.healthState.watchersWaitingForRecovery = 0;
  }

  /**
   * Refreshes minute and daily rate limit windows and auto-recovers cooldowns.
   */
  private refreshRollingWindows(): void {
    const now = Date.now();

    // Check minute rolling reset
    const currentMinute = Math.floor(now / 60000) * 60000;
    if (currentMinute > this.currentMinuteWindowStart) {
      this.currentMinuteWindowStart = currentMinute;
      this.minuteRequestCount = 0;
      this.healthState.currentMinuteUsage = 0;

      // Auto-recover if status was QUOTA_EXHAUSTED or LIMITED due to minute capacity
      if (
        (this.healthState.status === 'QUOTA_EXHAUSTED' || this.healthState.status === 'LIMITED') &&
        (!this.healthState.cooldownUntil || now >= this.healthState.cooldownUntil)
      ) {
        console.log(`[MARKET DATA GATEWAY] Minute window reset. Status auto-recovered to HEALTHY.`);
        this.healthState.status = 'HEALTHY';
        this.healthState.cooldownUntil = null;
        this.healthState.watchersWaitingForRecovery = 0;
      }
    }

    // Check daily rolling reset
    const todayMidnight = new Date().setUTCHours(0, 0, 0, 0);
    if (todayMidnight > this.currentDailyWindowStart) {
      this.currentDailyWindowStart = todayMidnight;
      this.dailyRequestCount = 0;
      this.healthState.dailyUsage = 0;
    }

    // Check if cooldown timer expired
    if (this.healthState.cooldownUntil && now >= this.healthState.cooldownUntil) {
      this.healthState.cooldownUntil = null;
      if (this.healthState.status === 'QUOTA_EXHAUSTED' || this.healthState.status === 'LIMITED') {
        this.healthState.status = 'HEALTHY';
        this.healthState.watchersWaitingForRecovery = 0;
      }
    }
  }

  /**
   * Inspects and parses response headers for Twelve Data quota metrics.
   */
  private inspectQuotaHeaders(headers: Headers): void {
    const used = headers.get('api-credits-used');
    const left = headers.get('api-credits-left');

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
        
        // If credits left is approaching safety reserve, adjust status to LIMITED
        if (parsedLeft <= MARKET_DATA_PROVIDER_LIMITS.safetyReserve) {
          console.warn(`[MARKET DATA QUOTA] API credits remaining (${parsedLeft}) <= safety reserve (${MARKET_DATA_PROVIDER_LIMITS.safetyReserve}). Setting status to LIMITED.`);
          this.healthState.status = 'LIMITED';
          this.healthState.cooldownUntil = Math.max(this.healthState.cooldownUntil || 0, Date.now() + 60000);
        }
      }
    }
  }

  /**
   * Checks local quota budget before issuing any network request.
   * Returns true if quota is available, false if blocked.
   */
  private checkQuotaBudget(logContext: { watcherId?: string; userId?: string; symbol?: string }): { allowed: boolean; reason?: string } {
    this.refreshRollingWindows();
    const now = Date.now();

    // 1. Check active cooldown
    if (this.healthState.cooldownUntil && now < this.healthState.cooldownUntil) {
      const remainingCooldownMs = this.healthState.cooldownUntil - now;
      this.healthState.watchersWaitingForRecovery++;
      this.healthState.quotaBlockedRequests++;
      return {
        allowed: false,
        reason: `Provider in quota cooldown for next ${(remainingCooldownMs / 1000).toFixed(1)}s`
      };
    }

    // 2. Check local minute budget
    const maxMinuteCredits = MARKET_DATA_PROVIDER_LIMITS.minuteCredits - MARKET_DATA_PROVIDER_LIMITS.safetyReserve;
    if (this.minuteRequestCount >= maxMinuteCredits) {
      const secondsUntilMinuteReset = Math.ceil((this.currentMinuteWindowStart + 60000 - now) / 1000);
      this.healthState.status = 'LIMITED';
      this.healthState.cooldownUntil = this.currentMinuteWindowStart + 60000;
      this.healthState.watchersWaitingForRecovery++;
      this.healthState.quotaBlockedRequests++;
      return {
        allowed: false,
        reason: `Local minute budget reached (${this.minuteRequestCount}/${MARKET_DATA_PROVIDER_LIMITS.minuteCredits}). Cooldown active for ${secondsUntilMinuteReset}s.`
      };
    }

    // 3. Check credits remaining from provider header
    if (this.healthState.creditsRemaining !== null && this.healthState.creditsRemaining <= MARKET_DATA_PROVIDER_LIMITS.safetyReserve) {
      this.healthState.status = 'QUOTA_EXHAUSTED';
      this.healthState.cooldownUntil = Date.now() + 60000;
      this.healthState.watchersWaitingForRecovery++;
      this.healthState.quotaBlockedRequests++;
      return {
        allowed: false,
        reason: `Provider credits remaining (${this.healthState.creditsRemaining}) exhausted safety reserve.`
      };
    }

    // 4. Check daily limit
    if (this.dailyRequestCount >= MARKET_DATA_PROVIDER_LIMITS.dailyCredits) {
      this.healthState.status = 'QUOTA_EXHAUSTED';
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
  private recordRequestSuccess(headers: Headers): void {
    this.healthState.status = 'HEALTHY';
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
  private recordRequestFailure(status: number | null, errorMessage: string, headers?: Headers): void {
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

    if (status === 429 || errorMessage.includes('429') || errorMessage.includes('limit') || errorMessage.includes('RATE_LIMITED') || errorMessage.includes('credits')) {
      this.healthState.status = 'QUOTA_EXHAUSTED';
      this.healthState.lastQuotaError = Date.now();
      this.healthState.cooldownUntil = Date.now() + 60000; // 60s cooldown until next minute window
      console.warn(`[MARKET DATA QUOTA EXHAUSTED] HTTP 429 detected. Cooldown set to 60s. Credits Used: ${this.healthState.creditsUsed ?? 'N/A'}, Credits Left: ${this.healthState.creditsRemaining ?? 'N/A'}`);
    } else if (status === 401 || status === 403 || errorMessage.includes('apikey') || errorMessage.includes('API key')) {
      this.healthState.status = 'INVALID_CREDENTIAL';
    } else if (status && status >= 500) {
      this.healthState.status = 'UNAVAILABLE';
    } else {
      this.healthState.status = 'LIMITED';
    }
  }

  /**
   * Structured diagnostic logger. Never logs API keys.
   */
  private logRequest(details: {
    watcherId?: string;
    userId?: string;
    symbol: string;
    timeframe?: string;
    endpoint: string;
    purpose: string;
    creditsUsed: number | null;
    creditsRemaining: number | null;
    httpStatus: number | null;
    quotaStatus: string;
    retryCount: number;
    dedupStatus: 'FRESH_NETWORK' | 'IN_FLIGHT_DEDUP' | 'CACHE_HIT' | 'BLOCKED_QUOTA';
  }): void {
    console.log(
      `[MARKET DATA GATEWAY] ` +
      `Watcher: ${details.watcherId || 'N/A'} | ` +
      `User: ${details.userId || 'N/A'} | ` +
      `Pair: ${details.symbol} ${details.timeframe || ''} | ` +
      `Endpoint: ${details.endpoint} | ` +
      `Purpose: ${details.purpose} | ` +
      `Status: ${details.httpStatus ?? 'N/A'} (${details.quotaStatus}) | ` +
      `Credits Used/Left: ${details.creditsUsed ?? '?'}/${details.creditsRemaining ?? '?'} | ` +
      `Dedup: ${details.dedupStatus} | ` +
      `Retry: ${details.retryCount}`
    );
  }

  /**
   * Validates a symbol locally or via cache/Twelve Data search.
   * Standard symbols are validated instantly without consuming API credits!
   */
  public async validateSymbol(symbol: string, apiKeyOverride?: string): Promise<{ isValid: boolean; matchedSymbol?: string; instrumentType?: string; reason?: string }> {
    const rawUpper = (symbol || '').toUpperCase().trim();
    const canonical = toCanonicalSymbol(rawUpper);
    const display = toDisplaySymbol(rawUpper);

    // 1. Instant local validation for known standard pairs (0 API credits used)
    if (isKnownStandardSymbol(canonical)) {
      const result = {
        isValid: true,
        matchedSymbol: display,
        instrumentType: canonical.includes('BTC') || canonical.includes('ETH') ? 'Crypto' :
                        canonical.includes('XAU') || canonical.includes('XAG') ? 'Commodity' :
                        canonical.includes('NAS') || canonical.includes('SPX') || canonical.includes('US30') ? 'Index' : 'Physical Currency'
      };
      this.symbolCache.set(canonical, result);
      return result;
    }

    // 2. Check in-memory symbol validation cache
    if (this.symbolCache.has(canonical)) {
      this.healthState.cacheHits++;
      this.healthState.requestsSaved++;
      return this.symbolCache.get(canonical)!;
    }

    // 3. Check in-flight validation requests
    const inFlightKey = `sym_${canonical}`;
    if (this.inFlightSymbolRequests.has(inFlightKey)) {
      this.healthState.deduplicatedRequests++;
      this.healthState.requestsSaved++;
      return this.inFlightSymbolRequests.get(inFlightKey)!;
    }

    // 4. Check quota budget before performing remote symbol search
    const quotaCheck = this.checkQuotaBudget({ symbol: display });
    if (!quotaCheck.allowed) {
      return {
        isValid: false,
        reason: 'MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED'
      };
    }

    const key = apiKeyOverride || this.primaryApiKey;
    if (!key) {
      return { isValid: false, reason: 'Twelve Data API key not configured' };
    }

    const promise = (async () => {
      const searchUrl = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(display)}&apikey=${key}`;
      try {
        const response = await fetch(searchUrl, { signal: AbortSignal.timeout(MARKET_DATA_PROVIDER_LIMITS.requestTimeoutMs) });
        if (response.status === 429) {
          this.recordRequestFailure(429, 'Rate limit', response.headers);
          this.logRequest({
            symbol: display,
            endpoint: '/symbol_search',
            purpose: 'Symbol Validation',
            creditsUsed: this.healthState.creditsUsed,
            creditsRemaining: this.healthState.creditsRemaining,
            httpStatus: 429,
            quotaStatus: 'RATE_LIMITED',
            retryCount: 0,
            dedupStatus: 'FRESH_NETWORK'
          });
          return { isValid: false, reason: 'MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED' };
        }

        const data = await response.json();
        if (data.status === 'error') {
          if (data.code === 429 || String(data.message).includes('limit')) {
            this.recordRequestFailure(429, data.message, response.headers);
            return { isValid: false, reason: 'MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED' };
          }
          this.recordRequestFailure(response.status, data.message, response.headers);
          return { isValid: false, reason: data.message };
        }

        if (response.ok) {
          this.recordRequestSuccess(response.headers);
          if (data.data && data.data.length > 0) {
            const exactMatch = data.data.find((item: any) => toCanonicalSymbol(item.symbol) === canonical);
            const match = exactMatch || data.data[0];
            const result = { isValid: true, matchedSymbol: match.symbol, instrumentType: match.instrument_type };
            this.symbolCache.set(canonical, result);
            return result;
          }
          const notFoundResult = { isValid: false, reason: `Symbol ${display} not found on Twelve Data.` };
          this.symbolCache.set(canonical, notFoundResult);
          return notFoundResult;
        }

        this.recordRequestFailure(response.status, 'HTTP Error', response.headers);
        return { isValid: false, reason: `HTTP error ${response.status}` };
      } catch (err: any) {
        this.recordRequestFailure(null, err.message);
        return { isValid: false, reason: err.message || 'Symbol search network failure' };
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
  public async fetchCurrentPrice(symbol: string, apiKeyOverride?: string): Promise<number | null> {
    const canonical = toCanonicalSymbol(symbol);
    const display = toDisplaySymbol(symbol);

    // 1. Check price cache
    const cached = this.priceCache.get(canonical);
    if (cached && (Date.now() - cached.timestamp < MARKET_DATA_PROVIDER_LIMITS.priceTtlMs)) {
      this.healthState.cacheHits++;
      this.healthState.requestsSaved++;
      return cached.price;
    }

    // 2. Check in-flight price requests
    if (this.inFlightPriceRequests.has(canonical)) {
      this.healthState.deduplicatedRequests++;
      this.healthState.requestsSaved++;
      return this.inFlightPriceRequests.get(canonical)!;
    }

    // 3. Check quota budget
    const quotaCheck = this.checkQuotaBudget({ symbol: display });
    if (!quotaCheck.allowed) {
      console.warn(`[MARKET DATA QUOTA] fetchCurrentPrice(${display}) blocked by quota governor: ${quotaCheck.reason}`);
      return cached ? cached.price : null;
    }

    const key = apiKeyOverride || this.primaryApiKey;
    if (!key) return null;

    const promise = (async (): Promise<number | null> => {
      const priceUrl = `https://api.twelvedata.com/price?symbol=${encodeURIComponent(display)}&apikey=${key}`;
      try {
        const response = await fetch(priceUrl, { signal: AbortSignal.timeout(MARKET_DATA_PROVIDER_LIMITS.requestTimeoutMs) });
        if (response.status === 429) {
          this.recordRequestFailure(429, 'Rate limit', response.headers);
          return cached ? cached.price : null;
        }

        const data = await response.json();
        if (data.status === 'error') {
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
      } catch (err: any) {
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
   * Multi-Timeframe TTL Caching, Rate Governor, and Fail-Closed Safety.
   */
  public async getMarketData(req: MarketDataRequest, apiKeyOverride?: string): Promise<MarketDataResult> {
    const canonical = toCanonicalSymbol(req.symbol);
    const display = toDisplaySymbol(req.symbol);
    const interval = mapTimeframeToInterval(req.timeframe);
    const cacheTtlMs = MARKET_DATA_PROVIDER_LIMITS.timeframeTtlMs[req.timeframe] || 60000;
    const cacheKey = `${canonical}_${interval}_${req.requiredCount}`;
    const now = Date.now();

    // 1. Check Server-Side Multi-Timeframe Cache
    const cached = this.candleCache.get(cacheKey);
    if (cached && (now - cached.cachedAt < cacheTtlMs)) {
      this.healthState.cacheHits++;
      this.healthState.requestsSaved++;
      this.logRequest({
        watcherId: req.watcherId,
        userId: req.userId,
        symbol: display,
        timeframe: req.timeframe,
        endpoint: '/time_series',
        purpose: req.purpose || 'Market Watcher Scan',
        creditsUsed: this.healthState.creditsUsed,
        creditsRemaining: this.healthState.creditsRemaining,
        httpStatus: 200,
        quotaStatus: 'HEALTHY',
        retryCount: 0,
        dedupStatus: 'CACHE_HIT'
      });

      return {
        ...cached.result,
        fromCache: true,
        cacheAgeMs: now - cached.cachedAt,
        creditsUsed: this.healthState.creditsUsed,
        creditsRemaining: this.healthState.creditsRemaining
      };
    }

    // 2. Check In-Flight Request Deduplication
    if (this.inFlightCandleRequests.has(cacheKey)) {
      this.healthState.deduplicatedRequests++;
      this.healthState.requestsSaved++;
      this.logRequest({
        watcherId: req.watcherId,
        userId: req.userId,
        symbol: display,
        timeframe: req.timeframe,
        endpoint: '/time_series',
        purpose: req.purpose || 'Market Watcher Scan',
        creditsUsed: this.healthState.creditsUsed,
        creditsRemaining: this.healthState.creditsRemaining,
        httpStatus: 200,
        quotaStatus: 'HEALTHY',
        retryCount: 0,
        dedupStatus: 'IN_FLIGHT_DEDUP'
      });

      return this.inFlightCandleRequests.get(cacheKey)!;
    }

    // 3. Check Quota Budget & Provider Cooldown
    const quotaCheck = this.checkQuotaBudget({
      watcherId: req.watcherId,
      userId: req.userId,
      symbol: display
    });

    if (!quotaCheck.allowed) {
      this.logRequest({
        watcherId: req.watcherId,
        userId: req.userId,
        symbol: display,
        timeframe: req.timeframe,
        endpoint: '/time_series',
        purpose: req.purpose || 'Market Watcher Scan',
        creditsUsed: this.healthState.creditsUsed,
        creditsRemaining: this.healthState.creditsRemaining,
        httpStatus: 429,
        quotaStatus: this.healthState.status,
        retryCount: 0,
        dedupStatus: 'BLOCKED_QUOTA'
      });

      // If we have a slightly older cached result that is still temporally acceptable, we DO NOT serve stale data for trade execution;
      // we fail-closed with structured quota exhausted status so the watcher safely evaluates NO_TRADE.
      return {
        isValid: false,
        candles: [],
        reason: 'MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED',
        errorType: 'QUOTA_EXHAUSTED',
        creditsUsed: this.healthState.creditsUsed,
        creditsRemaining: this.healthState.creditsRemaining
      };
    }

    const key = apiKeyOverride || this.primaryApiKey;
    if (!key) {
      return {
        isValid: false,
        candles: [],
        reason: 'Twelve Data API key not configured',
        errorType: 'INVALID_CREDENTIAL'
      };
    }

    // 4. Execute Network Request with Bounded Exponential Backoff (for transient non-429 errors)
    const promise = (async (): Promise<MarketDataResult> => {
      const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(display)}&interval=${interval}&outputsize=${req.requiredCount}&timezone=UTC&apikey=${key}`;

      let attempt = 0;
      const maxRetries = MARKET_DATA_PROVIDER_LIMITS.maxRetries;

      while (attempt < maxRetries) {
        attempt++;
        try {
          const response = await fetch(timeSeriesUrl, { signal: AbortSignal.timeout(MARKET_DATA_PROVIDER_LIMITS.requestTimeoutMs) });

          // Handle 429 immediately without retry
          if (response.status === 429) {
            this.recordRequestFailure(429, 'Rate limit', response.headers);
            this.logRequest({
              watcherId: req.watcherId,
              userId: req.userId,
              symbol: display,
              timeframe: req.timeframe,
              endpoint: '/time_series',
              purpose: req.purpose || 'Market Watcher Scan',
              creditsUsed: this.healthState.creditsUsed,
              creditsRemaining: this.healthState.creditsRemaining,
              httpStatus: 429,
              quotaStatus: 'QUOTA_EXHAUSTED',
              retryCount: attempt - 1,
              dedupStatus: 'FRESH_NETWORK'
            });

            return {
              isValid: false,
              candles: [],
              reason: 'MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED',
              errorType: 'QUOTA_EXHAUSTED',
              creditsUsed: this.healthState.creditsUsed,
              creditsRemaining: this.healthState.creditsRemaining
            };
          }

          const data = await response.json();

          // Check error status in body
          if (data.status === 'error') {
            if (data.code === 429 || String(data.message).includes('limit') || String(data.message).includes('credits')) {
              this.recordRequestFailure(429, data.message, response.headers);
              this.logRequest({
                watcherId: req.watcherId,
                userId: req.userId,
                symbol: display,
                timeframe: req.timeframe,
                endpoint: '/time_series',
                purpose: req.purpose || 'Market Watcher Scan',
                creditsUsed: this.healthState.creditsUsed,
                creditsRemaining: this.healthState.creditsRemaining,
                httpStatus: 429,
                quotaStatus: 'QUOTA_EXHAUSTED',
                retryCount: attempt - 1,
                dedupStatus: 'FRESH_NETWORK'
              });

              return {
                isValid: false,
                candles: [],
                reason: 'MARKET_DATA_PROVIDER_QUOTA_EXHAUSTED',
                errorType: 'QUOTA_EXHAUSTED',
                creditsUsed: this.healthState.creditsUsed,
                creditsRemaining: this.healthState.creditsRemaining
              };
            }

            if (data.code === 401 || data.code === 403) {
              this.recordRequestFailure(data.code, data.message, response.headers);
              return {
                isValid: false,
                candles: [],
                reason: 'INVALID_CREDENTIAL',
                errorType: 'INVALID_CREDENTIAL',
                creditsUsed: this.healthState.creditsUsed,
                creditsRemaining: this.healthState.creditsRemaining
              };
            }

            this.recordRequestFailure(response.status, data.message, response.headers);
            return {
              isValid: false,
              candles: [],
              reason: data.message || 'Market data error',
              creditsUsed: this.healthState.creditsUsed,
              creditsRemaining: this.healthState.creditsRemaining
            };
          }

          if (response.ok && data.status === 'ok' && data.values && data.values.length > 0) {
            this.recordRequestSuccess(response.headers);

            const candleData: Candle[] = data.values.map((v: any) => ({
              timestamp: v.datetime,
              open: parseFloat(v.open),
              high: parseFloat(v.high),
              low: parseFloat(v.low),
              close: parseFloat(v.close),
              volume: v.volume ? parseFloat(v.volume) : undefined
            })).reverse();

            const currentPrice = candleData[candleData.length - 1]?.close;

            const finalRes: MarketDataResult = {
              isValid: true,
              candles: candleData,
              currentPrice,
              fromCache: false,
              creditsUsed: this.healthState.creditsUsed,
              creditsRemaining: this.healthState.creditsRemaining
            };

            // Store in server-side cache
            this.candleCache.set(cacheKey, { timestamp: now, result: finalRes, cachedAt: now });
            if (currentPrice) {
              this.priceCache.set(canonical, { timestamp: now, price: currentPrice });
            }

            this.logRequest({
              watcherId: req.watcherId,
              userId: req.userId,
              symbol: display,
              timeframe: req.timeframe,
              endpoint: '/time_series',
              purpose: req.purpose || 'Market Watcher Scan',
              creditsUsed: this.healthState.creditsUsed,
              creditsRemaining: this.healthState.creditsRemaining,
              httpStatus: 200,
              quotaStatus: 'HEALTHY',
              retryCount: attempt - 1,
              dedupStatus: 'FRESH_NETWORK'
            });

            return finalRes;
          }

          this.recordRequestFailure(response.status, 'Unexpected provider payload', response.headers);
        } catch (err: any) {
          if (attempt >= maxRetries) {
            this.recordRequestFailure(null, err.message);
            return {
              isValid: false,
              candles: [],
              reason: err.message || 'NETWORK_TIMEOUT',
              errorType: 'NETWORK_TIMEOUT'
            };
          }
          await new Promise(resolve => setTimeout(resolve, MARKET_DATA_PROVIDER_LIMITS.baseDelayMs * Math.pow(2, attempt - 1)));
        }
      }

      return {
        isValid: false,
        candles: [],
        reason: 'MARKET_DATA_UNAVAILABLE',
        errorType: 'UNAVAILABLE'
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

// Export Authoritative Singleton Instance
export const marketDataGateway = new MarketDataGateway();
