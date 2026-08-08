import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { determineMarketBias, Candle } from '../src/lib/strategy-engine.js';
import { toCanonicalSymbol, toDisplaySymbol } from '../lib/market-utils.js';

/**
 * Converts a canonical symbol to Yahoo Finance symbol format.
 */
function convertSymbolForYahoo(sym: string): string {
  if (!sym) return "EURUSD=X";
  const canonical = toCanonicalSymbol(sym);
  const mappings: Record<string, string> = {
    'EURUSD': 'EURUSD=X',
    'GBPUSD': 'GBPUSD=X',
    'USDJPY': 'USDJPY=X',
    'AUDUSD': 'AUDUSD=X',
    'USDCAD': 'USDCAD=X',
    'USDCHF': 'USDCHF=X',
    'NZDUSD': 'NZDUSD=X',
    'BTCUSD': 'BTC-USD',
    'ETHUSD': 'ETH-USD',
    'XAUUSD': 'GC=F',
    'XAGUSD': 'SI=F',
    'NAS100': 'NQ=F',
    'US30': 'YM=F',
    'SPX500': 'ES=F',
    'GER30': 'DAX=F',
    'UK100': 'Z=F'
  };
  if (mappings[canonical]) return mappings[canonical];
  if (canonical.length === 6 && /^[A-Z]{6}$/.test(canonical)) {
    return `${canonical}=X`;
  }
  return canonical;
}

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

// In-memory server cache for Yahoo Finance live rates (20-second TTL)
interface LiveRatesCache {
  data: any;
  timestamp: number;
}
let liveRatesCache: LiveRatesCache | null = null;
const CACHE_TTL_MS = 20 * 1000; // 20 seconds

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS & Cache Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'public, max-age=20, s-maxage=20, stale-while-revalidate=10');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const now = Date.now();
  if (liveRatesCache && (now - liveRatesCache.timestamp) < CACHE_TTL_MS) {
    return res.status(200).json({
      ...liveRatesCache.data,
      cached: true,
      cacheAgeMs: now - liveRatesCache.timestamp
    });
  }

  try {
    let watcherSymbols: string[] = [];
    try {
      const supabase = getSupabase();
      const { data: watchers } = await supabase
        .from('watchers')
        .select('selected_pair')
        .eq('status', 'active');
      if (watchers) {
        watcherSymbols = watchers.map(w => toCanonicalSymbol(w.selected_pair));
      }
    } catch (dbErr) {
      console.warn('[Live Rates] Could not fetch active watchers from Supabase:', dbErr);
    }

    const uniqueSymbols = Array.from(new Set([...DEFAULT_SYMBOLS, ...watcherSymbols])).filter(Boolean);

    // Fetch data from Yahoo Finance public chart endpoint
    const pairsData = await Promise.all(
      uniqueSymbols.map(async (sym) => {
        const canonical = toCanonicalSymbol(sym);
        const yahooSymbol = convertSymbolForYahoo(canonical);
        const displaySymbol = toDisplaySymbol(sym);

        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(yahooSymbol)}?interval=1h&range=5d`;
          const fetchRes = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
          });

          if (!fetchRes.ok) {
            return { symbol: displaySymbol, status: 'unavailable' };
          }

          const data = await fetchRes.json();
          const result = data?.chart?.result?.[0];

          if (!result) {
            return { symbol: displaySymbol, status: 'unavailable' };
          }

          const meta = result.meta || {};
          const currentPrice = meta.regularMarketPrice || meta.chartPreviousClose || 0;
          const basePrice = meta.chartPreviousClose || meta.previousClose || currentPrice;
          const change = basePrice ? ((currentPrice - basePrice) / basePrice) * 100 : 0;

          const quote = result.indicators?.quote?.[0] || {};
          const timestamps: number[] = result.timestamp || [];
          const opens: (number | null)[] = quote.open || [];
          const highs: (number | null)[] = quote.high || [];
          const lows: (number | null)[] = quote.low || [];
          const closes: (number | null)[] = quote.close || [];

          const validCloses = closes.filter((c): c is number => typeof c === 'number' && !isNaN(c));

          const candles: Candle[] = [];
          for (let i = 0; i < timestamps.length; i++) {
            if (
              typeof closes[i] === 'number' && !isNaN(closes[i]!) &&
              typeof opens[i] === 'number' && !isNaN(opens[i]!)
            ) {
              candles.push({
                timestamp: new Date(timestamps[i] * 1000).toISOString(),
                open: opens[i]!,
                high: typeof highs[i] === 'number' ? highs[i]! : closes[i]!,
                low: typeof lows[i] === 'number' ? lows[i]! : closes[i]!,
                close: closes[i]!,
              });
            }
          }

          let sentiment: 'Bullish' | 'Bearish' | 'Neutral' = 'Neutral';
          if (candles.length > 0) {
            sentiment = determineMarketBias(candles);
          } else if (change > 0) {
            sentiment = 'Bullish';
          } else if (change < 0) {
            sentiment = 'Bearish';
          }

          return {
            symbol: displaySymbol,
            name: displaySymbol,
            currentPrice,
            basePrice,
            change,
            sentiment,
            history: validCloses.length > 0 ? validCloses : [basePrice, currentPrice],
            status: 'active'
          };
        } catch (err) {
          return { symbol: displaySymbol, status: 'unavailable' };
        }
      })
    );

    // If all or most pairs failed due to Yahoo rate limit (429/403) and we have cache, serve stale cache
    const availablePairs = pairsData.filter(p => p && p.status !== 'unavailable');
    if (availablePairs.length === 0 && liveRatesCache) {
      console.warn('[Live Rates] Yahoo rate limited or unavailable for all symbols. Serving stale cached rates.');
      return res.status(200).json({
        ...liveRatesCache.data,
        cached: true,
        stale: true,
        cacheAgeMs: now - liveRatesCache.timestamp
      });
    }

    const responsePayload = {
      success: true,
      timestamp: Date.now(),
      pairs: pairsData
    };

    liveRatesCache = {
      data: responsePayload,
      timestamp: Date.now()
    };

    return res.status(200).json(responsePayload);

  } catch (error: any) {
    console.error('[Live Rates] Endpoint Error:', error);
    if (liveRatesCache) {
      console.warn('[Live Rates] Returning stale cached rates after endpoint exception.');
      return res.status(200).json({
        ...liveRatesCache.data,
        cached: true,
        stale: true
      });
    }
    return res.status(500).json({
      success: false,
      error: error.message || 'Internal server error'
    });
  }
}
