import * as yahooFinanceModule from 'yahoo-finance2';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// --- INLINED UTILITIES TO ENSURE SELF-CONTAINED DEPLOYMENT ---

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

// --- YAHOO FINANCE INITIALIZATION ---

const YahooFinanceConstructor = (yahooFinanceModule as any).default || (yahooFinanceModule as any).YahooFinance || yahooFinanceModule;
const yahooFinance = new (YahooFinanceConstructor as any)();

const DEFAULT_SYMBOLS = ['EURUSD', 'GBPUSD', 'XAUUSD', 'BTCUSD', 'NAS100', 'US30'];

/**
 * Converts symbols into Yahoo Finance tickers.
 */
const symbolToYahooTicker = (symbol: string): string => {
  const canonical = toCanonicalSymbol(symbol);
  
  if (canonical.endsWith('USD') && (canonical.startsWith('BTC') || canonical.startsWith('ETH') || canonical.startsWith('LTC') || canonical.startsWith('XRP'))) {
    return `${canonical.slice(0, -3)}-USD`;
  }
  
  if (canonical === 'XAUUSD') return 'GC=F';
  if (canonical === 'XAGUSD') return 'SI=F';
  
  const indexMappings: Record<string, string> = {
    'NAS100': 'NQ=F',
    'US30': 'YM=F',
    'SPX500': 'ES=F',
    'GER30': 'DAX=F',
    'UK100': 'Z=F'
  };
  
  if (indexMappings[canonical]) return indexMappings[canonical];
  
  if (canonical.length === 6) {
    return `${canonical}=X`;
  }
  
  return canonical;
};

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
    
    // 1. Fetch active watchers
    const { data: watchers, error: watcherError } = await supabase
      .from('watchers')
      .select('selected_pair')
      .eq('status', 'active');
      
    if (watcherError) {
      console.warn('[Live Rates] Watcher fetch partial failure:', watcherError.message);
    }
    
    // 2. Canonicalize and merge
    const watcherSymbols = (watchers || []).map(w => toCanonicalSymbol(w.selected_pair));
    const uniqueSymbols = Array.from(new Set([...DEFAULT_SYMBOLS, ...watcherSymbols])).filter(Boolean);
    
    // 3. Fetch data from Yahoo
    const pairsData = await Promise.all(uniqueSymbols.map(async (symbol) => {
      const ticker = symbolToYahooTicker(symbol);
      const displaySymbol = toDisplaySymbol(symbol);
      
      try {
        const quote = await yahooFinance.quote(ticker);
        
        if (!quote || quote.regularMarketPrice === undefined) {
          return { symbol: displaySymbol, status: 'unavailable' };
        }
        
        return {
          symbol: displaySymbol,
          name: displaySymbol,
          currentPrice: quote.regularMarketPrice,
          basePrice: quote.regularMarketPreviousClose || quote.regularMarketPrice,
          change: quote.regularMarketChangePercent || 0,
          status: 'active'
        };
      } catch (err: any) {
        console.error(`[Live Rates] Yahoo error for ${ticker}:`, err.message);
        return { symbol: displaySymbol, status: 'unavailable' };
      }
    }));

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
