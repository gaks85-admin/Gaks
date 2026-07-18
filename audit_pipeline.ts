
import yahooFinance from 'yahoo-finance2';
import { convertSymbolToYahoo } from './src/lib/market-utils';

const YahooFinance = (yahooFinance as any).default || yahooFinance;
const yf = new YahooFinance();

async function auditPipeline() {
  const monitoredSymbols = ['EURUSD', 'BTCUSD', 'XAUUSD'];
  const yahooSymbolMap: Record<string, string> = {};
  
  console.log('--- AUDIT: Yahoo Finance Pipeline ---');
  
  monitoredSymbols.forEach(s => {
    const yTicker = convertSymbolToYahoo(s);
    yahooSymbolMap[yTicker] = s;
    console.log(`Input Symbol: ${s} -> Yahoo Ticker: ${yTicker}`);
  });

  const yahooSymbolsToFetch = Object.keys(yahooSymbolMap);
  const pairsCache: Record<string, any> = {};

  try {
    console.log(`\nRequesting quotes for: ${yahooSymbolsToFetch.join(', ')}`);
    const yahooQuotes = await yf.quote(yahooSymbolsToFetch);
    const quotesArray = Array.isArray(yahooQuotes) ? yahooQuotes : [yahooQuotes];
    
    console.log(`\nRaw Yahoo Response (${quotesArray.length} items):`);
    console.log(JSON.stringify(yahooQuotes, null, 2));

    quotesArray.forEach((quote: any) => {
      if (!quote || !quote.symbol) {
          console.log(`\nItem is null or missing symbol: ${JSON.stringify(quote)}`);
          return;
      }
      
      const originalSymbol = yahooSymbolMap[quote.symbol];
      console.log(`\nTracing ${originalSymbol} (Ticker: ${quote.symbol}):`);
      
      const currentPrice = quote.regularMarketPrice;
      console.log(`  regularMarketPrice: ${currentPrice} (${typeof currentPrice})`);
      
      if (currentPrice === undefined || currentPrice === null) {
        console.log(`  RESULT: Missing price. NOT written to pairsCache.`);
        return;
      }

      const basePrice = quote.regularMarketPreviousClose || currentPrice;
      const change = quote.regularMarketChangePercent || 0;
      const name = quote.shortName || quote.longName || originalSymbol;

      pairsCache[originalSymbol] = {
        symbol: originalSymbol,
        name,
        basePrice,
        currentPrice,
        change,
        sentiment: change > 0.05 ? 'Bullish' : (change < -0.05 ? 'Bearish' : 'Neutral'),
        history: [], 
        status: 'active'
      };
      console.log(`  RESULT: Success. Written to pairsCache.`);
    });

  } catch (err: any) {
    console.error('\nYAHOO FETCH THREW ERROR:', err.message);
  }

  console.log('\n--- Final /api/live-rates JSON Output ---');
  const response = {
    success: true,
    timestamp: Date.now(),
    pairs: Object.values(pairsCache)
  };
  console.log(JSON.stringify(response, null, 2));

  console.log('\n--- Data Availability Check ---');
  monitoredSymbols.forEach(s => {
    if (!pairsCache[s]) {
      console.log(`${s}: Data unavailable. Reason: Missing price in Yahoo response or Fetch failed.`);
    } else {
      console.log(`${s}: Available.`);
    }
  });
}

auditPipeline().catch(console.error);
