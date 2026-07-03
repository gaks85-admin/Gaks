const fs = require('fs');

let code = fs.readFileSync('api/cron/market-watcher.ts', 'utf8');

code = code.replace(
  'const tdRes = await fetch(url);',
  'console.log(`[User ${userId}] Requesting TwelveData: https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}`);\n        const tdRes = await fetch(url);'
);

fs.writeFileSync('api/cron/market-watcher.ts', code);
