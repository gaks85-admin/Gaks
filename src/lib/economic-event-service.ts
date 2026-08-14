export interface EconomicEvent {
  id: string;
  eventName: string;
  currency: string;
  impact: 'LOW' | 'MEDIUM' | 'HIGH';
  eventTime: number; // unix timestamp ms
  country?: string;
  forecast?: string;
  previous?: string;
  actual?: string;
}

export interface EconomicEventResult {
  eventDetected: boolean;
  eventName?: string;
  currency?: string;
  impact?: 'LOW' | 'MEDIUM' | 'HIGH';
  eventTime?: number;
  minutesUntilEvent?: number;
  minutesSinceEvent?: number;
  tradeBlocked: boolean;
  blockReason?: string;
}

export interface EconomicEventProvider {
  getUpcomingEvents(currency: string): Promise<EconomicEvent[]>;
}

export class EconomicEventService {
  private provider: EconomicEventProvider | null = null;
  private preEventBlockMinutes = 30;
  private postEventBlockMinutes = 15;

  constructor(provider?: EconomicEventProvider) {
    if (provider) this.provider = provider;
  }

  setProvider(provider: EconomicEventProvider) {
    this.provider = provider;
  }

  setWindows(preMinutes: number, postMinutes: number) {
    this.preEventBlockMinutes = preMinutes;
    this.postEventBlockMinutes = postMinutes;
  }

  async checkNewsHardPause(symbol: string): Promise<EconomicEventResult> {
    if (!this.provider) {
      // REQUIREMENT: Fail-closed if provider is unavailable
      return { 
        eventDetected: false, 
        tradeBlocked: true, 
        blockReason: 'NEWS_GATE_UNAVAILABLE: No economic event provider configured.' 
      };
    }

    const currencies = this.extractCurrencies(symbol);
    const now = Date.now();

    for (const currency of currencies) {
      try {
        const events = await this.provider.getUpcomingEvents(currency);
        
        for (const event of events) {
          if (event.impact !== 'HIGH') continue;

          const minutesDiff = (event.eventTime - now) / 60000;
          
          if (minutesDiff >= 0 && minutesDiff <= this.preEventBlockMinutes) {
            return {
              eventDetected: true,
              eventName: event.eventName,
              currency: event.currency,
              impact: event.impact,
              eventTime: event.eventTime,
              minutesUntilEvent: Math.round(minutesDiff),
              minutesSinceEvent: 0,
              tradeBlocked: true,
              blockReason: `NEWS_HARD_PAUSE: HIGH impact event ${event.eventName} in ${Math.round(minutesDiff)} minutes`
            };
          }

          if (minutesDiff < 0 && Math.abs(minutesDiff) <= this.postEventBlockMinutes) {
            return {
              eventDetected: true,
              eventName: event.eventName,
              currency: event.currency,
              impact: event.impact,
              eventTime: event.eventTime,
              minutesUntilEvent: 0,
              minutesSinceEvent: Math.round(Math.abs(minutesDiff)),
              tradeBlocked: true,
              blockReason: `NEWS_HARD_PAUSE: HIGH impact event ${event.eventName} released ${Math.round(Math.abs(minutesDiff))} minutes ago`
            };
          }
        }
      } catch (err) {
        console.error(`Error checking economic events for ${currency}:`, err);
        // REQUIREMENT: Fail-closed if provider fails
        return { 
          eventDetected: false, 
          tradeBlocked: true, 
          blockReason: `NEWS_GATE_ERROR: Failed to fetch economic events for ${currency}.` 
        };
      }
    }

    return { eventDetected: false, tradeBlocked: false };
  }

  private extractCurrencies(symbol: string): string[] {
    // Standardize symbol e.g. BTCUSD -> BTC, USD or EUR/USD -> EUR, USD
    const normalized = symbol.replace(/[^A-Z]/g, '');
    if (normalized.length === 6) {
      return [normalized.substring(0, 3), normalized.substring(3, 6)];
    }
    // Handle special cases or default
    if (normalized.includes('BTC') || normalized.includes('ETH')) {
      return ['USD']; // Macro policy for crypto
    }
    return [normalized];
  }
}

export const defaultEconomicEventService = new EconomicEventService();
