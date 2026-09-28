export type EconomicEventImpact = 'LOW' | 'MEDIUM' | 'HIGH';
export type EconomicEventStatus = 'UPCOMING' | 'RELEASED';

export interface EconomicEvent {
  id?: string; // UUID from database
  providerEventId: string; // ID from the provider
  eventName: string;
  country: string | null;
  currency: string | null;
  impact: EconomicEventImpact;
  scheduledAt: string; // ISO 8601 string
  actual: number | string | null;
  forecast: number | string | null;
  previous: number | string | null;
  unit: string | null;
  status: EconomicEventStatus;
  createdAt?: string;
  updatedAt?: string;
}

export interface EconomicEventProvider {
  /**
   * Retrieves upcoming economic events for a specific timeframe.
   * @param from ISO date string (YYYY-MM-DD)
   * @param to ISO date string (YYYY-MM-DD)
   */
  getUpcomingEvents(from: string, to: string): Promise<EconomicEvent[]>;

  /**
   * Retrieves recently released economic events.
   * @param from ISO date string (YYYY-MM-DD)
   * @param to ISO date string (YYYY-MM-DD)
   */
  getRecentEvents(from: string, to: string): Promise<EconomicEvent[]>;
}
