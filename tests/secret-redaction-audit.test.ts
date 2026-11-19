import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert';
import {
  redactSecretsInText,
  sanitizeUrl,
  sanitizeErrorMessage,
  sanitizeObjectForLog,
  maskTokenPrefix,
} from '../src/lib/secret-sanitizer.js';
import { redactApiKeyInText } from '../src/lib/gemini-key-resolver.js';

function readFile(relPath: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relPath), 'utf8');
}

async function runAudit() {
  console.log('=== Running Secret Redaction & Exposure Audit ===');

  // 1. Test redactSecretsInText and redactApiKeyInText across all secret formats
  const geminiStd = 'AIzaSyFakeKey1234567890ABCDEFGHIJKLMNOP';
  const geminiAq = 'AQ.AbCdEfGhIjKlMnOpQrStUvWxYz1234567890';
  const telegramToken = '123456789:AAH_FakeTelegramBotToken_1234567890abc';
  const telegramUrl = `https://api.telegram.org/bot${telegramToken}/sendMessage`;
  const twelveDataUrl = 'https://api.twelvedata.com/time_series?symbol=EUR/USD&interval=1h&apikey=td_secret_1234567890';
  const fmpUrl = 'https://financialmodelingprep.com/stable/economic-calendar?from=2026-01-01&apikey=fmp_secret_abcdef';
  const resendKey = 're_1234567890abcdef1234567890abcdef';
  const sendgridKey = 'SG.abcdef1234567890abcd.xyz1234567890abcdef';
  const bearerHeader = 'Authorization: Bearer my-super-secret-cron-token-12345';
  const apikeyHeader = 'Authorization: apikey td_super_secret_key_999';
  const fakeJwt = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwicm9sZSI6InNlcnZpY2Vfcm9sZSJ9.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';

  const combined = [
    geminiStd,
    geminiAq,
    telegramUrl,
    twelveDataUrl,
    fmpUrl,
    resendKey,
    sendgridKey,
    bearerHeader,
    apikeyHeader,
    fakeJwt,
    'https://example.com/cron?secret=my_cron_secret_12345',
  ].join(' | ');

  const cleaned = redactSecretsInText(combined);
  assert(!cleaned.includes(geminiStd), 'Standard Gemini key must be redacted');
  assert(!cleaned.includes(geminiAq), 'AQ Gemini key must be redacted');
  assert(!cleaned.includes(telegramToken), 'Telegram bot token must be redacted');
  assert(!cleaned.includes('td_secret_1234567890'), 'Query apikey= must be redacted');
  assert(!cleaned.includes('fmp_secret_abcdef'), 'FMP apikey= must be redacted');
  assert(!cleaned.includes(resendKey), 'Resend API key must be redacted');
  assert(!cleaned.includes(sendgridKey), 'SendGrid API key must be redacted');
  assert(!cleaned.includes('my-super-secret-cron-token-12345'), 'Bearer header token must be redacted');
  assert(!cleaned.includes('td_super_secret_key_999'), 'apikey header token must be redacted');
  assert(!cleaned.includes('my_cron_secret_12345'), 'Query secret= must be redacted');
  assert(!cleaned.includes('SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c'), 'JWT payload/signature must be redacted');
  assert(redactApiKeyInText(telegramUrl) === redactSecretsInText(telegramUrl), 'redactApiKeyInText delegates to redactSecretsInText');
  console.log('✓ Test 1 passed: All key/token/URL/header/JWT patterns redacted');

  // 2. Test sanitizeUrl, sanitizeErrorMessage, sanitizeObjectForLog, maskTokenPrefix
  const safeTdUrl = sanitizeUrl(twelveDataUrl);
  assert(!safeTdUrl.includes('td_secret_1234567890'), 'sanitizeUrl strips apikey parameter');
  const safeTgUrl = sanitizeUrl(telegramUrl);
  assert(!safeTgUrl.includes(telegramToken), 'sanitizeUrl strips Telegram bot token');

  const safeErr = sanitizeErrorMessage(new Error(`Fetch failed for ${twelveDataUrl} with ${geminiStd}`));
  assert(!safeErr.includes('td_secret_1234567890') && !safeErr.includes(geminiStd), 'sanitizeErrorMessage redacts secrets in Error.message');

  const safeObj = sanitizeObjectForLog({
    id: 'row-1',
    connection_token: 'secret-uuid-token-9999',
    api_key: geminiStd,
    nested: { authorization: 'Bearer top-secret-token-xyz' },
  }) as any;
  assert(safeObj.id === 'row-1', 'Non-sensitive fields preserved');
  assert(safeObj.connection_token === '[REDACTED]', 'connection_token masked in object log');
  assert(safeObj.api_key === '[REDACTED]', 'api_key masked in object log');
  assert(safeObj.nested.authorization === '[REDACTED]', 'nested authorization masked in object log');
  assert(maskTokenPrefix('abcdef1234567890') === 'abcd...', 'maskTokenPrefix preserves prefix only');
  console.log('✓ Test 2 passed: URL, Error, and Object sanitizers work as expected');

  // 3. Source-code security assertions on API routes and handlers
  const cronSrc = readFile('api/cron/market-watcher.ts');
  assert(!cronSrc.includes('authorization: req.headers.authorization'), 'Cron handler must not log raw Authorization header');
  assert(!cronSrc.includes('req.query.secret'), 'Cron handler must not accept CRON_SECRET via URL query param');
  assert(cronSrc.includes('timingSafeEqual'), 'Cron handler must use crypto.timingSafeEqual for CRON_SECRET');

  const startSrc = readFile('src/lib/watcher-handlers/start.ts');
  assert(!startSrc.includes('JSON.stringify(newConn'), 'start.ts must not dump raw telegram_connections row (contains connection_token)');
  assert(!startSrc.includes('JSON.stringify(telegramConn'), 'start.ts must not dump raw telegramConn row (contains connection_token)');
  assert(!startSrc.includes('stack: err.stack'), 'start.ts must not return stack traces in HTTP 500 JSON responses');
  assert(!startSrc.includes('details: err'), 'start.ts must not return raw error objects in HTTP 500 JSON responses');

  const scanSrc = readFile('src/lib/watcher-handlers/scan.ts');
  assert(!scanSrc.includes('stack: err.stack'), 'scan.ts must not return stack traces in HTTP 500 JSON responses');

  const gatewaySrc = readFile('src/lib/market-data-gateway.ts');
  assert(!gatewaySrc.includes('&apikey=${key}'), 'market-data-gateway.ts must pass Twelve Data API key in Authorization header, not URL query string');
  assert(gatewaySrc.includes('Authorization: `apikey ${key}`'), 'market-data-gateway.ts uses Authorization apikey header');

  const webhookSrc = readFile('api/telegram/webhook.ts');
  assert(!webhookSrc.includes('Looking up token: ${token}'), 'Telegram webhook must not log full connection_token');

  const edgeSrc = readFile('supabase/functions/market-watcher/index.ts');
  assert(!edgeSrc.includes('&apikey=${twelveDataKey}') && !edgeSrc.includes('&apikey=${apiKey}'), 'Edge Function must pass Twelve Data key via Authorization header');
  console.log('✓ Test 3 passed: Backend routes, handlers, gateway, webhook, and edge function source assertions clean');

  // 4. Vite production bundle scan (dist/assets/*.js must NEVER contain server secrets)
  const distAssetsDir = path.resolve(process.cwd(), 'dist/assets');
  if (fs.existsSync(distAssetsDir)) {
    const assetFiles = fs.readdirSync(distAssetsDir).filter((f) => f.endsWith('.js'));
    assert(assetFiles.length > 0, 'Expected built client JS files in dist/assets');
    const forbiddenClientRefs = [
      'SUPABASE_SERVICE_ROLE_KEY',
      'TWELVE_DATA_API_KEY',
      'TELEGRAM_BOT_TOKEN',
      'CRON_SECRET',
      'FMP_API_KEY',
      'RESEND_API_KEY',
      'SENDGRID_API_KEY',
      'service_role',
    ];
    for (const file of assetFiles) {
      const content = fs.readFileSync(path.join(distAssetsDir, file), 'utf8');
      for (const secretName of forbiddenClientRefs) {
        assert(!content.includes(secretName), `Client bundle ${file} must never reference ${secretName}`);
      }
      assert(!/AIzaSy[A-Za-z0-9_-]{20,}/.test(content), `Client bundle ${file} must never contain a hardcoded Gemini key`);
      assert(!/https:\/\/api\.telegram\.org\/bot\d+:/.test(content), `Client bundle ${file} must never contain a Telegram bot token`);
    }
    console.log(`✓ Test 4 passed: Verified ${assetFiles.length} built client bundle file(s) contain zero server secrets`);
  } else {
    console.log('ℹ Skipping Test 4 (dist/assets not built yet — run after vite build)');
  }

  console.log('=== All Secret Redaction & Exposure Audit Checks Passed ===');
}

runAudit().catch((err) => {
  console.error('Audit test failed:', err);
  process.exit(1);
});
