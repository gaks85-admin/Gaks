const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace(/liveRatesHandler\(req, res\)/g, "liveRatesHandler(req as any, res as any)");
code = code.replace(/telegramWebhookHandler\(req, res\)/g, "telegramWebhookHandler(req as any, res as any)");

fs.writeFileSync('server.ts', code, 'utf-8');
