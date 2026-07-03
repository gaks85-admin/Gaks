const fs = require('fs');
let code = fs.readFileSync('api/cron/market-watcher.ts', 'utf8');
code = code.replace(/\\\}/g, '}');
fs.writeFileSync('api/cron/market-watcher.ts', code);
