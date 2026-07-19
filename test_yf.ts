import YahooFinanceModule from 'yahoo-finance2';
const YahooFinance = (YahooFinanceModule as any).default || YahooFinanceModule;
const yahooFinance = new YahooFinance();
yahooFinance.quote('EURUSD=X').then(console.log).catch(console.error);
