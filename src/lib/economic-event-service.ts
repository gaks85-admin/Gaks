import { createClient } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/supabase-server.js';
import { EconomicEvent, EconomicEventProvider } from './providers/economic-calendar-provider.js';
import { FmpEconomicCalendarProvider } from './providers/fmp-economic-calendar-provider.js';
import { FinanceCalendarProvider } from './providers/finance-calendar-provider.js';

export interface EconomicEventResult {
  eventDetected: boolean;
  eventName?: string;
  currency?: string;
  impact?: 'LOW' | 'MEDIUM' | 'HIGH';
  scheduledAt?: string;
  minutesUntilEvent?: number;
  minutesSinceEvent?: number;
  tradeBlocked: boolean;
  blockReason?: string;
}

export class EconomicEventService {
  private provider: EconomicEventProvider | null = null;
  private preEventBlockMinutes = 60; // 1 hour before
  private postEventBlockMinutes = 30; // 30 minutes after
  private supabaseClient: any;

  constructor(provider?: EconomicEventProvider, supabaseClient?: any) {
    if (supabaseClient) {
      this.supabaseClient = supabaseClient;
    } else {
      // Server-side initialization check: use service role if available to bypass RLS for syncs
      const isServer = typeof process !== 'undefined' && process.env;
      const url = isServer ? (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) : null;
      const serviceKey = isServer ? process.env.SUPABASE_SERVICE_ROLE_KEY : null;

      if (isServer && url && serviceKey) {
        this.supabaseClient = createClient(url, serviceKey, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
      } else {
        this.supabaseClient = getSupabase();
      }
    }

    if (provider) {
      this.provider = provider;
    } else {
      // Use FinanceCalendarProvider by default as it is free and reliable for Gaks AI
      this.provider = new FinanceCalendarProvider();
    }
  }

  setProvider(provider: EconomicEventProvider) {
    this.provider = provider;
  }

  setWindows(preMinutes: number, postMinutes: number) {
    this.preEventBlockMinutes = preMinutes;
    this.postEventBlockMinutes = postMinutes;
  }

  /**
   * Syncs economic events from the provider to the database.
   * Typically called by a background cron job.
   */
  async syncEvents(from?: string, to?: string): Promise<void> {
    if (!this.provider) {
      console.error('EconomicEventService: No provider configured for sync.');
      return;
    }

    // Default range: last 2 days to next 7 days to keep history and upcoming events
    const now = new Date();
    const startDate = from || new Date(now.getTime() - 2 * 86400000).toISOString().split('T')[0];
    const endDate = to || new Date(now.getTime() + 7 * 86400000).toISOString().split('T')[0];

    try {
      console.log(`Syncing economic events from ${startDate} to ${endDate}...`);
      const events = await this.provider.getUpcomingEvents(startDate, endDate);
      
      if (!events || events.length === 0) {
        console.log('No events found for the specified range.');
        return;
      }

      // Prepare for upsert
      const records = events.map(e => ({
        provider_event_id: e.providerEventId,
        event_name: e.eventName,
        country: e.country,
        currency: e.currency,
        impact: e.impact,
        scheduled_at: e.scheduledAt,
        actual: e.actual?.toString() || null,
        forecast: e.forecast?.toString() || null,
        previous: e.previous?.toString() || null,
        unit: e.unit,
        status: e.status,
        updated_at: new Date().toISOString()
      }));

      // Upsert into Supabase
      // provider_event_id should have a unique constraint in the table
      // Deduplicate records in the same batch to avoid "ON CONFLICT DO UPDATE command cannot affect row a second time"
      const uniqueRecordsMap = new Map<string, any>();
      records.forEach(r => uniqueRecordsMap.set(r.provider_event_id, r));
      const uniqueRecords = Array.from(uniqueRecordsMap.values());

      const { error } = await this.supabaseClient
        .from('economic_events')
        .upsert(uniqueRecords, { onConflict: 'provider_event_id' });

      if (error) {
        throw error;
      }

      console.log(`Successfully synced ${records.length} economic events.`);
    } catch (err) {
      console.error('Error syncing economic events:', err);
    }
  }

  /**
   * Checks if there is a high-impact news event that should block trading.
   */
  async checkNewsHardPause(symbol: string): Promise<EconomicEventResult> {
    const currencies = this.extractCurrencies(symbol);
    const now = new Date();
    
    // Check window: from (now - postEventBlockMinutes) to (now + preEventBlockMinutes)
    const windowStart = new Date(now.getTime() - this.postEventBlockMinutes * 60000).toISOString();
    const windowEnd = new Date(now.getTime() + this.preEventBlockMinutes * 60000).toISOString();

    try {
      // Query database for matching events
      const { data: events, error } = await this.supabaseClient
        .from('economic_events')
        .select('*')
        .in('currency', currencies)
        .eq('impact', 'HIGH')
        .gte('scheduled_at', windowStart)
        .lte('scheduled_at', windowEnd)
        .order('scheduled_at', { ascending: true });

      if (error) {
        throw error;
      }

      if (events && events.length > 0) {
        const event = events[0];
        const scheduledAt = new Date(event.scheduled_at);
        const minutesDiff = (scheduledAt.getTime() - now.getTime()) / 60000;

        const isUpcoming = minutesDiff > 0;

        return {
          eventDetected: true,
          eventName: event.event_name,
          currency: event.currency,
          impact: event.impact as any,
          scheduledAt: event.scheduled_at,
          minutesUntilEvent: isUpcoming ? Math.round(minutesDiff) : 0,
          minutesSinceEvent: !isUpcoming ? Math.round(Math.abs(minutesDiff)) : 0,
          tradeBlocked: true,
          blockReason: isUpcoming 
            ? `NEWS_HARD_PAUSE: HIGH impact event ${event.event_name} in ${Math.round(minutesDiff)} minutes`
            : `NEWS_HARD_PAUSE: HIGH impact event ${event.event_name} released ${Math.round(Math.abs(minutesDiff))} minutes ago`
        };
      }
    } catch (err) {
      console.error(`Error checking economic events for ${symbol}:`, err);
      // Fail-closed approach: if we can't verify news, we might want to block if we are cautious
      // But if the DB is just down, we might not want to kill the whole system.
      // However, the original requirement was fail-closed.
      return { 
        eventDetected: false, 
        tradeBlocked: true, 
        blockReason: `NEWS_GATE_ERROR: Failed to verify economic news for ${symbol}.` 
      };
    }

    return { eventDetected: false, tradeBlocked: false };
  }

  private extractCurrencies(symbol: string): string[] {
    // Standardize symbol e.g. BTCUSD -> BTC, USD or EUR/USD -> EUR, USD
    const normalized = symbol.replace(/[^A-Z]/g, '');
    if (normalized.length === 6) {
      return [normalized.substring(0, 3), normalized.substring(3, 6)];
    }
    
    // Handle specific pairs like US30, GER30, etc.
    if (normalized.startsWith('US')) return ['USD'];
    if (normalized.startsWith('GER') || normalized.startsWith('DE')) return ['EUR'];
    if (normalized.startsWith('UK')) return ['GBP'];
    if (normalized.startsWith('JPY')) return ['JPY'];

    // Handle crypto
    if (normalized.includes('BTC') || normalized.includes('ETH') || normalized.includes('SOL')) {
      return ['USD']; // Macro policy for crypto
    }
    
    return [normalized];
  }
}

export const defaultEconomicEventService = new EconomicEventService();
