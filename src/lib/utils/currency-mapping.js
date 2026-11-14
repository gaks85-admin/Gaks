const COUNTRY_TO_CURRENCY = {
  // Major Economies (G10)
  "United States": "USD",
  "USA": "USD",
  "US": "USD",
  "Euro Area": "EUR",
  "European Union": "EUR",
  "European Union (Eurozone)": "EUR",
  "EMU": "EUR",
  "Germany": "EUR",
  "France": "EUR",
  "Italy": "EUR",
  "Spain": "EUR",
  "United Kingdom": "GBP",
  "UK": "GBP",
  "Great Britain": "GBP",
  "Japan": "JPY",
  "Australia": "AUD",
  "New Zealand": "NZD",
  "Canada": "CAD",
  "Switzerland": "CHF",
  // Other significant economies
  "China": "CNY",
  "India": "INR",
  "Brazil": "BRL",
  "Russia": "RUB",
  "South Africa": "ZAR",
  "Mexico": "MXN",
  "South Korea": "KRW",
  "Singapore": "SGD",
  "Hong Kong": "HKD",
  "Sweden": "SEK",
  "Norway": "NOK",
  "Denmark": "DKK",
  "Turkey": "TRY"
};
function getCurrencyForCountry(country) {
  if (!country) return null;
  const normalized = country.trim();
  if (COUNTRY_TO_CURRENCY[normalized]) {
    return COUNTRY_TO_CURRENCY[normalized];
  }
  const entry = Object.entries(COUNTRY_TO_CURRENCY).find(
    ([key]) => key.toLowerCase() === normalized.toLowerCase()
  );
  return entry ? entry[1] : null;
}
export {
  COUNTRY_TO_CURRENCY,
  getCurrencyForCountry
};
