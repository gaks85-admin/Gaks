/**
 * Centralized market data utilities for Gaks AI
 */

/**
 * Normalizes symbols for Twelve Data compatibility (Pipeline 2).
 * Supports Forex, Crypto, Metals, and Indices.
 * Optimized for Free Tier compatibility.
 */
export const convertSymbol = (sym: string): string => {
  if (!sym) return "";
  let mapped = sym.trim().toUpperCase().replace(/[-_\s/]/g, '');
  
  // Symbol mapping layer for Twelve Data compatibility on free plans
  const mappings: Record<string, string> = {
    'EURUSD': 'EUR/USD',
    'GBPUSD': 'GBP/USD',
    'USDJPY': 'USD/JPY',
    'USDCAD': 'USD/CAD',
    'AUDUSD': 'AUD/USD',
    'NZDUSD': 'NZD/USD',
    'USDCHF': 'USD/CHF',
    'XAUUSD': 'XAU/USD',
    'BTCUSD': 'BTC/USD',
    'ETHUSD': 'ETH/USD',
    'NAS100': 'QQQ', // Nasdaq 100 ETF for free tier
    'US30': 'DIA',   // Dow 30 ETF for free tier
    'SPX500': 'SPY', // S&P 500 ETF for free tier
    'US500': 'SPY'
  };

  if (mappings[mapped]) {
    return mappings[mapped];
  }
  
  // Basic Forex heuristic (6 letters)
  const commonCurrencies = ["EUR", "USD", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "SGD", "HKD", "MXN", "ZAR", "TRY"];
  if (mapped.length === 6 && /^[A-Z]{6}$/.test(mapped)) {
    const firstHalf = mapped.slice(0, 3);
    const secondHalf = mapped.slice(3);
    if (commonCurrencies.includes(firstHalf) && commonCurrencies.includes(secondHalf)) {
      return `${firstHalf}/${secondHalf}`;
    }
  }

  // Crypto heuristics
  const commonCryptoCoins = ["BTC", "ETH", "SOL", "ADA", "XRP", "DOT", "DOGE", "LTC", "LINK", "AVAX", "XLM", "UNI", "BCH", "ATOM"];
  const commonCryptoQuote = ["USD", "USDT", "BTC", "ETH", "EUR", "GBP", "USDC"];
  
  for (const coin of commonCryptoCoins) {
    if (mapped.startsWith(coin)) {
      const suffix = mapped.slice(coin.length);
      if (commonCryptoQuote.includes(suffix)) {
        return `${coin}/${suffix}`;
      }
    }
  }
  
  // Generic fallback for 6-letter pairs
  if (mapped.length === 6 && /^[A-Z]{6}$/.test(mapped)) {
    return `${mapped.slice(0, 3)}/${mapped.slice(3)}`;
  }
  
  return mapped;
};

/**
 * Normalizes symbols for Yahoo Finance compatibility (Pipeline 1).
 */
export const convertSymbolToYahoo = (sym: string): string => {
  if (!sym) return "";
  let mapped = sym.trim().toUpperCase().replace(/[-_\s/]/g, '');
  
  const mappings: Record<string, string> = {
    'EURUSD': 'EURUSD=X',
    'GBPUSD': 'GBPUSD=X',
    'USDJPY': 'USDJPY=X',
    'AUDUSD': 'AUDUSD=X',
    'NZDUSD': 'NZDUSD=X',
    'USDCAD': 'USDCAD=X',
    'USDCHF': 'USDCHF=X',
    'XAUUSD': 'GC=F',
    'BTCUSD': 'BTC-USD',
    'ETHUSD': 'ETH-USD',
    'NAS100': '^IXIC',
    'US30': '^DJI',
    'SPX500': '^GSPC',
    'US500': '^GSPC',
    'NAS': '^IXIC',
    'NASDAQ': '^IXIC',
    'SPX': '^GSPC',
    'DOW': '^DJI'
  };

  if (mappings[mapped]) return mappings[mapped];
  
  // Basic Forex heuristic
  if (mapped.length === 6 && /^[A-Z]{6}$/.test(mapped)) {
     return `${mapped}=X`;
  }
  
  // Crypto heuristic
  if (mapped.endsWith('USD') && mapped.length > 3) {
    return `${mapped.slice(0, -3)}-USD`;
  }

  return mapped;
};

/**
 * Maps application timeframes to Twelve Data intervals.
 */
export const mapTimeframeToInterval = (tf: string): string => {
  if (!tf) return '1h';
  const u = tf.toUpperCase();
  if (u === 'M1' || u === '1M') return '1min';
  if (u === 'M5' || u === '5M') return '5min';
  if (u === 'M15' || u === '15M') return '15min';
  if (u === 'M30' || u === '30M') return '30min';
  if (u === 'H1' || u === '1H') return '1h';
  if (u === 'H2' || u === '2H') return '2h';
  if (u === 'H4' || u === '4H') return '4h';
  if (u === 'D1' || u === 'D' || u === 'DAILY') return '1day';
  if (u === 'W1' || u === 'W' || u === 'WEEKLY') return '1week';
  return '1h';
};
