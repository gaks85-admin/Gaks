/**
 * Centralized market data utilities for Gaks AI
 */

/**
 * Normalizes symbols for Twelve Data compatibility.
 * Supports Forex, Crypto, Metals, and Indices.
 */
export const convertSymbol = (sym: string): string => {
  if (!sym) return "";
  let mapped = sym.trim().toUpperCase().replace(/[-_\s/]/g, '');
  
  // Symbol mapping layer for Twelve Data compatibility on free plans
  const mappings: Record<string, string> = {
    'EURUSD': 'EUR/USD',
    'GBPUSD': 'GBP/USD',
    'XAUUSD': 'XAU/USD',
    'BTCUSD': 'BTC/USD',
    'NAS100': 'QQQ',
    'US30': 'DIA',
    'SPX500': 'SPY',
    'US500': 'SPY'
  };

  if (mappings[mapped]) {
    return mappings[mapped];
  }
  
  // Basic Forex heuristic (6 letters, common pairs)
  const commonCurrencies = ["EUR", "USD", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "SGD", "HKD", "SEK", "NOK", "MXN", "CNH", "CNY", "ZAR", "TRY"];
  if (mapped.length === 6 && /^[A-Z]{6}$/.test(mapped)) {
    const firstHalf = mapped.slice(0, 3);
    const secondHalf = mapped.slice(3);
    if (commonCurrencies.includes(firstHalf) && commonCurrencies.includes(secondHalf)) {
      return `${firstHalf}/${secondHalf}`;
    }
  }

  // Crypto heuristics
  const commonCryptoCoins = ["BTC", "ETH", "SOL", "ADA", "XRP", "DOT", "DOGE", "LTC", "LINK", "AVAX", "XLM", "UNI", "BCH", "ATOM"];
  const commonCryptoQuote = ["USD", "USDT", "BTC", "ETH", "EUR", "GBP", "FDUSD", "USDC"];
  
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
  
  // Fallbacks for common quotes
  if (mapped.endsWith('USD') && mapped.length > 3) return mapped.slice(0, -3) + '/USD';
  if (mapped.endsWith('JPY') && mapped.length > 3) return mapped.slice(0, -3) + '/JPY';
  if (mapped.endsWith('EUR') && mapped.length > 3) return mapped.slice(0, -3) + '/EUR';
  if (mapped.endsWith('GBP') && mapped.length > 3) return mapped.slice(0, -3) + '/GBP';
  
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
