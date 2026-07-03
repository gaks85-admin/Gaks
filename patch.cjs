const fs = require('fs');

let code = fs.readFileSync('api/cron/market-watcher.ts', 'utf8');

code = code.replace('const results = [];', 'const results = [];\n    const skipped = [];\n    const errors = [];');

code = code.replace(
  'if (!selectedPair) continue;',
  'if (!selectedPair) { skipped.push({ userId, reason: "No selected pair" }); continue; }'
);

code = code.replace(
  'if (!telegramConn || !telegramConn.connected || !telegramConn.telegram_chat_id) {\n          console.log(`[User ${userId}] Telegram not connected. Skipping.`);\n          continue;\n        }',
  'if (!telegramConn || !telegramConn.connected || !telegramConn.telegram_chat_id) {\n          console.log(`[User ${userId}] Telegram not connected. Skipping.`);\n          skipped.push({ userId, reason: "Telegram not connected" });\n          continue;\n        }'
);

code = code.replace(
  'if (!strategyText.trim()) {\n          console.log(`[User ${userId}] Strategy text empty. Skipping.`);\n          continue;\n        }',
  'if (!strategyText.trim()) {\n          console.log(`[User ${userId}] Strategy text empty. Skipping.`);\n          skipped.push({ userId, reason: "Strategy text empty" });\n          continue;\n        }'
);

code = code.replace(
  'if (!accountSize || !riskPercentage) {\n          console.log(`[User ${userId}] Account size or risk percentage not defined. Skipping.`);\n          continue;\n        }',
  'if (!accountSize || !riskPercentage) {\n          console.log(`[User ${userId}] Account size or risk percentage not defined. Skipping.`);\n          skipped.push({ userId, reason: "Account size or risk percentage not defined" });\n          continue;\n        }'
);

code = code.replace(
  'if (!apiKeyRecord || !apiKeyRecord.api_key) {\n          console.log(`[User ${userId}] Gemini API Key missing. Skipping.`);\n          continue;\n        }',
  'if (!apiKeyRecord || !apiKeyRecord.api_key) {\n          console.log(`[User ${userId}] Gemini API Key missing. Skipping.`);\n          skipped.push({ userId, reason: "Gemini API Key missing" });\n          continue;\n        }'
);

code = code.replace(
  '} catch (err: any) {\n        console.error(`[User ${userId}] Error processing watcher:`, err.message || err);\n      }',
  '} catch (err: any) {\n        console.error(`[User ${userId}] Error processing watcher:`, err.message || err);\n        errors.push({ userId, error: err.message || "Unknown error" });\n      }'
);

code = code.replace(
  'return res.status(200).json({ success: true, processed: results.length, results });',
  'return res.status(200).json({ success: true, processed: results.length, results, skipped, errors });'
);

fs.writeFileSync('api/cron/market-watcher.ts', code);
