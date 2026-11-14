import {
  marketDataGateway
} from "./market-data-gateway.js";
function getMarketDataStats() {
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
function getRequiredCandleCountForTimeframe(timeframe) {
  if (!timeframe) return 120;
  const tf = timeframe.toUpperCase().trim();
  if (tf === "M1" || tf === "1M" || tf === "M5" || tf === "5M" || tf === "5") {
    return 150;
  }
  if (tf === "M15" || tf === "15M" || tf === "15" || tf === "M30" || tf === "30M" || tf === "30") {
    return 120;
  }
  if (tf === "H1" || tf === "1H" || tf === "1" || tf === "H4" || tf === "4H" || tf === "4") {
    return 120;
  }
  if (tf === "D1" || tf === "1D" || tf === "D") {
    return 100;
  }
  return 120;
}
class TwelveDataProvider {
  id;
  apiKey;
  constructor(id, apiKey) {
    this.id = id;
    this.apiKey = apiKey;
  }
  getName() {
    return "Twelve Data";
  }
  getId() {
    return this.id;
  }
  getHealth() {
    const gh = marketDataGateway.getHealth();
    let mappedStatus = "HEALTHY";
    if (gh.status === "QUOTA_EXHAUSTED" || gh.status === "LIMITED") {
      mappedStatus = "RATE_LIMITED";
    } else if (gh.status === "INVALID_CREDENTIAL") {
      mappedStatus = "INVALID_CREDENTIAL";
    } else if (gh.status === "UNAVAILABLE") {
      mappedStatus = "UNAVAILABLE";
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
  resetHealth() {
    marketDataGateway.resetHealth();
  }
  async validateSymbol(symbol) {
    return marketDataGateway.validateSymbol(symbol, this.apiKey);
  }
  async fetchCurrentPrice(symbol) {
    return marketDataGateway.fetchCurrentPrice(symbol, this.apiKey);
  }
  async fetchMarketData(req) {
    return marketDataGateway.getMarketData(req, this.apiKey);
  }
}
class MarketDataService {
  providers = [];
  constructor() {
    this.configureProviders();
  }
  configureProviders() {
    const primaryKey = process.env.TWELVE_DATA_API_KEY_PRIMARY || process.env.TWELVE_DATA_API_KEY;
    if (primaryKey) {
      this.providers.push(new TwelveDataProvider("twelve_data_primary", primaryKey));
    }
    const secondaryKey = process.env.TWELVE_DATA_API_KEY_SECONDARY;
    if (secondaryKey) {
      this.providers.push(new TwelveDataProvider("twelve_data_secondary", secondaryKey));
    }
  }
  getProviders() {
    return this.providers;
  }
  async validateSymbol(symbol, fallbackApiKey) {
    return marketDataGateway.validateSymbol(symbol, fallbackApiKey);
  }
  async fetchCurrentPrice(symbol, fallbackApiKey) {
    return marketDataGateway.fetchCurrentPrice(symbol, fallbackApiKey);
  }
  async getMarketData(req, fallbackApiKey) {
    return marketDataGateway.getMarketData(req, fallbackApiKey);
  }
}
const defaultMarketDataService = new MarketDataService();
export {
  MarketDataService,
  TwelveDataProvider,
  defaultMarketDataService,
  getMarketDataStats,
  getRequiredCandleCountForTimeframe
};
