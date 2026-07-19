import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance();
yahooFinance.quote('EURUSD=X').then((q) => console.log(q.symbol)).catch(console.error);
