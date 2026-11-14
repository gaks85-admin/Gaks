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
  status?: 'BLOCKED' | 'CLEAR';
  event?: string | null;
  reason?: string;
}

export class EconomicEventService {
  private provider: EconomicEventProvider | null = null;
  private preEventBlockMinutes = 60; // 1 hour before
  private postEventBlockMinutes = 30; // 30 minutes after
  private supabaseClient: any;

  constructor(providerOrClient?: EconomicEventProvider | any, supabaseClient?: any) {
    if (providerOrClient && typeof (providerOrClient as any).from === 'function' && !supabaseClient) {
      this.supabaseClient = providerOrClient;
      this.provider = new FinanceCalendarProvider();
    } else {
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

      if (providerOrClient && typeof (providerOrClient as any).getUpcomingEvents === 'function') {
        this.provider = providerOrClient;
      } else {
        // Use FinanceCalendarProvider by default as it is free and reliable for Gaks AI
        this.provider = new FinanceCalendarProvider();
      }
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
  async checkNewsHardPause(
    symbol: string,
    preMinutesOrOpts?: number | { bufferBeforeMinutes?: number; bufferAfterMinutes?: number },
    postMinutes?: number,
    nowOverride?: Date
  ): Promise<EconomicEventResult> {
    let pre = this.preEventBlockMinutes;
    let post = this.postEventBlockMinutes;

    if (typeof preMinutesOrOpts === 'object' && preMinutesOrOpts !== null) {
      if (preMinutesOrOpts.bufferBeforeMinutes !== undefined) pre = preMinutesOrOpts.bufferBeforeMinutes;
      if (preMinutesOrOpts.bufferAfterMinutes !== undefined) post = preMinutesOrOpts.bufferAfterMinutes;
    } else if (typeof preMinutesOrOpts === 'number') {
      pre = preMinutesOrOpts;
      if (postMinutes !== undefined) post = postMinutes;
    }

    const currencies = this.extractCurrencies(symbol);
    const now = nowOverride || new Date();
    
    // Check window: from (now - post) to (now + pre) in UTC ISO string
    const windowStart = new Date(now.getTime() - post * 60000).toISOString();
    const windowEnd = new Date(now.getTime() + pre * 60000).toISOString();

    try {
      const query: any = this.supabaseClient
        .from('economic_events')
        .select('*')
        .in('currency', currencies)
        .eq('impact', 'HIGH')
        .gte('scheduled_at', windowStart)
        .lte('scheduled_at', windowEnd)
        .order('scheduled_at', { ascending: true });

      const { data: events, error } = typeof query?.limit === 'function' ? await query.limit(50) : await query;

      if (error) {
        throw error;
      }

      if (events && events.length > 0) {
        const event = events[0];
        const evName = event.event_name || event.name || 'High-Impact Economic Event';
        const scheduledAt = new Date(event.scheduled_at);
        const minutesDiff = (scheduledAt.getTime() - now.getTime()) / 60000;

        const isUpcoming = minutesDiff > 0;
        const blockReason = isUpcoming 
          ? `NEWS_HARD_PAUSE: HIGH impact event ${evName} in ${Math.round(minutesDiff)} minutes`
          : `NEWS_HARD_PAUSE: HIGH impact event ${evName} released ${Math.round(Math.abs(minutesDiff))} minutes ago`;

        return {
          status: 'BLOCKED',
          event: evName,
          eventDetected: true,
          eventName: evName,
          currency: event.currency,
          impact: event.impact as any,
          scheduledAt: event.scheduled_at,
          minutesUntilEvent: isUpcoming ? Math.round(minutesDiff) : 0,
          minutesSinceEvent: !isUpcoming ? Math.round(Math.abs(minutesDiff)) : 0,
          tradeBlocked: true,
          blockReason,
          reason: blockReason
        };
      }
    } catch (err: any) {
      console.error(`Error checking economic events for ${symbol}:`, err);
      const errMsg = err?.message || 'Failed to verify economic news';
      return { 
        status: 'BLOCKED',
        event: null,
        eventDetected: false, 
        tradeBlocked: true, 
        blockReason: `NEWS_RESTRICTION_UNAVAILABLE: Failed to verify economic news for ${symbol}. ${errMsg}`,
        reason: errMsg
      };
    }

    return { 
      status: 'CLEAR',
      event: null,
      eventDetected: false, 
      tradeBlocked: false 
    };
  }

  public extractCurrencies(symbol: string): string[] {
    const clean = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

    if (clean.endsWith('USDT') || clean.endsWith('USDC') || clean.endsWith('BUSD')) {
      return ['USD'];
    }

    if (
      clean.startsWith('US30') || clean.startsWith('US100') || clean.startsWith('US500') ||
      clean.startsWith('US2000') || clean.startsWith('NAS') || clean.startsWith('NDX') ||
      clean.startsWith('SPX') || clean.startsWith('SP500') || clean.includes('DOW') ||
      clean.startsWith('USTEC') || clean.startsWith('RUT')
    ) {
      return ['USD'];
    }
    if (
      clean.startsWith('GER') || clean.startsWith('DE30') || clean.startsWith('DE40') ||
      clean.startsWith('DAX') || clean.startsWith('FRA') || clean.startsWith('CAC') ||
      clean.startsWith('EU50') || clean.startsWith('STOXX')
    ) {
      return ['EUR'];
    }
    if (clean.startsWith('UK100') || clean.startsWith('FTSE')) return ['GBP'];
    if (clean.startsWith('JP225') || clean.startsWith('NIKKEI')) return ['JPY'];
    if (clean.startsWith('HK50') || clean.startsWith('HSI')) return ['HKD'];
    if (clean.startsWith('AUS200') || clean.startsWith('ASX200')) return ['AUD'];

    const normalized = clean.replace(/[^A-Z]/g, '');
    if (
      normalized.includes('BTC') || normalized.includes('ETH') || normalized.includes('SOL') ||
      normalized.includes('XRP') || normalized.includes('LTC') || normalized.includes('ADA') ||
      normalized.includes('DOGE') || normalized.includes('BNB') || normalized.includes('AVAX') ||
      normalized.includes('DOT') || normalized.includes('LINK') || normalized.includes('MATIC') ||
      normalized.includes('UNI') || normalized.includes('NEAR') || normalized.includes('TRX') ||
      normalized.includes('ATOM') || normalized.includes('BCH') || normalized.includes('TON') ||
      normalized.includes('SUI') || normalized.includes('SHIB')
    ) {
      return ['USD'];
    }

    if (normalized.length === 6) {
      return [normalized.substring(0, 3), normalized.substring(3, 6)];
    }

    if (normalized.startsWith('US')) return ['USD'];
    if (normalized.startsWith('GER') || normalized.startsWith('DE')) return ['EUR'];
    if (normalized.startsWith('UK')) return ['GBP'];
    if (normalized.startsWith('JPY')) return ['JPY'];

    return [normalized || 'USD'];
  }
}

export const defaultEconomicEventService = new EconomicEventService();
