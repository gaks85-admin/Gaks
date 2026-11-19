import fs from 'fs';
import { resolveUserGeminiKey } from '../src/lib/gemini-key-resolver.js';
import { checkAndIncrementGeminiBudget, getGeminiBudgetStatus, STRICT_MAX_GEMINI_CALLS_PER_USER_PER_DAY } from '../src/lib/gemini-budget-tracker.js';
import { UserGeminiRateLimiter, executeBoundedGeminiCall } from '../src/lib/geminiWrapper.js';
import { compileStrategy } from '../src/lib/strategy-compiler.js';
import { evaluateDecision } from '../src/lib/decision-engine.js';

function assert(cond: boolean, msg: string) {
  if (!cond) {
    throw new Error(`ASSERTION FAILED: ${msg}`);
  }
}

async function runTests() {
  console.log('=== GEMINI REINTEGRATION & STRICT 10/DAY BUDGET TEST ===');

  // 1. User-provided key isolation (never process.env.GEMINI_API_KEY)
  process.env.GEMINI_API_KEY = 'AIzaSyEnvShouldNeverBeUsedForUserCalls12345';
  const mockDb: Record<string, string> = {
    user_alpha: 'AIzaSyAlphaPersonalKey12345678901234567',
    user_beta: 'AIzaSyBetaPersonalKey98765432109876543'
  };
  const mockSupabaseForKey = {
    from: (table: string) => ({
      select: () => {
        let uid = '';
        const b: any = {
          eq: (c: string, v: string) => { if (c === 'user_id') uid = v; return b; },
          order: () => b,
          limit: () => b,
          maybeSingle: async () => table === 'user_api_keys' && mockDb[uid]
            ? { data: { api_key: mockDb[uid] }, error: null }
            : { data: null, error: null }
        };
        return b;
      }
    })
  };

  const alphaKey = await resolveUserGeminiKey(mockSupabaseForKey, 'user_alpha', 'w1');
  const missingKey = await resolveUserGeminiKey(mockSupabaseForKey, 'user_charlie', 'w2');
  assert(alphaKey.keyPresent && alphaKey.apiKey === mockDb.user_alpha && alphaKey.keySource === 'user_api_keys', 'User A key must come from user_api_keys');
  assert(!missingKey.keyPresent && missingKey.apiKey === null && missingKey.keySource === 'NONE', 'Missing user key must never fall back to process.env.GEMINI_API_KEY');
  console.log('✅ Test 1 Passed: User-provided keys resolved strictly from user_api_keys.');

  // 2. Strict 10 calls/user/day enforcement (DB-backed + DB error in-memory fallback + admin capped at 10)
  assert(STRICT_MAX_GEMINI_CALLS_PER_USER_PER_DAY === 10, 'Strict constant must be 10');
  const failingSupabase = {
    from: () => ({
      select: () => {
        const b: any = {
          eq: () => b,
          maybeSingle: async () => ({ data: null, error: { code: 'PGRST205', message: 'table missing' } })
        };
        return b;
      },
      upsert: async () => ({ error: { code: 'PGRST205', message: 'table missing' } })
    })
  } as any;

  const uidRegular = `reg_${Date.now()}`;
  const uidAdmin = `adm_${Date.now()}`;
  for (let i = 1; i <= 10; i++) {
    const r = await checkAndIncrementGeminiBudget(failingSupabase, uidRegular, 'user@test.com');
    assert(r.allowed === true && r.currentCount === i && r.maxLimit === 10, `Regular user call ${i}/10 should be allowed even when Supabase returns table-missing error`);
  }
  const r11 = await checkAndIncrementGeminiBudget(failingSupabase, uidRegular, 'user@test.com');
  assert(r11.allowed === false && r11.currentCount === 10 && r11.maxLimit === 10, 'Regular user 11th call must be blocked even on DB fallback');
  const statusAfter = await getGeminiBudgetStatus(failingSupabase, uidRegular, 'user@test.com');
  assert(statusAfter.currentCount === 10 && statusAfter.maxLimit === 10, 'getGeminiBudgetStatus must read fallback count correctly');

  for (let i = 1; i <= 10; i++) {
    const a = await checkAndIncrementGeminiBudget(failingSupabase, uidAdmin, 'gaks6535@gmail.com');
    assert(a.allowed === true && a.maxLimit === 10, `Admin user call ${i}/10 should be allowed`);
  }
  const a11 = await checkAndIncrementGeminiBudget(failingSupabase, uidAdmin, 'gaks6535@gmail.com');
  assert(a11.allowed === false && a11.maxLimit === 10, 'Admin user 11th call must also be strictly blocked (max 10/day)');
  console.log('✅ Test 2 Passed: Strict 10 calls/user/day enforced for all users including DB-error fallback.');

  // 3. In-memory rate limiter + bounded execution layer blocks 11th call & 503 retries past 10
  const limiter = new UserGeminiRateLimiter(20, 99);
  const uidBounded = `bnd_${Date.now()}`;
  assert(limiter.canMakeRequest(uidBounded).maxRpd === 10, 'UserGeminiRateLimiter must clamp maxRpd to 10');
  for (let i = 0; i < 10; i++) {
    limiter.recordRequest(uidBounded);
  }
  assert(limiter.canMakeRequest(uidBounded).allowed === false, 'Limiter blocks 11th call');

  let apiInvocationCount = 0;
  const mockAi: any = {
    models: {
      generateContent: async () => {
        apiInvocationCount++;
        return { text: '{"satisfies":true,"direction":"BUY","confidenceScore":85,"reasoning":"ok"}' };
      }
    }
  };
  const uidExec = `exec_${Date.now()}`;
  for (let i = 0; i < 10; i++) {
    const res = await executeBoundedGeminiCall(mockAi, { contents: 'test' }, { userId: uidExec, watcherId: 'w-test' });
    assert(res.success === true, `Call ${i + 1}/10 should succeed`);
  }
  const res11 = await executeBoundedGeminiCall(mockAi, { contents: 'test' }, { userId: uidExec, watcherId: 'w-test' });
  assert(res11.success === false && res11.errorType === 'QUOTA_EXHAUSTED' && apiInvocationCount === 10, '11th call must never invoke ai.models.generateContent');
  console.log('✅ Test 3 Passed: Bounded execution wrapper strictly halts at 10 API calls per user.');

  // 4. Verify market-watcher.ts and scan.ts source gating & mode restoration
  const cronSrc = fs.readFileSync('api/cron/market-watcher.ts', 'utf-8');
  const scanSrc = fs.readFileSync('src/lib/watcher-handlers/scan.ts', 'utf-8');

  assert(cronSrc.includes('MARKET_WATCHER_DECISION_MODE_OVERRIDE: ExecutionMode | null = null;'), 'market-watcher.ts must not override mode to RULE_ONLY');
  assert(scanSrc.includes("MARKET_WATCHER_DECISION_MODE_OVERRIDE: 'RULE_ONLY' | 'HYBRID' | 'AI_ONLY' | null = null;"), 'scan.ts must not override mode to RULE_ONLY');
  assert(!cronSrc.includes('curateZonesWithAI('), 'market-watcher.ts must not burn Gemini calls on pre-tap zone curation');
  assert(cronSrc.includes('hasTappedKeyZone && passesDeterministicGate && !localZoneSetupRejected'), 'market-watcher.ts must gate Gemini strictly on tapped key zone + local rule setup');
  assert(scanSrc.includes('passesDeterministicGate && hasTappedKeyZone && !localZoneSetupRejected'), 'scan.ts must gate Gemini strictly on tapped key zone + local rule setup');
  assert(!scanSrc.includes("executionMode === 'AI_ONLY' || ("), 'scan.ts must not allow AI_ONLY to bypass local rule-based gate');
  assert(cronSrc.includes('checkAndIncrementGeminiBudget(supabase, userId'), 'market-watcher.ts must enforce daily DB budget before Gemini call');
  assert(scanSrc.includes('checkAndIncrementGeminiBudget(supabase, userId'), 'scan.ts must enforce daily DB budget before Gemini call');
  assert(cronSrc.includes("'User-Agent': 'aistudio-build'") && scanSrc.includes("'User-Agent': 'aistudio-build'"), 'GoogleGenAI initialization must include standard User-Agent header');

  // 5. Verify local rule engine rejects untapped zone / weak setup before Gemini
  const strategy = compileStrategy('Enter on bullish order block tap and rejection with BOS');
  const untappedMs: any = {
    trend: 'BULLISH',
    pair: 'GBPUSD',
    timeframe: 'M5',
    zone_status: 'WAITING_FOR_TAP',
    zone_tapped: false,
    bos: true,
    markedZone: { id: 'z1', type: 'BULLISH_ORDER_BLOCK', direction: 'BUY', low: 1.314, high: 1.315, invalidationLevel: 1.313, status: 'WAITING_FOR_TAP' }
  };
  const decUntapped = evaluateDecision(strategy, untappedMs);
  assert(decUntapped.mandatory_rules_passed === false || decUntapped.decision_score < 70, 'Untapped zone must not pass local rule-based setup gate');

  console.log('✅ Test 4 & 5 Passed: Execution gating & HYBRID user-key mode verified.');
  console.log('ALL GEMINI REINTEGRATION & BUDGET TESTS PASSED!');
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
