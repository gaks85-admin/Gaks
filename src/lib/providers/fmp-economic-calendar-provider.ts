import { EconomicEvent, EconomicEventProvider, EconomicEventImpact, EconomicEventStatus } from './economic-calendar-provider';
import { getCurrencyForCountry } from '../utils/currency-mapping';

interface FmpEconomicEvent {
  event: string;
  date: string;
  country: string;
  actual: number | null;
  previous: number | null;
  forecast: number | null;
  change: number | null;
  changePercentage: number | null;
  impact: string; // e.g. "High", "Medium", "Low"
}

export class FmpEconomicCalendarProvider implements EconomicEventProvider {
  private readonly apiKey: string;
  private readonly baseUrl = 'https://financialmodelingprep.com/stable';

  constructor() {
    // Read API key from environment variable (Server-side only)
    const key = process.env.FMP_API_KEY;
    if (!key) {
      console.warn('FMP_API_KEY not found in environment variables. FMP provider will not function correctly.');
    }
    this.apiKey = key || '';
  }

  async getUpcomingEvents(from: string, to: string): Promise<EconomicEvent[]> {
    return this.fetchEvents(from, to);
  }

  async getRecentEvents(from: string, to: string): Promise<EconomicEvent[]> {
    return this.fetchEvents(from, to);
  }

  private async fetchEvents(from: string, to: string): Promise<EconomicEvent[]> {
    if (!this.apiKey) {
      return [];
    }

    try {
      const url = `${this.baseUrl}/economic-calendar?from=${from}&to=${to}&apikey=${this.apiKey}`;
      const response = await fetch(url);

      if (!response.ok) {
        if (response.status === 402) {
          console.error('FMP API error: 402 Payment Required. Your FMP subscription does not include the Economic Calendar.');
          return [];
        }
        throw new Error(`FMP API error: ${response.status} ${response.statusText}`);
      }

      const data: FmpEconomicEvent[] = await response.json();
      return data.map(event => this.normalizeEvent(event));
    } catch (error) {
      console.error('Error fetching economic events from FMP:', error);
      return [];
    }
  }

  private normalizeEvent(fmpEvent: FmpEconomicEvent): EconomicEvent {
    const scheduledAt = fmpEvent.date.includes(' ') 
      ? fmpEvent.date.replace(' ', 'T') + 'Z' // Assume UTC if no offset
      : fmpEvent.date;

    const currency = getCurrencyForCountry(fmpEvent.country);
    
    // Determine status based on presence of actual value or time comparison
    const now = new Date();
    const eventTime = new Date(scheduledAt);
    const isPast = eventTime < now;
    const hasActual = fmpEvent.actual !== null && fmpEvent.actual !== undefined;
    const status: EconomicEventStatus = (isPast || hasActual) ? 'RELEASED' : 'UPCOMING';

    // Map impact string to enum
    let impact: EconomicEventImpact = 'LOW';
    const rawImpact = fmpEvent.impact.toUpperCase();
    if (rawImpact.includes('HIGH')) impact = 'HIGH';
    else if (rawImpact.includes('MEDIUM')) impact = 'MEDIUM';

    // Generate a consistent provider ID since FMP doesn't provide one
    // Hashing event name, date, and country
    const providerEventId = btoa(`${fmpEvent.event}-${fmpEvent.date}-${fmpEvent.country}`).substring(0, 32);

    return {
      providerEventId,
      eventName: fmpEvent.event,
      country: fmpEvent.country,
      currency,
      impact,
      scheduledAt,
      actual: fmpEvent.actual,
      forecast: fmpEvent.forecast,
      previous: fmpEvent.previous,
      unit: null, // FMP doesn't provide a clean unit field in this endpoint
      status
    };
  }
}
