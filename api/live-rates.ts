import * as yahooFinanceModule from 'yahoo-finance2';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getSupabase } from '../lib/supabase-server';
import { toCanonicalSymbol, toDisplaySymbol } from '../lib/market-utils';

// Handle both ES and CJS default exports correctly for yahoo-finance2
const YahooFinanceConstructor = (yahooFinanceModule as any).default || (yahooFinanceModule as any).YahooFinance || yahooFinanceModule;
const yahooFinance = new (YahooFinanceConstructor as any)();

/**
 * Default symbols to show on the homepage if no watchers are active.
 * These are the core liquid assets configured by the application.
 */
const DEFAULT_SYMBOLS = ['EURUSD', 'GBPUSD', 'XAUUSD', 'BTCUSD', 'NAS100', 'US30'];

/**
 * Dynamically converts canonical symbols into Yahoo Finance tickers.
 * Logic is extensible for Forex, Crypto, Metals, and Indices.
 */
const symbolToYahooTicker = (symbol: string): string => {
  const canonical = toCanonicalSymbol(symbol);
  
  // Crypto mappings (BTCUSD -> BTC-USD)
  if (canonical.endsWith('USD') && (canonical.startsWith('BTC') || canonical.startsWith('ETH') || canonical.startsWith('LTC') || canonical.startsWith('XRP'))) {
    return `${canonical.slice(0, -3)}-USD`;
  }
  
  // Metals/Futures mappings (XAUUSD -> GC=F, XAGUSD -> SI=F)
  if (canonical === 'XAUUSD') return 'GC=F';
  if (canonical === 'XAGUSD') return 'SI=F';
  
  // Indices mappings (appropriate Yahoo futures tickers)
  const indexMappings: Record<string, string> = {
    'NAS100': 'NQ=F', // NASDAQ 100 Futures
    'US30': 'YM=F',   // Dow Jones Futures
    'SPX500': 'ES=F',  // S&P 500 Futures
    'GER30': 'DAX=F', // DAX Futures
    'UK100': 'Z=F'     // FTSE 100 Futures
  };
  
  if (indexMappings[canonical]) return indexMappings[canonical];
  
  // Forex mappings (EURUSD -> EURUSD=X)
  if (canonical.length === 6 && !canonical.includes('USD')) {
      // Heuristic for other forex pairs if needed
      return `${canonical}=X`;
  }
  if (canonical.length === 6) {
    return `${canonical}=X`;
  }
  
  return canonical; // Fallback for stocks or other assets
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const supabase = getSupabase();
    
    // 1. Fetch all active monitored symbols dynamically from the database
    const { data: watchers, error: watcherError } = await supabase
      .from('watchers')
      .select('selected_pair')
      .eq('status', 'active');
      
    if (watcherError) {
      console.warn('[Live Rates] Database check partial failure (watchers table):', watcherError.message);
    }
    
    // 2. Canonicalize and merge symbols (Defaults + Active Watchers)
    const watcherSymbols = (watchers || []).map(w => toCanonicalSymbol(w.selected_pair));
    const uniqueSymbols = Array.from(new Set([...DEFAULT_SYMBOLS, ...watcherSymbols])).filter(Boolean);
    
    // 3. Fetch quotes from Yahoo Finance
    const pairsData = await Promise.all(uniqueSymbols.map(async (symbol) => {
      const ticker = symbolToYahooTicker(symbol);
      const displaySymbol = toDisplaySymbol(symbol);
      
      try {
        const quote = await yahooFinance.quote(ticker);
        
        if (!quote || quote.regularMarketPrice === undefined) {
          return {
            symbol: displaySymbol,
            status: 'unavailable'
          };
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
        console.error(`[Live Rates] Error fetching quote for ${ticker} (${symbol}):`, err.message || err);
        return {
          symbol: displaySymbol,
          status: 'unavailable'
        };
      }
    }));

    // 4. Return canonical JSON structure expected by the frontend
    return res.status(200).json({
      success: true,
      timestamp: Date.now(),
      pairs: pairsData
    });
    
  } catch (error: any) {
    console.error('[Live Rates] Critical Pipeline Failure:', error);
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error fetching live rates'
    });
  }
}
