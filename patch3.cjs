const fs = require('fs');

let code = fs.readFileSync('api/cron/market-watcher.ts', 'utf8');

code = code.replace(
  'const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${twelveDataKey}`;',
  'const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${twelveDataKey}`;\n        console.log(`[TwelveData Request] Method: GET, URL: https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}`);'
);

fs.writeFileSync('api/cron/market-watcher.ts', code);
