import { EconomicEvent, EconomicEventProvider, EconomicEventImpact, EconomicEventStatus } from './economic-calendar-provider';
import { getCurrencyForCountry } from '../utils/currency-mapping';

interface FinanceCalendarEvent {
  name: string;
  date: string;
  time_utc: string; // e.g. "12:30"
  impact: string; // e.g. "High", "Medium", "Low"
  consensus: string | null;
  prior: string | null;
  actual: string | null;
  url: string;
  category: string;
}

interface FinanceCalendarResponse {
  from: string;
  to: string;
  count: number;
  events: FinanceCalendarEvent[];
}

export class FinanceCalendarProvider implements EconomicEventProvider {
  private readonly baseUrl = 'https://www.financecalendar.com/wp-json/fc/v1';

  async getUpcomingEvents(from: string, to: string): Promise<EconomicEvent[]> {
    return this.fetchEvents(from, to);
  }

  async getRecentEvents(from: string, to: string): Promise<EconomicEvent[]> {
    return this.fetchEvents(from, to);
  }

  private async fetchEvents(from: string, to: string): Promise<EconomicEvent[]> {
    try {
      const url = `${this.baseUrl}/calendar?from=${from}&to=${to}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`Finance Calendar API error: ${response.status} ${response.statusText}`);
      }

      const data: FinanceCalendarResponse = await response.json();
      if (!data || !Array.isArray(data.events)) {
        console.warn('Finance Calendar API returned unexpected data structure:', data);
        return [];
      }
      return data.events.map(event => this.normalizeEvent(event));
    } catch (error) {
      console.error('Error fetching economic events from Finance Calendar:', error);
      return [];
    }
  }

  private normalizeEvent(fcEvent: FinanceCalendarEvent): EconomicEvent {
    // Fallback logic for scheduledAt: prefer time_utc, then date at 00:00, then now
    let scheduledAt = fcEvent.time_utc;
    if (!scheduledAt || scheduledAt === '') {
      if (fcEvent.date) {
        scheduledAt = `${fcEvent.date}T00:00:00Z`;
      } else {
        scheduledAt = new Date().toISOString();
      }
    }

    // Extract country and currency from name
    const { country, currency } = this.parseCountryAndCurrency(fcEvent.name);

    // Map impact
    let impact: EconomicEventImpact = 'LOW';
    const rawImpact = fcEvent.impact.toUpperCase();
    if (rawImpact.includes('HIGH')) impact = 'HIGH';
    else if (rawImpact.includes('MEDIUM')) impact = 'MEDIUM';

    // Status
    const now = new Date();
    const eventTime = new Date(scheduledAt);
    const isPast = eventTime < now;
    const hasActual = fcEvent.actual !== null && fcEvent.actual !== undefined && fcEvent.actual !== '';
    const status: EconomicEventStatus = (isPast || hasActual) ? 'RELEASED' : 'UPCOMING';

    // ID
    const providerEventId = btoa(`${fcEvent.name}-${scheduledAt}`).substring(0, 32);

    return {
      providerEventId,
      eventName: fcEvent.name,
      country,
      currency,
      impact,
      scheduledAt,
      actual: fcEvent.actual,
      forecast: fcEvent.consensus,
      previous: fcEvent.prior,
      unit: null,
      status
    };
  }

  private parseCountryAndCurrency(name: string): { country: string | null; currency: string | null } {
    const n = name.toUpperCase();
    
    // Common mappings based on observation
    if (n.includes('US ') || n.includes('USA ') || n.includes('UNITED STATES')) return { country: 'United States', currency: 'USD' };
    if (n.includes('UK ') || n.includes('UNITED KINGDOM') || n.includes('BRITAIN')) return { country: 'United Kingdom', currency: 'GBP' };
    if (n.includes('EUROZONE') || n.includes('EURO AREA') || n.includes('GERMANY') || n.includes('FRANCE')) return { country: 'Eurozone', currency: 'EUR' };
    if (n.includes('AUSTRALIA')) return { country: 'Australia', currency: 'AUD' };
    if (n.includes('CANADA')) return { country: 'Canada', currency: 'CAD' };
    if (n.includes('JAPAN')) return { country: 'Japan', currency: 'JPY' };
    if (n.includes('SWITZERLAND')) return { country: 'Switzerland', currency: 'CHF' };
    if (n.includes('NEW ZEALAND')) return { country: 'New Zealand', currency: 'NZD' };
    if (n.includes('CHINA')) return { country: 'China', currency: 'CNY' };

    // Try to find by prefix
    const countries = [
      { name: 'US', country: 'United States', currency: 'USD' },
      { name: 'UK', country: 'United Kingdom', currency: 'GBP' },
      { name: 'AUSTRALIA', country: 'Australia', currency: 'AUD' },
      { name: 'CANADA', country: 'Canada', currency: 'CAD' },
      { name: 'JAPAN', country: 'Japan', currency: 'JPY' },
      { name: 'EURO', country: 'Eurozone', currency: 'EUR' },
      { name: 'SWISS', country: 'Switzerland', currency: 'CHF' },
      { name: 'NZ', country: 'New Zealand', currency: 'NZD' },
    ];

    for (const c of countries) {
      if (n.startsWith(c.name)) return { country: c.country, currency: c.currency };
    }

    return { country: null, currency: null };
  }
}
