import { Candle } from "./strategy-engine.js";
import {
  marketDataGateway,
  MarketDataRequest as GatewayRequest,
  MarketDataResult as GatewayResult,
  GatewayHealthState,
  MARKET_DATA_PROVIDER_LIMITS,
  toCanonicalSymbol,
  toDisplaySymbol,
  mapTimeframeToInterval
} from "./market-data-gateway.js";

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

export function getMarketDataStats() {
  const health = marketDataGateway.getHealth();
  return {
    requests: health.totalRequests,
    cacheHits: health.cacheHits,
    requestsSaved: health.requestsSaved,
    rateLimitEvents: health.quotaBlockedRequests,
    creditsUsed: health.creditsUsed,
    creditsRemaining: health.creditsRemaining,
    currentMinuteUsage: health.currentMinuteUsage,
    dailyUsage: health.dailyUsage,
    status: health.status
  };
}

/**
 * Calculates optimal historical candle count for market structure analysis based on timeframe.
 * Provides substantial historical context (100–200 candles) for technical structure, swing levels,
 * trendlines, support/resistance, liquidity pools, and FVGs while keeping execution decisions
 * based on the latest closed candle.
 */
export function getRequiredCandleCountForTimeframe(timeframe?: string): number {
  if (!timeframe) return 120;
  const tf = timeframe.toUpperCase().trim();
  if (tf === 'M1' || tf === '1M' || tf === 'M5' || tf === '5M' || tf === '5') {
    return 150; // M5: 100-200 range
  }
  if (tf === 'M15' || tf === '15M' || tf === '15' || tf === 'M30' || tf === '30M' || tf === '30') {
    return 120; // M15: 100-150 range
  }
  if (tf === 'H1' || tf === '1H' || tf === '1' || tf === 'H4' || tf === '4H' || tf === '4') {
    return 120; // H1: 100-150 range
  }
  if (tf === 'D1' || tf === '1D' || tf === 'D') {
    return 100;
  }
  return 120;
}

export class TwelveDataProvider implements MarketDataProvider {
  private id: string;
  private apiKey: string;

  constructor(id: string, apiKey: string) {
    this.id = id;
    this.apiKey = apiKey;
  }

  getName() { return "Twelve Data"; }
  getId() { return this.id; }

  getHealth(): ProviderHealth {
    const gh = marketDataGateway.getHealth();
    let mappedStatus: ProviderStatus = 'HEALTHY';
    if (gh.status === 'QUOTA_EXHAUSTED' || gh.status === 'LIMITED') {
      mappedStatus = 'RATE_LIMITED';
    } else if (gh.status === 'INVALID_CREDENTIAL') {
      mappedStatus = 'INVALID_CREDENTIAL';
    } else if (gh.status === 'UNAVAILABLE') {
      mappedStatus = 'UNAVAILABLE';
    }

    return {
      status: mappedStatus,
      lastSuccessfulRequest: gh.lastSuccessfulRequest,
      lastFailure: gh.lastFailure,
      failureCount: gh.quotaBlockedRequests + gh.consecutiveFailures,
      lastHttpStatus: gh.lastHttpStatus,
      cooldownUntil: gh.cooldownUntil,
      creditsUsed: gh.creditsUsed,
      creditsRemaining: gh.creditsRemaining,
      consecutiveFailures: gh.consecutiveFailures
    };
  }

  resetHealth(): void {
    marketDataGateway.resetHealth();
  }

  async validateSymbol(symbol: string): Promise<{ isValid: boolean; matchedSymbol?: string; instrumentType?: string; reason?: string }> {
    return marketDataGateway.validateSymbol(symbol, this.apiKey);
  }

  async fetchCurrentPrice(symbol: string): Promise<number | null> {
    return marketDataGateway.fetchCurrentPrice(symbol, this.apiKey);
  }

  async fetchMarketData(req: MarketDataRequest): Promise<MarketDataResult> {
    return marketDataGateway.getMarketData(req, this.apiKey);
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

  public async validateSymbol(symbol: string, fallbackApiKey?: string): Promise<{ isValid: boolean; matchedSymbol?: string; instrumentType?: string; reason?: string }> {
    return marketDataGateway.validateSymbol(symbol, fallbackApiKey);
  }

  public async fetchCurrentPrice(symbol: string, fallbackApiKey?: string): Promise<number | null> {
    return marketDataGateway.fetchCurrentPrice(symbol, fallbackApiKey);
  }

  public async getMarketData(req: MarketDataRequest, fallbackApiKey?: string): Promise<MarketDataResult> {
    return marketDataGateway.getMarketData(req, fallbackApiKey);
  }
}

export const defaultMarketDataService = new MarketDataService();
