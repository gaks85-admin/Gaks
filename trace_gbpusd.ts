
import yahooFinance from 'yahoo-finance2';
import { toCanonicalSymbol, toDisplaySymbol, toYahooTicker } from './api/_lib/market-utils';

const YahooFinance = (yahooFinance as any).default || yahooFinance;
const yf = new YahooFinance();

async function traceGBPUSD() {
  const symbol = 'GBPUSD';
  const canonical = toCanonicalSymbol(symbol);
  const ticker = toYahooTicker(canonical);

  console.log(`Step 1: Mapping ${symbol} -> Canonical: ${canonical} -> Ticker: ${ticker}`);

  try {
    const quote = await yf.quote(ticker);
    console.log('\nStep 2: Yahoo Finance Raw Quote for ' + ticker + ':');
    console.log(JSON.stringify(quote, null, 2));

    const price = quote.regularMarketPrice;
    console.log(`\nStep 3: regularMarketPrice present? ${price !== undefined}. Value: ${price}`);

    if (price !== undefined) {
      const entry = {
        symbol: canonical,
        name: quote.shortName || quote.longName || toDisplaySymbol(canonical),
        basePrice: quote.regularMarketPreviousClose || price,
        currentPrice: price,
        change: quote.regularMarketChangePercent || 0,
        sentiment: (quote.regularMarketChangePercent || 0) > 0.05 ? 'Bullish' : ((quote.regularMarketChangePercent || 0) < -0.05 ? 'Bearish' : 'Neutral'),
        history: [],
        status: 'active'
      };
      console.log('\nStep 4 & 5: Written to pairsCache[' + canonical + ']:');
      console.log(JSON.stringify(entry, null, 2));

      console.log('\nStep 6 & 7: /api/live-rates JSON object for ' + symbol + ':');
      console.log(JSON.stringify(entry, null, 2));
    } else {
      console.log('\nPrice missing. Entry would be marked unavailable in real server loop if all fallbacks fail.');
    }

  } catch (err: any) {
    console.error('Yahoo Fetch Error:', err.message);
  }
}

traceGBPUSD().catch(console.error);
