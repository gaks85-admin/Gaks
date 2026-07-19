import yahooFinanceRaw from 'yahoo-finance2';
const YahooFinance = (yahooFinanceRaw as any).default || yahooFinanceRaw;
const yahooFinance = new YahooFinance();
const symbols = ['EURUSD=X', 'GBPUSD=X', 'BTC-USD', 'GC=F'];
async function run() {
  for (const sym of symbols) {
    try {
      const q = await yahooFinance.quote(sym);
      console.log(`Success ${sym}: ${q.regularMarketPrice}`);
    } catch (e) {
      console.error(`Error ${sym}: ${e.message}`);
    }
  }
}
run();
