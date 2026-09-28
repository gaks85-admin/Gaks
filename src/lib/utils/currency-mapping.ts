/**
 * Mapping of country names or codes to their primary currencies.
 * This is used to associate economic events with specific currency pairs.
 */
export const COUNTRY_TO_CURRENCY: Record<string, string> = {
  // Major Economies (G10)
  'United States': 'USD',
  'USA': 'USD',
  'US': 'USD',
  'Euro Area': 'EUR',
  'European Union': 'EUR',
  'European Union (Eurozone)': 'EUR',
  'EMU': 'EUR',
  'Germany': 'EUR',
  'France': 'EUR',
  'Italy': 'EUR',
  'Spain': 'EUR',
  'United Kingdom': 'GBP',
  'UK': 'GBP',
  'Great Britain': 'GBP',
  'Japan': 'JPY',
  'Australia': 'AUD',
  'New Zealand': 'NZD',
  'Canada': 'CAD',
  'Switzerland': 'CHF',

  // Other significant economies
  'China': 'CNY',
  'India': 'INR',
  'Brazil': 'BRL',
  'Russia': 'RUB',
  'South Africa': 'ZAR',
  'Mexico': 'MXN',
  'South Korea': 'KRW',
  'Singapore': 'SGD',
  'Hong Kong': 'HKD',
  'Sweden': 'SEK',
  'Norway': 'NOK',
  'Denmark': 'DKK',
  'Turkey': 'TRY',
};

/**
 * Normalizes a country name or code to its corresponding currency code.
 * If no mapping is found, it returns 'USD' as a conservative default for macro events,
 * or null if the caller prefers to handle unknowns differently.
 */
export function getCurrencyForCountry(country: string | null): string | null {
  if (!country) return null;
  
  const normalized = country.trim();
  
  // Direct lookup
  if (COUNTRY_TO_CURRENCY[normalized]) {
    return COUNTRY_TO_CURRENCY[normalized];
  }
  
  // Case-insensitive lookup
  const entry = Object.entries(COUNTRY_TO_CURRENCY).find(
    ([key]) => key.toLowerCase() === normalized.toLowerCase()
  );
  
  return entry ? entry[1] : null;
}
