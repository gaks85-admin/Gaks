import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { determineMarketBias, Candle } from '../src/lib/strategy-engine.js';

/**
 * Converts a symbol to Twelve Data format for time series requests.
 */
function convertSymbolForTwelveData(sym: string): string {
  if (!sym) return "";
  let mapped = sym.trim().toUpperCase().replace(/[-_\s/]/g, '');
  const mappings: Record<string, string> = {
    'EURUSD': 'EUR/USD', 'GBPUSD': 'GBP/USD', 'XAUUSD': 'XAU/USD', 'BTCUSD': 'BTC/USD',
    'ETHUSD': 'ETH/USD', 'XAGUSD': 'XAG/USD', 'USDJPY': 'USD/JPY', 'AUDUSD': 'AUD/USD',
    'USDCAD': 'USD/CAD', 'USDCHF': 'USD/CHF', 'NZDUSD': 'NZD/USD',
    'NAS100': 'QQQ', 'US30': 'DIA', 'SPX500': 'SPY', 'US500': 'SPY', 'GER30': 'DAX', 'UK100': 'UKX'
  };
  if (mappings[mapped]) return mappings[mapped];
  if (mapped.length === 6 && /^[A-Z]{6}$/.test(mapped)) return `${mapped.slice(0, 3)}/${mapped.slice(3)}`;
  return mapped;
}

/**
 * Canonicalizes a symbol to a standard internal format (uppercase, alphanumeric only).
 */
const toCanonicalSymbol = (symbol: string): string => {
  if (!symbol) return '';
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
};

/**
 * Converts a canonical symbol to a human-friendly display format.
 */
const toDisplaySymbol = (symbol: string): string => {
  const canonical = toCanonicalSymbol(symbol);
  const mappings: Record<string, string> = {
    'EURUSD': 'EUR/USD', 'GBPUSD': 'GBP/USD', 'USDJPY': 'USD/JPY', 'AUDUSD': 'AUD/USD',
    'USDCAD': 'USD/CAD', 'USDCHF': 'USD/CHF', 'NZDUSD': 'NZD/USD', 'BTCUSD': 'BTC/USD',
    'ETHUSD': 'ETH/USD', 'XAUUSD': 'XAU/USD', 'XAGUSD': 'XAG/USD', 'NAS100': 'NAS100',
    'US30': 'US30', 'SPX500': 'SPX500', 'GER30': 'GER30', 'UK100': 'UK100'
  };
  if (mappings[canonical]) return mappings[canonical];
  if (canonical.length === 6 && /^[A-Z]{6}$/.test(canonical)) {
    return `${canonical.slice(0, 3)}/${canonical.slice(3)}`;
  }
  return canonical;
};

/**
 * Self-contained Supabase client initialization.
 */
const getSupabase = () => {
  const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    throw new Error('Supabase configuration missing (URL or Service Role Key)');
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
};

const DEFAULT_SYMBOLS = ['EURUSD', 'GBPUSD', 'XAUUSD', 'BTCUSD', 'NAS100', 'US30'];

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const supabase = getSupabase();
    const twelveDataKey = process.env.TWELVE_DATA_API_KEY;

    if (!twelveDataKey) {
       throw new Error("TWELVE_DATA_API_KEY is not defined");
    }
    
    // 1. Fetch active watchers
    const { data: watchers } = await supabase
      .from('watchers')
      .select('selected_pair')
      .eq('status', 'active');
      
    // 2. Canonicalize and merge
    const watcherSymbols = (watchers || []).map(w => toCanonicalSymbol(w.selected_pair));
    const uniqueSymbols = Array.from(new Set([...DEFAULT_SYMBOLS, ...watcherSymbols])).filter(Boolean);
    
    // 3. Fetch data from Twelve Data
    const pairsData = await Promise.all(
      uniqueSymbols.map(async (sym) => {
        try {
          const canonical = toCanonicalSymbol(sym);
          const mappedSymbol = convertSymbolForTwelveData(canonical);
          const displaySymbol = toDisplaySymbol(sym);
          
          // Use complex request for quotes and basic time series (needed for sentiment/bias)
          const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(mappedSymbol)}&apikey=${twelveDataKey}`;
          const res = await fetch(url);
          const quote = await res.json();

          if (quote.status === "error") {
            return { symbol: displaySymbol, status: 'unavailable', error: quote.message };
          }

          // Fetch recent candles for sentiment
          const tsUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(mappedSymbol)}&interval=1h&outputsize=20&apikey=${twelveDataKey}`;
          const tsRes = await fetch(tsUrl);
          const tsData = await tsRes.json();
          
          let sentiment: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral';
          let history: number[] = [];
          
          if (tsData.status === "ok" && Array.isArray(tsData.values)) {
            const candles: Candle[] = tsData.values.map((v: any) => ({
              timestamp: v.datetime,
              open: parseFloat(v.open),
              high: parseFloat(v.high),
              low: parseFloat(v.low),
              close: parseFloat(v.close),
              volume: v.volume ? parseFloat(v.volume) : undefined
            })).reverse();
            
            sentiment = determineMarketBias(candles);
            history = candles.map(c => c.close);
          }

          return {
            symbol: displaySymbol,
            name: displaySymbol,
            currentPrice: parseFloat(quote.close || quote.price),
            basePrice: parseFloat(quote.previous_close || quote.close),
            change: parseFloat(quote.percent_change || 0),
            sentiment,
            history: history.length > 0 ? history : [parseFloat(quote.previous_close || quote.close), parseFloat(quote.close || quote.price)],
            status: 'active'
          };
        } catch (err) {
          return { symbol: sym, status: 'unavailable' };
        }
      })
    );

    return res.status(200).json({
      success: true,
      timestamp: Date.now(),
      pairs: pairsData
    });
    
  } catch (error: any) {
    console.error('[Live Rates] Endpoint Error:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}
