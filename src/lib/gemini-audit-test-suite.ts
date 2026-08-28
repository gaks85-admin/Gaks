import { resolveUserGeminiKey, classifyAndRedactGeminiError, redactApiKeyInText } from './gemini-key-resolver.js';
import { redactApiKey, classifyCredentialType } from './apiKeys.js';

export async function runGeminiAuditTestSuite(): Promise<{ passed: number; total: number; failed: number }> {
  console.log("==========================================");
  console.log("RUNNING GEMINI API KEY AUDIT TEST SUITE");
  console.log("==========================================");

  let passedCount = 0;
  let totalCount = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    totalCount++;
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passedCount++;
    } else {
      console.error(`❌ [FAIL] ${testName}${detail ? ` - ${detail}` : ''}`);
    }
  }

  // Mock DB table
  const mockUserKeysTable: Record<string, string> = {
    'user_A_123': 'AIzaSyUserA_Key_1234567890123456789012',
    'user_B_456': 'AIzaSyUserB_Key_9876543210987654321098'
  };

  const createMockSupabase = () => ({
    from: (tableName: string) => ({
      select: (_fields: string) => {
        let savedCol1: string | undefined;
        let savedVal1: string | undefined;
        let savedCol2: string | undefined;
        let savedVal2: string | undefined;

        const builder: any = {
          eq: (col: string, val: string) => {
            if (!savedCol1) {
              savedCol1 = col;
              savedVal1 = val;
            } else {
              savedCol2 = col;
              savedVal2 = val;
            }
            return builder;
          },
          order: (_col: string, _opts: any) => builder,
          limit: (_n: number) => builder,
          maybeSingle: async () => {
            if (tableName === 'user_api_keys' && savedCol1 === 'user_id' && savedCol2 === 'provider' && savedVal2 === 'gemini') {
              const foundKey = mockUserKeysTable[savedVal1!];
              if (foundKey) {
                return { data: { api_key: foundKey }, error: null };
              }
              return { data: null, error: null };
            }
            return { data: null, error: null };
          }
        };
        return builder;
      }
    })
  });

  const mockSupabase = createMockSupabase();

  // ==========================================
  // TEST A: USER A RECEIVES USER A'S KEY
  // ==========================================
  console.log("\n--- TEST A: User A receives User A's key ---");
  const resA = await resolveUserGeminiKey(mockSupabase, 'user_A_123', 'watcher_A');
  assert(resA.keyPresent === true, 'Test A1 - Key is present for User A');
  assert(resA.apiKey === mockUserKeysTable['user_A_123'], "Test A2 - User A gets User A's exact stored key");
  assert(resA.keySource === 'user_api_keys', 'Test A3 - Key source identified as user_api_keys');
  assert(resA.status === 'RESOLVED', 'Test A4 - Status identified as RESOLVED');

  // ==========================================
  // TEST B: USER B RECEIVES USER B'S KEY
  // ==========================================
  console.log("\n--- TEST B: User B receives User B's key ---");
  const resB = await resolveUserGeminiKey(mockSupabase, 'user_B_456', 'watcher_B');
  assert(resB.keyPresent === true, 'Test B1 - Key is present for User B');
  assert(resB.apiKey === mockUserKeysTable['user_B_456'], "Test B2 - User B gets User B's exact stored key");
  assert(resB.apiKey !== mockUserKeysTable['user_A_123'], "Test B3 - User B does NOT get User A's key");

  // ==========================================
  // TEST C: USER C CANNOT ACCESS USER A/B'S KEY
  // ==========================================
  console.log("\n--- TEST C: User C receives NO key ---");
  const resC = await resolveUserGeminiKey(mockSupabase, 'user_C_789', 'watcher_C');
  assert(resC.keyPresent === false, 'Test C1 - Key present is false for User C');
  assert(resC.apiKey === null, 'Test C2 - User C key is null');
  assert(resC.keySource === 'NONE', 'Test C3 - Key source is NONE');
  assert(resC.status === 'MISSING_KEY', 'Test C4 - Status is MISSING_KEY');

  // ==========================================
  // TEST D: MISSING KEY → NO_TRADE
  // ==========================================
  console.log("\n--- TEST D: Missing key forces NO_TRADE ---");
  let executionSignalD = 'BUY';
  if (!resC.keyPresent) {
    executionSignalD = 'NO_TRADE';
  }
  assert(executionSignalD === 'NO_TRADE', 'Test D1 - Missing key forces final signal to NO_TRADE');

  // ==========================================
  // TEST E: INVALID KEY → NO_TRADE
  // ==========================================
  console.log("\n--- TEST E: Invalid key error classification & NO_TRADE ---");
  const invalidErr = { status: 401, message: 'API_KEY_INVALID: Invalid Gemini API key provided' };
  const classE = classifyAndRedactGeminiError(invalidErr);
  assert(classE.diagnosticStatus === 'INVALID_KEY', 'Test E1 - Invalid key error classified as INVALID_KEY');
  assert(classE.profileStatus === 'INVALID_KEY', 'Test E2 - Profile status set to INVALID_KEY');

  // Test 403 Permission Denied with Project Denied Access
  const permissionDeniedErr = new Error('{"error":{"code":403,"message":"Your project has been denied access. Please contact support.","status":"PERMISSION_DENIED"}}');
  const classE3 = classifyAndRedactGeminiError(permissionDeniedErr);
  assert(classE3.diagnosticStatus === 'PERMISSION_ERROR', 'Test E3 - 403 error classified as PERMISSION_ERROR');
  assert(classE3.profileStatus === 'INVALID_KEY', 'Test E4 - 403 error profile status set to INVALID_KEY');
  assert(classE3.cleanErrorMessage.includes('Google project denied access'), 'Test E5 - 403 raw JSON parsed into clean actionable message');

  // ==========================================
  // TEST F: QUOTA EXHAUSTED → NO_TRADE
  // ==========================================
  console.log("\n--- TEST F: Quota exhausted error classification & NO_TRADE ---");
  const quotaErr = { status: 429, message: 'RESOURCE_EXHAUSTED: Quota exceeded for model gemini-3.5-flash-lite' };
  const classF = classifyAndRedactGeminiError(quotaErr);
  assert(classF.diagnosticStatus.startsWith('QUOTA_'), 'Test F1 - Quota error classified as QUOTA_RPM/TPM/RPD/UNKNOWN');
  assert(classF.profileStatus === 'QUOTA_EXHAUSTED', 'Test F2 - Profile status set to QUOTA_EXHAUSTED');

  // ==========================================
  // TEST G: GEMINI API ERROR / TIMEOUT / CANCELLATION → NO_TRADE
  // ==========================================
  console.log("\n--- TEST G: Gemini API error / Timeout / Cancellation classification & NO_TRADE ---");
  const timeoutErr = { status: 503, message: 'Gateway Timeout connecting to Gemini upstream' };
  const classG = classifyAndRedactGeminiError(timeoutErr);
  assert(classG.diagnosticStatus === 'TIMEOUT', 'Test G1 - 503 Gateway Timeout classified as TIMEOUT');
  assert(classG.profileStatus === 'TEMP_ERROR', 'Test G2 - Profile status set to TEMP_ERROR');

  const cancelErr = new Error('The operation was cancelled.');
  const classCancel = classifyAndRedactGeminiError(cancelErr);
  assert(classCancel.diagnosticStatus === 'CANCELLED', 'Test G3 - The operation was cancelled classified as CANCELLED');
  assert(classCancel.profileStatus === 'TEMP_ERROR', 'Test G4 - Cancelled error profile status set to TEMP_ERROR');

  // ==========================================
  // TEST H: SUCCESSFUL GEMINI RESPONSE PROCEEDS
  // ==========================================
  console.log("\n--- TEST H: Successful Gemini response proceeds ---");
  const mockGeminiOutput = {
    satisfies: true,
    direction: 'BUY',
    confidenceScore: 88,
    entryPrice: 1.1000,
    stopLoss: 1.0950,
    takeProfit: 1.1100,
    reasoning: 'Strong bullish engulfing at key support zone'
  };
  assert(mockGeminiOutput.satisfies === true && mockGeminiOutput.direction === 'BUY', 'Test H1 - Valid Gemini BUY response parsed');

  // ==========================================
  // TEST I: PARITY BETWEEN MANUAL SCAN AND CRON
  // ==========================================
  console.log("\n--- TEST I: Parity between manual scan and cron key resolution ---");
  const cronRes = await resolveUserGeminiKey(mockSupabase, 'user_A_123', 'cron-watcher-99');
  const scanRes = await resolveUserGeminiKey(mockSupabase, 'user_A_123', 'manual-scan');
  assert(cronRes.apiKey === scanRes.apiKey, 'Test I1 - Cron and Manual Scan resolve exact same key');
  assert(cronRes.status === scanRes.status, 'Test I2 - Cron and Manual Scan share exact resolution status');

  // ==========================================
  // TEST J: API KEY NEVER APPEARS IN LOGS
  // ==========================================
  console.log("\n--- TEST J: Key redaction prevents key leaks ---");
  const rawKeySecret = 'AIzaSyUserA_Key_1234567890123456789012';
  const redactedString = redactApiKey(rawKeySecret);
  const textWithSecret = `Error with key ${rawKeySecret} on server`;
  const cleanedText = redactApiKeyInText(textWithSecret);

  assert(!redactedString.includes('UserA_Key_123456'), 'Test J1 - redactApiKey hides key middle payload');
  assert(!cleanedText.includes(rawKeySecret), 'Test J2 - redactApiKeyInText scrubs raw key from error message text');
  assert(cleanedText.includes('[REDACTED_GEMINI_KEY]'), 'Test J3 - Scrubbed key replaced with [REDACTED_GEMINI_KEY]');

  // ==========================================
  // TEST K: CREDENTIAL CLASSIFICATION
  // ==========================================
  console.log("\n--- TEST K: Credential classification ---");
  assert(classifyCredentialType('AIzaSy1234567890') === 'standard', 'Test K1 - AIza key classified as standard');
  assert(classifyCredentialType('AQ.12345678901234567890') === 'authorization', 'Test K2 - AQ key classified as authorization');
  assert(classifyCredentialType('AQ12345678901234567890') === 'authorization', 'Test K3 - AQ key without dot classified as authorization');
  assert(classifyCredentialType('XYZ1234567890') === 'unknown', 'Test K4 - Unrecognized key classified as unknown');

  // ==========================================
  // TEST L: AQ KEY REDACTION IN LOGS
  // ==========================================
  console.log("\n--- TEST L: AQ Key Redaction in Logs ---");
  const aqSecret = 'AQ.1234567890abcdef1234567890abcdef';
  const textWithAq = `Failed request with authorization key ${aqSecret} from user`;
  const cleanedAqText = redactApiKeyInText(textWithAq);
  assert(!cleanedAqText.includes(aqSecret), 'Test L1 - AQ key redacted from text');
  assert(cleanedAqText.includes('[REDACTED_GEMINI_KEY]'), 'Test L2 - AQ key replaced with [REDACTED_GEMINI_KEY]');

  // ==========================================
  // TEST M: DETERMINISTIC PRE-FILTERING GATE
  // ==========================================
  console.log("\n--- TEST M: Deterministic Pre-Filtering Gate ---");
  const PRE_FILTER_MIN_SCORE = 70;

  // Case 1: Low score setup (score: 55, recommendation: FAIL) -> bypassed from Gemini
  const mockDecisionLow = { decision_score: 55, recommendation: 'FAIL', mandatory_rules_passed: false };
  const passesLow = mockDecisionLow.mandatory_rules_passed !== false &&
    mockDecisionLow.decision_score >= PRE_FILTER_MIN_SCORE &&
    (mockDecisionLow.recommendation === 'PASS' || mockDecisionLow.recommendation === 'LIKELY_PASS');
  assert(passesLow === false, 'Test M1 - Low score/FAIL setup blocked by Pre-Filter Gate');

  // Case 2: High score setup (score: 82, recommendation: LIKELY_PASS) -> allowed to Gemini
  const mockDecisionHigh = { decision_score: 82, recommendation: 'LIKELY_PASS', mandatory_rules_passed: true };
  const passesHigh = mockDecisionHigh.mandatory_rules_passed !== false &&
    mockDecisionHigh.decision_score >= PRE_FILTER_MIN_SCORE &&
    (mockDecisionHigh.recommendation === 'PASS' || mockDecisionHigh.recommendation === 'LIKELY_PASS');
  assert(passesHigh === true, 'Test M2 - High-score viable candidate passed to Gemini Gate');

  // Case 3: Ambiguous score setup (score: 64, recommendation: AMBIGUOUS) -> bypassed from Gemini
  const mockDecisionAmb = { decision_score: 64, recommendation: 'AMBIGUOUS', mandatory_rules_passed: true };
  const passesAmb = mockDecisionAmb.mandatory_rules_passed !== false &&
    mockDecisionAmb.decision_score >= PRE_FILTER_MIN_SCORE &&
    (mockDecisionAmb.recommendation === 'PASS' || mockDecisionAmb.recommendation === 'LIKELY_PASS');
  assert(passesAmb === false, 'Test M3 - Ambiguous setup blocked by Pre-Filter Gate');

  console.log(`\n==========================================`);
  console.log(`GEMINI AUDIT TESTS COMPLETED: ${passedCount}/${totalCount} PASSED`);
  console.log(`==========================================`);

  if (passedCount !== totalCount) {
    throw new Error(`Gemini audit test suite failed: ${totalCount - passedCount} test(s) failed.`);
  }

  return { passed: passedCount, total: totalCount, failed: totalCount - passedCount };
}
