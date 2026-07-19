/**
 * Centralized market data utilities for Gaks AI
 */

/**
 * Canonicalizes a symbol to a standard internal format (uppercase, alphanumeric only).
 * Example: "EUR/USD" -> "EURUSD", "BTC-USD" -> "BTCUSD", "XAU/USD" -> "XAUUSD"
 */
export const toCanonicalSymbol = (symbol: string): string => {
  if (!symbol) return '';
  return symbol.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
};

/**
 * Normalizes any variation of a symbol into a standard 6-character or identifying format.
 * This is used for comparison between different sources (Yahoo, internal, etc.)
 */
export const normalizeSymbol = (symbol: string): string => {
  if (!symbol) return '';
  
  let s = symbol.trim().toUpperCase();
  
  // Specific Yahoo/Common mappings
  if (s === 'GC=F' || s === 'XAU/USD' || s === 'XAUUSD') return 'XAUUSD';
  if (s === 'SI=F' || s === 'XAG/USD' || s === 'XAGUSD') return 'XAGUSD';
  if (s === 'NQ=F' || s === 'NAS100') return 'NAS100';
  if (s === 'YM=F' || s === 'US30') return 'US30';
  if (s === 'ES=F' || s === 'SPX500') return 'SPX500';
  if (s === 'DAX=F' || s === 'GER30') return 'GER30';
  if (s === 'Z=F' || s === 'UK100') return 'UK100';
  
  // Strip common suffixes
  s = s.replace('=X', '').replace('-USD', '').replace('=F', '');
  
  // Final alphanumeric cleanup
  return s.replace(/[^A-Z0-9]/g, '');
};

/**
 * Converts a canonical symbol to a human-friendly display format.
 */
export const toDisplaySymbol = (symbol: string): string => {
  const canonical = toCanonicalSymbol(symbol);
  
  const mappings: Record<string, string> = {
    'EURUSD': 'EUR/USD',
    'GBPUSD': 'GBP/USD',
    'USDJPY': 'USD/JPY',
    'AUDUSD': 'AUD/USD',
    'USDCAD': 'USD/CAD',
    'USDCHF': 'USD/CHF',
    'NZDUSD': 'NZD/USD',
    'BTCUSD': 'BTC/USD',
    'ETHUSD': 'ETH/USD',
    'XAUUSD': 'XAU/USD',
    'XAGUSD': 'XAG/USD',
    'NAS100': 'NAS100',
    'US30': 'US30',
    'SPX500': 'SPX500',
    'GER30': 'GER30',
    'UK100': 'UK100'
  };

  if (mappings[canonical]) return mappings[canonical];

  // Heuristic for 6-letter Forex pairs not in mapping
  if (canonical.length === 6 && /^[A-Z]{6}$/.test(canonical)) {
    return `${canonical.slice(0, 3)}/${canonical.slice(3)}`;
  }

  return canonical;
};

/**
 * Legacy aliases for backward compatibility
 */
export const convertSymbol = toDisplaySymbol;

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
