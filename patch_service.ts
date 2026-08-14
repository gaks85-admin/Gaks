import fs from 'fs';

const content = `import { Candle } from "./strategy-engine.js";

export interface MarketDataRequest {
  symbol: string;
  timeframe: string;
  requiredCount: number;
}

export interface MarketDataResult {
  isValid: boolean;
  candles: Candle[];
  reason?: string;
  currentPrice?: number;
}

export type ProviderStatus = 'HEALTHY' | 'DEGRADED' | 'RATE_LIMITED' | 'UNAVAILABLE' | 'INVALID_CREDENTIAL' | 'DISABLED';

export interface ProviderHealth {
  status: ProviderStatus;
  lastSuccessfulRequest: number | null;
  lastFailure: number | null;
  failureCount: number;
  lastHttpStatus: number | null;
  cooldownUntil: number | null;
  creditsUsed: number | null;
  creditsRemaining: number | null;
  consecutiveFailures: number;
}

export interface MarketDataProvider {
  getName(): string;
  getId(): string;
  getHealth(): ProviderHealth;
  fetchMarketData(req: MarketDataRequest): Promise<MarketDataResult>;
  validateSymbol(symbol: string): Promise<{ isValid: boolean; matchedSymbol?: string; instrumentType?: string; reason?: string }>;
  fetchCurrentPrice(symbol: string): Promise<number | null>;
  resetHealth(): void;
}

// Map standard timeframes to Twelve Data intervals
function mapTimeframeToInterval(timeframe: string): string {
  const mapping: Record<string, string> = {
    'M1': '1min', 'M5': '5min', 'M15': '15min', 'M30': '30min',
    'H1': '1h', 'H2': '2h', 'H4': '4h',
    'D1': '1day', 'W1': '1week', 'MN1': '1month'
  };
  return mapping[timeframe] || '1h';
}

function toCanonicalSymbol(symbol: string): string {
  return symbol.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function toDisplaySymbol(symbol: string): string {
  const upper = toCanonicalSymbol(symbol);
  if (upper.length === 6 && !upper.includes('/')) {
    return \`\${upper.slice(0, 3)}/\${upper.slice(3)}\`;
  }
  return upper;
}

const GLOBAL_STATS = {
  requests: 0,
  cacheHits: 0,
  rateLimitEvents: 0
};
export function getMarketDataStats() { return GLOBAL_STATS; }

// Normalized Module-Level Caches (Provider Agnostic)
const marketDataCache = new Map<string, { timestamp: number, result: MarketDataResult }>();
const priceCache = new Map<string, { timestamp: number, price: number }>();
const symbolValidationCache = new Map<string, { isValid: boolean; matchedSymbol?: string; instrumentType?: string; reason?: string }>();

const inFlightRequests = new Map<string, Promise<MarketDataResult>>();
const inFlightValidations = new Map<string, Promise<{ isValid: boolean; matchedSymbol?: string; instrumentType?: string; reason?: string }>>();
const inFlightPrices = new Map<string, Promise<number | null>>();

export class TwelveDataProvider implements MarketDataProvider {
  private id: string;
  private apiKey: string;
  private health: ProviderHealth;

  constructor(id: string, apiKey: string) {
    this.id = id;
    this.apiKey = apiKey;
    this.health = {
      status: 'HEALTHY',
      lastSuccessfulRequest: null,
      lastFailure: null,
      failureCount: 0,
      lastHttpStatus: null,
      cooldownUntil: null,
      creditsUsed: null,
      creditsRemaining: null,
      consecutiveFailures: 0
    };
  }

  getName() { return "Twelve Data"; }
  getId() { return this.id; }
  getHealth() { return this.health; }
  
  resetHealth() {
    this.health.status = 'HEALTHY';
    this.health.cooldownUntil = null;
    this.health.consecutiveFailures = 0;
  }

  private handleHeaders(headers: Headers) {
    const used = headers.get('api-credits-used');
    const left = headers.get('api-credits-left');
    if (used) this.health.creditsUsed = parseInt(used, 10);
    if (left) this.health.creditsRemaining = parseInt(left, 10);
  }

  private markSuccess(headers: Headers) {
    this.health.status = 'HEALTHY';
    this.health.lastSuccessfulRequest = Date.now();
    this.health.consecutiveFailures = 0;
    this.handleHeaders(headers);
  }

  private markFailure(status: number | null, reason: string, headers?: Headers) {
    this.health.lastFailure = Date.now();
    this.health.failureCount++;
    this.health.consecutiveFailures++;
    this.health.lastHttpStatus = status;
    if (headers) this.handleHeaders(headers);

    if (status === 429 || reason.includes('429') || reason.includes('limit') || reason.includes('RATE_LIMITED')) {
        this.health.status = 'RATE_LIMITED';
        this.health.cooldownUntil = Date.now() + 60000;
        GLOBAL_STATS.rateLimitEvents++;
    } else if (status === 401 || status === 403 || reason.includes('apikey')) {
        this.health.status = 'INVALID_CREDENTIAL';
    } else if (status === 404 || reason.includes('not found') || reason.includes('Invalid symbol')) {
        this.health.status = 'HEALTHY'; // Symbol invalid, but provider is fine
    } else if (status && status >= 500) {
        this.health.status = 'UNAVAILABLE';
    } else {
        this.health.status = 'DEGRADED';
    }
  }

  private async fetchApi(url: string, maxRetries = 2, baseDelayMs = 500): Promise<{ response: Response, data: any } | null> {
    let attempt = 0;
    while (attempt < maxRetries) {
      attempt++;
      GLOBAL_STATS.requests++;
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(6000) });
        if (response.status === 429) {
          this.markFailure(429, 'Rate limit', response.headers);
          throw new Error("MARKET_DATA_RATE_LIMITED");
        }
        const data = await response.json();
        
        if (data.status === "error") {
          if (data.code === 429 || String(data.message).includes('limit')) {
            this.markFailure(429, 'Rate limit', response.headers);
            throw new Error("MARKET_DATA_RATE_LIMITED");
          }
          if (data.code === 401) {
            this.markFailure(401, data.message, response.headers);
            throw new Error("INVALID_CREDENTIAL");
          }
          this.markFailure(response.status, data.message, response.headers);
          return { response, data };
        }
        
        if (response.ok) {
          this.markSuccess(response.headers);
          return { response, data };
        }
        
        this.markFailure(response.status, 'HTTP Error', response.headers);
        if (response.status === 404 || response.status === 400) return { response, data };

      } catch (err: any) {
        if (err.message === "MARKET_DATA_RATE_LIMITED" || err.message === "INVALID_CREDENTIAL") {
          throw err;
        }
        if (attempt >= maxRetries) {
          this.markFailure(null, err.message);
          throw err;
        }
      }
      await new Promise(resolve => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1)));
    }
    return null;
  }

  async validateSymbol(symbol: string) {
    if (this.health.status === 'RATE_LIMITED' && (this.health.cooldownUntil || 0) > Date.now()) {
      return { isValid: false, reason: "MARKET_DATA_RATE_LIMITED" };
    }
    
    const searchUrl = \`https://api.twelvedata.com/symbol_search?symbol=\${encodeURIComponent(symbol)}&apikey=\${this.apiKey}\`;
    try {
      const res = await this.fetchApi(searchUrl);
      if (!res) return { isValid: false, reason: "NETWORK_TIMEOUT" };
      const { data } = res;
      
      if (data.status === "error") {
        return { isValid: false, reason: data.message };
      }
      
      if (data.data && data.data.length > 0) {
        const symbolUpper = toCanonicalSymbol(symbol);
        const exactMatch = data.data.find((item: any) => toCanonicalSymbol(item.symbol) === symbolUpper);
        const match = exactMatch || data.data[0];
        return { isValid: true, matchedSymbol: match.symbol, instrumentType: match.instrument_type };
      }
      return { isValid: false, reason: "Symbol not found on Twelve Data." };
    } catch (err: any) {
      return { isValid: false, reason: err.message };
    }
  }

  async fetchCurrentPrice(symbol: string) {
    if (this.health.status === 'RATE_LIMITED' && (this.health.cooldownUntil || 0) > Date.now()) {
      throw new Error("MARKET_DATA_RATE_LIMITED");
    }
    const finalSymbol = toDisplaySymbol(symbol);
    const priceUrl = \`https://api.twelvedata.com/price?symbol=\${encodeURIComponent(finalSymbol)}&apikey=\${this.apiKey}\`;
    try {
      const res = await this.fetchApi(priceUrl);
      if (res && res.data && res.data.price) {
        const parsed = parseFloat(String(res.data.price));
        if (!isNaN(parsed) && parsed > 0) return parsed;
      }
    } catch (err: any) {
      if (err.message === "MARKET_DATA_RATE_LIMITED") throw err;
    }
    return null;
  }

  async fetchMarketData(req: MarketDataRequest) {
    if (this.health.status === 'RATE_LIMITED' && (this.health.cooldownUntil || 0) > Date.now()) {
      return { isValid: false, candles: [], reason: "MARKET_DATA_RATE_LIMITED" };
    }
    const interval = mapTimeframeToInterval(req.timeframe);
    const finalSymbol = toDisplaySymbol(req.symbol);
    const timeSeriesUrl = \`https://api.twelvedata.com/time_series?symbol=\${encodeURIComponent(finalSymbol)}&interval=\${interval}&outputsize=\${req.requiredCount}&timezone=UTC&apikey=\${this.apiKey}\`;
    
    try {
      const res = await this.fetchApi(timeSeriesUrl);
      if (!res) return { isValid: false, candles: [], reason: "NETWORK_TIMEOUT" };
      const { data } = res;
      
      if (data.status === "error") {
        return { isValid: false, candles: [], reason: data.message };
      }
      if (data.status === "ok" && data.values && data.values.length > 0) {
        const candleData: Candle[] = data.values.map((v: any) => ({
          timestamp: v.datetime,
          open: parseFloat(v.open),
          high: parseFloat(v.high),
          low: parseFloat(v.low),
          close: parseFloat(v.close),
          volume: v.volume ? parseFloat(v.volume) : undefined
        })).reverse();
        
        return { isValid: true, candles: candleData, currentPrice: candleData[candleData.length - 1].close };
      }
      return { isValid: false, candles: [], reason: "Empty values array from provider." };
    } catch (err: any) {
      return { isValid: false, candles: [], reason: err.message };
    }
  }
}

export class MarketDataService {
  private providers: MarketDataProvider[] = [];

  constructor() {
    this.configureProviders();
  }

  private configureProviders() {
    const primaryKey = process.env.TWELVE_DATA_API_KEY_PRIMARY || process.env.TWELVE_DATA_API_KEY;
    if (primaryKey) {
      this.providers.push(new TwelveDataProvider('twelve_data_primary', primaryKey));
    }
    const secondaryKey = process.env.TWELVE_DATA_API_KEY_SECONDARY;
    if (secondaryKey) {
      this.providers.push(new TwelveDataProvider('twelve_data_secondary', secondaryKey));
    }
  }
  
  public getProviders() {
      return this.providers;
  }

  private isProviderSkipped(provider: MarketDataProvider): boolean {
    const health = provider.getHealth();
    if (health.status === 'RATE_LIMITED' && (health.cooldownUntil || 0) > Date.now()) return true;
    if (health.status === 'INVALID_CREDENTIAL' || health.status === 'DISABLED') return true;
    return false;
  }

  private async executeWithFailover<T>(
    operationName: string,
    operation: (provider: MarketDataProvider) => Promise<T>,
    isValidResult: (res: T) => boolean,
    isTemporaryError: (res: T, err?: any) => boolean
  ): Promise<T | null> {
    for (let i = 0; i < this.providers.length; i++) {
      const provider = this.providers[i];
      if (this.isProviderSkipped(provider)) continue;

      try {
        console.log(\`[DATA PROVIDER] Request: \${operationName} Provider: \${provider.getId()}\`);
        const result = await operation(provider);
        
        if (isValidResult(result)) {
          console.log(\`[DATA PROVIDER] Request: \${operationName} Provider: \${provider.getId()} Status: SUCCESS\`);
          return result;
        } else if (!isTemporaryError(result)) {
          // Hard error (like invalid symbol)
          return result;
        } else {
          console.log(\`[DATA PROVIDER] Request: \${operationName} Provider: \${provider.getId()} Status: TEMPORARY_ERROR\`);
          if (i < this.providers.length - 1) {
             console.log(\`[DATA FAILOVER] Primary: \${provider.getId()} Status: UNAVAILABLE Secondary: \${this.providers[i+1].getId()} Decision: FAILOVER_ALLOWED\`);
          } else {
             console.log(\`[DATA FAILOVER] Primary: \${provider.getId()} Status: UNAVAILABLE Secondary: unavailable Decision: DEFER\`);
          }
          continue;
        }
      } catch (err: any) {
        console.warn(\`[DATA PROVIDER] Error: \${err.message}\`);
        if (!isTemporaryError({} as T, err)) {
            throw err;
        }
        continue;
      }
    }
    return null;
  }

  async validateSymbol(symbol: string, fallbackApiKey?: string) {
    if (this.providers.length === 0 && fallbackApiKey) {
       this.providers.push(new TwelveDataProvider('fallback_provider', fallbackApiKey));
    }
    
    if (symbolValidationCache.has(symbol)) {
      GLOBAL_STATS.cacheHits++;
      return symbolValidationCache.get(symbol)!;
    }

    const inFlightKey = \`val_\${symbol}\`;
    if (inFlightValidations.has(inFlightKey)) {
      GLOBAL_STATS.cacheHits++;
      return inFlightValidations.get(inFlightKey)!;
    }

    const promise = (async () => {
      const result = await this.executeWithFailover(
        \`validateSymbol \${symbol}\`,
        p => p.validateSymbol(symbol),
        res => res.isValid,
        (res, err) => {
           if (err && err.message === 'MARKET_DATA_RATE_LIMITED') return true;
           if (res && res.reason && (res.reason.includes('RATE_LIMITED') || res.reason.includes('NETWORK_TIMEOUT') || res.reason.includes('UNAVAILABLE'))) return true;
           return false;
        }
      );
      const finalRes = result || { isValid: false, reason: "MARKET_DATA_UNAVAILABLE" };
      if (finalRes.isValid) {
          symbolValidationCache.set(symbol, finalRes);
      } else if (!finalRes.reason?.includes("RATE_LIMITED") && !finalRes.reason?.includes("UNAVAILABLE")) {
          // Cache non-temporary invalid symbol errors
          symbolValidationCache.set(symbol, finalRes);
      }
      return finalRes;
    })();

    inFlightValidations.set(inFlightKey, promise);
    try {
      return await promise;
    } finally {
      inFlightValidations.delete(inFlightKey);
    }
  }

  async fetchCurrentPrice(symbol: string, fallbackApiKey?: string): Promise<number | null> {
    if (this.providers.length === 0 && fallbackApiKey) {
       this.providers.push(new TwelveDataProvider('fallback_provider', fallbackApiKey));
    }

    const finalSymbol = toDisplaySymbol(symbol);
    const cached = priceCache.get(finalSymbol);
    if (cached && (Date.now() - cached.timestamp < 30000)) {
      GLOBAL_STATS.cacheHits++;
      return cached.price;
    }

    if (inFlightPrices.has(finalSymbol)) {
      GLOBAL_STATS.cacheHits++;
      return inFlightPrices.get(finalSymbol)!;
    }

    const promise = (async () => {
      const result = await this.executeWithFailover(
        \`fetchCurrentPrice \${symbol}\`,
        p => p.fetchCurrentPrice(symbol),
        res => res !== null,
        (res, err) => {
           if (err && err.message === 'MARKET_DATA_RATE_LIMITED') return true;
           return res === null;
        }
      );
      if (result !== null) {
          priceCache.set(finalSymbol, { timestamp: Date.now(), price: result });
      }
      return result;
    })();

    inFlightPrices.set(finalSymbol, promise);
    try {
      return await promise;
    } finally {
      inFlightPrices.delete(finalSymbol);
    }
  }

  async getMarketData(req: MarketDataRequest, fallbackApiKey?: string): Promise<MarketDataResult> {
    if (this.providers.length === 0 && fallbackApiKey) {
       this.providers.push(new TwelveDataProvider('fallback_provider', fallbackApiKey));
    }

    const interval = mapTimeframeToInterval(req.timeframe);
    const finalSymbol = toDisplaySymbol(req.symbol);
    const cacheKey = \`\${finalSymbol}_\${interval}_\${req.requiredCount}\`;

    const cached = marketDataCache.get(cacheKey);
    if (cached && (Date.now() - cached.timestamp < 45000)) {
      GLOBAL_STATS.cacheHits++;
      return cached.result;
    }

    if (inFlightRequests.has(cacheKey)) {
      GLOBAL_STATS.cacheHits++;
      return inFlightRequests.get(cacheKey)!;
    }

    const promise = (async (): Promise<MarketDataResult> => {
      const result = await this.executeWithFailover(
        \`time_series \${req.symbol} \${req.timeframe}\`,
        p => p.fetchMarketData(req),
        res => res.isValid,
        (res, err) => {
           if (err && err.message === 'MARKET_DATA_RATE_LIMITED') return true;
           if (res && res.reason && (res.reason.includes('RATE_LIMITED') || res.reason.includes('NETWORK_TIMEOUT') || res.reason.includes('UNAVAILABLE'))) return true;
           return false;
        }
      );
      
      const finalRes = result || { isValid: false, candles: [], reason: "MARKET_DATA_UNAVAILABLE" };
      if (finalRes.isValid) {
          marketDataCache.set(cacheKey, { timestamp: Date.now(), result: finalRes });
          if (finalRes.currentPrice) {
              priceCache.set(finalSymbol, { timestamp: Date.now(), price: finalRes.currentPrice });
          }
      }
      return finalRes;
    })();

    inFlightRequests.set(cacheKey, promise);
    try {
      return await promise;
    } finally {
      inFlightRequests.delete(cacheKey);
    }
  }

}

export const defaultMarketDataService = new MarketDataService();
`

fs.writeFileSync('src/lib/market-data-service.ts', content);
