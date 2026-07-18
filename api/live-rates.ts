import { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { toCanonicalSymbol, toDisplaySymbol } from './_lib/market-utils';

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
    // 1. Fetch latest rates from ExchangeRate-API (USD base)
    const erResponse = await fetch('https://open.er-api.com/v6/latest/USD');
    if (!erResponse.ok) {
      throw new Error(`ExchangeRate-API failed: ${erResponse.statusText}`);
    }
    const erData = await erResponse.json();
    
    if (erData.result !== 'success' || !erData.rates) {
      throw new Error('ExchangeRate-API returned invalid data');
    }

    const rates = erData.rates;

    // 2. Define the symbols we want to provide to the UI
    const monitoredSymbols = [
      'EURUSD', 'GBPUSD', 'USDJPY', 'XAUUSD', 'BTCUSD', 'ETHUSD', 'NAS100', 'US30',
      'AUDUSD', 'NZDUSD', 'USDCAD', 'USDCHF'
    ];

    const pairsCache: any[] = [];

    monitoredSymbols.forEach(symbol => {
      let currentPrice: number | null = null;
      let basePrice: number | null = null; // We'll use currentPrice as base if unavailable for simple UI

      try {
        switch (symbol) {
          case 'EURUSD':
            currentPrice = rates.EUR ? 1 / rates.EUR : null;
            break;
          case 'GBPUSD':
            currentPrice = rates.GBP ? 1 / rates.GBP : null;
            break;
          case 'AUDUSD':
            currentPrice = rates.AUD ? 1 / rates.AUD : null;
            break;
          case 'NZDUSD':
            currentPrice = rates.NZD ? 1 / rates.NZD : null;
            break;
          case 'USDJPY':
            currentPrice = rates.JPY || null;
            break;
          case 'USDCAD':
            currentPrice = rates.CAD || null;
            break;
          case 'USDCHF':
            currentPrice = rates.CHF || null;
            break;
          // For Gold, BTC, ETH, Indices - ExchangeRate-API might have them, otherwise mark as unavailable
          default:
            // Extract currency part if it's a 6-char symbol or similar
            const quote = symbol.substring(0, 3);
            if (rates[quote]) {
              // If it's something like BTCUSD, it's 1/rates[BTC]
              currentPrice = 1 / rates[quote];
            } else if (rates[symbol]) {
              currentPrice = rates[symbol];
            }
        }

        if (currentPrice !== null) {
          pairsCache.push({
            symbol,
            name: toDisplaySymbol(symbol),
            currentPrice,
            basePrice: currentPrice, // Mocking basePrice for now as ER-API doesn't provide 24h open directly in this endpoint
            change: 0,
            sentiment: 'Neutral',
            status: 'active'
          });
        } else {
          pairsCache.push({
            symbol,
            name: toDisplaySymbol(symbol),
            status: 'unavailable'
          });
        }
      } catch (e) {
        pairsCache.push({
          symbol,
          name: toDisplaySymbol(symbol),
          status: 'unavailable'
        });
      }
    });

    return res.status(200).json({
      success: true,
      timestamp: Date.now(),
      pairs: pairsCache
    });

  } catch (err: any) {
    console.error("[Live Rates] Fatal error:", err.message);
    return res.status(200).json({
      success: false,
      error: 'Rates currently unavailable',
      pairs: [
        { symbol: 'EURUSD', status: 'unavailable' },
        { symbol: 'GBPUSD', status: 'unavailable' }
      ]
    });
  }
}
