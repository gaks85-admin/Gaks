import { createClient } from '@supabase/supabase-js';
import { getSupabase } from '../../lib/supabase-server.js';
import { FinanceCalendarProvider } from './providers/finance-calendar-provider.js';
export class EconomicEventService {
    provider = null;
    preEventBlockMinutes = 60;
    postEventBlockMinutes = 30;
    supabaseClient;
    constructor(provider, supabaseClient) {
        if (supabaseClient) {
            this.supabaseClient = supabaseClient;
        }
        else {
            const isServer = typeof process !== 'undefined' && process.env;
            const url = isServer ? (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL) : null;
            const serviceKey = isServer ? process.env.SUPABASE_SERVICE_ROLE_KEY : null;
            if (isServer && url && serviceKey) {
                this.supabaseClient = createClient(url, serviceKey, {
                    auth: { persistSession: false, autoRefreshToken: false }
                });
            }
            else {
                this.supabaseClient = getSupabase();
            }
        }
        if (provider) {
            this.provider = provider;
        }
        else {
            this.provider = new FinanceCalendarProvider();
        }
    }
    setProvider(provider) {
        this.provider = provider;
    }
    setWindows(preMinutes, postMinutes) {
        this.preEventBlockMinutes = preMinutes;
        this.postEventBlockMinutes = postMinutes;
    }
    async syncEvents(from, to) {
        if (!this.provider) {
            console.error('EconomicEventService: No provider configured for sync.');
            return;
        }
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
            const uniqueRecordsMap = new Map();
            records.forEach(r => uniqueRecordsMap.set(r.provider_event_id, r));
            const uniqueRecords = Array.from(uniqueRecordsMap.values());
            const { error } = await this.supabaseClient
                .from('economic_events')
                .upsert(uniqueRecords, { onConflict: 'provider_event_id' });
            if (error) {
                throw error;
            }
            console.log(`Successfully synced ${records.length} economic events.`);
        }
        catch (err) {
            console.error('Error syncing economic events:', err);
        }
    }
    async checkNewsHardPause(symbol, preMinutes, postMinutes, nowOverride) {
        const pre = preMinutes !== undefined ? preMinutes : this.preEventBlockMinutes;
        const post = postMinutes !== undefined ? postMinutes : this.postEventBlockMinutes;
        const currencies = this.extractCurrencies(symbol);
        const now = nowOverride || new Date();
        const windowStart = new Date(now.getTime() - post * 60000).toISOString();
        const windowEnd = new Date(now.getTime() + pre * 60000).toISOString();
        try {
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
                    impact: event.impact,
                    scheduledAt: event.scheduled_at,
                    minutesUntilEvent: isUpcoming ? Math.round(minutesDiff) : 0,
                    minutesSinceEvent: !isUpcoming ? Math.round(Math.abs(minutesDiff)) : 0,
                    tradeBlocked: true,
                    blockReason: isUpcoming
                        ? `NEWS_HARD_PAUSE: HIGH impact event ${event.event_name} in ${Math.round(minutesDiff)} minutes`
                        : `NEWS_HARD_PAUSE: HIGH impact event ${event.event_name} released ${Math.round(Math.abs(minutesDiff))} minutes ago`
                };
            }
        }
        catch (err) {
            console.error(`Error checking economic events for ${symbol}:`, err);
            return {
                eventDetected: false,
                tradeBlocked: true,
                blockReason: `NEWS_RESTRICTION_UNAVAILABLE: Failed to verify economic news for ${symbol}.`
            };
        }
        return { eventDetected: false, tradeBlocked: false };
    }
    extractCurrencies(symbol) {
        const normalized = symbol.replace(/[^A-Z]/g, '');
        if (normalized.length === 6) {
            return [normalized.substring(0, 3), normalized.substring(3, 6)];
        }
        if (normalized.startsWith('US'))
            return ['USD'];
        if (normalized.startsWith('GER') || normalized.startsWith('DE'))
            return ['EUR'];
        if (normalized.startsWith('UK'))
            return ['GBP'];
        if (normalized.startsWith('JPY'))
            return ['JPY'];
        if (normalized.includes('BTC') || normalized.includes('ETH') || normalized.includes('SOL')) {
            return ['USD'];
        }
        return [normalized];
    }
}
export const defaultEconomicEventService = new EconomicEventService();
