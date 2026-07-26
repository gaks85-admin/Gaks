import yahooFinanceRaw from 'yahoo-finance2';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { determineMarketBias, Candle } from '../src/lib/strategy-engine.js';

// Detect if we're in a bundled CJS environment where the default export is nested
const YahooFinance = (yahooFinanceRaw as any).default || yahooFinanceRaw;
const yahooFinance = new YahooFinance();

// --- INLINED UTILITIES TO ENSURE SELF-CONTAINED DEPLOYMENT ---

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

interface CachedCandleData {
  candles: Candle[];
  timestamp: number;
  sentiment: 'Bullish' | 'Bearish' | 'Neutral';
  history: number[];
}
const candleCache: Record<string, CachedCandleData> = {};
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes cache TTL to protect Twelve Data rate limit (800 req/day)

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
    
    // 3. Pre-fetch / update Twelve Data candles in parallel for rate bias calculation
    const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
    if (twelveDataKey) {
      await Promise.allSettled(
        uniqueSymbols.map(async (sym) => {
          try {
            const canonical = toCanonicalSymbol(sym);
            if (candleCache[canonical] && (Date.now() - candleCache[canonical].timestamp < CACHE_TTL_MS)) {
              return; // Cache valid and fresh
            }
            const mappedSymbol = convertSymbolForTwelveData(canonical);
            const tsUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(mappedSymbol)}&interval=1h&outputsize=60&apikey=${twelveDataKey}`;
            const tsRes = await fetch(tsUrl, { signal: AbortSignal.timeout(3500) });
            if (tsRes.ok) {
              const tsData = await tsRes.json();
              if (tsData.status === "ok" && Array.isArray(tsData.values) && tsData.values.length > 0) {
                const candles: Candle[] = tsData.values.map((v: any) => ({
                  timestamp: v.datetime,
                  open: parseFloat(v.open),
                  high: parseFloat(v.high),
                  low: parseFloat(v.low),
                  close: parseFloat(v.close),
                  volume: v.volume ? parseFloat(v.volume) : undefined
                })).reverse(); // Oldest to newest

                const sentiment = determineMarketBias(candles);
                const history = candles.slice(-20).map(c => Number(c.close)).filter(c => !isNaN(c));

                candleCache[canonical] = {
                  candles,
                  timestamp: Date.now(),
                  sentiment,
                  history
                };
              } else if (tsData.status === "error" && tsData.code === 429) {
                console.warn(`[Live Rates] Twelve Data rate limit 429 hit for ${mappedSymbol}`);
              }
            }
          } catch (err: any) {
            console.warn(`[Live Rates] Twelve Data fetch error for ${sym}:`, err.message || err);
          }
        })
      );
    }
    
    // 4. Fetch data from Yahoo
    const pairsData = [];
    for (const symbol of uniqueSymbols) {
      const canonical = toCanonicalSymbol(symbol);
      const ticker = symbolToYahooTicker(symbol);
      const displaySymbol = toDisplaySymbol(symbol);
      
      let attempt = 1;
      let quoteData = null;
      let status = 'unavailable';

      while (attempt <= 3) {
        try {
          const start = Date.now();
          const quote: any = await yahooFinance.quote(ticker);
          const latency = Date.now() - start;
          
          console.log(`Attempt ${attempt} for ${ticker}: Success, latency: ${latency}ms`);

          if (quote && quote.regularMarketPrice !== undefined) {
            const cached = candleCache[canonical];
            const sentiment = cached?.sentiment || 'Neutral';
            const history = cached?.history && cached.history.length > 0
              ? cached.history
              : [quote.regularMarketPreviousClose || quote.regularMarketPrice, quote.regularMarketPrice];

            quoteData = {
              symbol: displaySymbol,
              name: displaySymbol,
              currentPrice: quote.regularMarketPrice,
              basePrice: quote.regularMarketPreviousClose || quote.regularMarketPrice,
              change: quote.regularMarketChangePercent || 0,
              sentiment,
              history,
              status: 'active'
            };
            status = 'active';
            break; // Success
          }
        } catch (err: any) {
          const errMsg = err.message || '';
          const isRetryable = errMsg.includes('ECONNRESET') || 
                              errMsg.includes('connection termination') ||
                              errMsg.includes('network') ||
                              errMsg.includes('timeout') ||
                              (err.status >= 500);
          
          console.log(`Attempt ${attempt} for ${ticker}: ${errMsg}. Retryable: ${isRetryable}`);
          
          if (isRetryable && attempt < 3) {
            const delay = attempt === 1 ? 300 : 600;
            await new Promise(resolve => setTimeout(resolve, delay));
            attempt++;
            continue;
          }
        }
        break; // Failed or not retryable
      }
      
      if (!quoteData && candleCache[canonical] && candleCache[canonical].history.length > 0) {
        const hist = candleCache[canonical].history;
        const currentPrice = hist[hist.length - 1];
        const basePrice = hist[hist.length - 2] || currentPrice;
        const change = basePrice > 0 ? ((currentPrice - basePrice) / basePrice) * 100 : 0;
        quoteData = {
          symbol: displaySymbol,
          name: displaySymbol,
          currentPrice,
          basePrice,
          change,
          sentiment: candleCache[canonical].sentiment,
          history: hist,
          status: 'active'
        };
      }

      pairsData.push(quoteData || { symbol: displaySymbol, status: 'unavailable' });
    }

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
