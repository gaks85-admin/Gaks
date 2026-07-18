import { VercelRequest, VercelResponse } from '@vercel/node';
import yahooFinance from 'yahoo-finance2';
import { createClient } from '@supabase/supabase-js';
import { toCanonicalSymbol, toDisplaySymbol, toYahooTicker } from './_lib/market-utils';

const YahooFinance = (yahooFinance as any).default || yahooFinance;
const yf = new YahooFinance();

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY || '', {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    let monitoredSymbols: string[] = [
      'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'BTCUSD', 'ETHUSD', 'NAS100', 'US30'
    ];

    // Fetch active watchers to see if we need more symbols
    try {
      const { data: watchers } = await supabase.from('watchers').select('selected_pair');
      if (watchers && watchers.length > 0) {
        const watcherPairs = watchers.map((w: any) => toCanonicalSymbol(w.selected_pair));
        monitoredSymbols = Array.from(new Set([...monitoredSymbols, ...watcherPairs]));
      }
    } catch (dbErr) {
      console.warn("[Live Rates] Could not fetch watcher symbols from DB:", dbErr);
    }

    monitoredSymbols = monitoredSymbols.map(s => toCanonicalSymbol(s));
    monitoredSymbols = Array.from(new Set(monitoredSymbols));

    const yahooSymbolMap: Record<string, string> = {};
    monitoredSymbols.forEach(s => {
      yahooSymbolMap[toYahooTicker(s)] = s;
    });
    const yahooSymbolsToFetch = Object.keys(yahooSymbolMap);

    const pairsCache: any[] = [];

    try {
      const yahooQuotes = await yf.quote(yahooSymbolsToFetch);
      const quotesArray = Array.isArray(yahooQuotes) ? yahooQuotes : [yahooQuotes];

      quotesArray.forEach((quote: any) => {
        if (!quote || !quote.symbol) return;
        const originalSymbol = yahooSymbolMap[quote.symbol];
        if (!originalSymbol) return;

        const currentPrice = quote.regularMarketPrice;
        if (currentPrice === undefined || currentPrice === null) return;

        const basePrice = quote.regularMarketPreviousClose || currentPrice;
        const change = quote.regularMarketChangePercent || 0;
        const name = quote.shortName || quote.longName || toDisplaySymbol(originalSymbol);

        pairsCache.push({
          symbol: originalSymbol,
          name,
          basePrice,
          currentPrice,
          change,
          sentiment: change > 0.05 ? 'Bullish' : (change < -0.05 ? 'Bearish' : 'Neutral'),
          history: [],
          status: 'active'
        });
      });
    } catch (yfErr: any) {
      console.error("[Live Rates] Yahoo Finance failed:", yfErr.message);
    }

    return res.status(200).json({
      success: true,
      timestamp: Date.now(),
      pairs: pairsCache
    });

  } catch (err: any) {
    console.error("[Live Rates] Fatal error:", err.message);
    return res.status(500).json({ success: false, error: 'Internal Server Error' });
  }
}
