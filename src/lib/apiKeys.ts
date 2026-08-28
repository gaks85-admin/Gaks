import { GoogleGenAI } from '@google/genai';
import { runGeminiRequest } from './geminiWrapper.js';
import { executeBoundedGeminiCall } from './geminiWrapper.js';
import { sendTelegramMessage } from './telegramWrapper.js';
import { redactApiKeyInText } from './gemini-key-resolver.js';

async function getSupabase() {
  const { supabase } = await import('../supabaseClient.js');
  return supabase;
}

export const GEMINI_API_KEY_URL = 'https://aistudio.google.com/app/apikey';

export interface UserApiKey {
  id?: string;
  user_id: string;
  provider: string;
  api_key: string;
  created_at?: string;
  updated_at?: string;
}

export type CredentialType = 'standard' | 'authorization' | 'unknown';

export function classifyCredentialType(key: string | null | undefined): CredentialType {
  if (!key) return 'unknown';
  const trimmed = key.trim();
  if (trimmed.startsWith('AIza')) return 'standard';
  if (trimmed.startsWith('AQ')) return 'authorization';
  return 'unknown';
}

export type GeminiTestStatus =
  | 'connected'
  | 'invalid'
  | 'quota_exhausted'
  | 'connection_failed'
  | 'permission_denied'
  | 'timeout'
  | 'temporary_error'
  | 'database_error'
  | 'network_error';

export interface GeminiTestResult {
  success: boolean;
  provider: 'gemini';
  credentialType: CredentialType;
  status: GeminiTestStatus;
  code?: string;
  reason?: string;
  message: string;
  model?: string;
  errorType?: string;
  httpStatus?: number;
}

/**
  Redacts API keys for safe logging and UI display.
  Never logs full key content.
 */
export function redactApiKey(key: string | null | undefined): string {
  if (!key) return '[NO_KEY]';
  const trimmed = key.trim();
  if (trimmed.length <= 8) return '[REDACTED]';
  return `${trimmed.slice(0, 4)}...${trimmed.slice(-4)}`;
}

export type ClassifiedErrorType =
  | 'INVALID_REQUEST'
  | 'INVALID_CREDENTIALS'
  | 'PERMISSION_ERROR'
  | 'QUOTA_EXHAUSTED'
  | 'TEMPORARY_ERROR'
  | 'TIMEOUT'
  | 'DATABASE_ERROR'
  | 'NETWORK_ERROR'
  | 'UNKNOWN_ERROR';

export interface ParsedGeminiError {
  status: number;
  code: string;
  reason?: string;
  message: string;
  classifiedError: ClassifiedErrorType;
  testStatus: GeminiTestStatus;
}

/**
 * Safely parses Google Gemini API errors to extract http status, RPC error code, reason, and user message.
 * Maps errors strictly to discrete classifications: 400, 401, 403, 429, 503, TIMEOUT, DATABASE_ERROR, NETWORK_ERROR.
 */
export function parseGeminiError(err: any): ParsedGeminiError {
  let status = err?.status || err?.statusCode || err?.response?.status || 0;
  let code = typeof err?.code === 'string' ? err.code : 'UNKNOWN_ERROR';
  let reason: string | undefined = undefined;
  let rawMessage = typeof err?.message === 'string' ? err.message : String(err || '');

  // Safely unwrap JSON if error message contains serialized JSON response
  const trimmedMsg = rawMessage.trim();
  if (trimmedMsg.startsWith('{') && trimmedMsg.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmedMsg);
      if (parsed?.error) {
        if (parsed.error.code) status = Number(parsed.error.code);
        if (parsed.error.status) code = String(parsed.error.status);
        if (parsed.error.message) rawMessage = String(parsed.error.message);
        if (Array.isArray(parsed.error.details) && parsed.error.details.length > 0) {
          reason = parsed.error.details[0]?.reason;
        }
      }
    } catch {
      // ignore JSON parse error
    }
  }

  const cleanMsg = redactApiKeyInText(rawMessage);
  const lowerMsg = cleanMsg.toLowerCase();

  // Infer status code if not explicitly present
  if (!status) {
    if (code === 'UNAUTHENTICATED' || lowerMsg.includes('unauthenticated') || lowerMsg.includes('oauth') || lowerMsg.includes('access_token_type_unsupported')) {
      status = 401;
    } else if (code === 'PERMISSION_DENIED' || lowerMsg.includes('permission') || lowerMsg.includes('denied access') || lowerMsg.includes('project has been denied')) {
      status = 403;
    } else if (code === 'RESOURCE_EXHAUSTED' || lowerMsg.includes('quota') || lowerMsg.includes('rate limit') || lowerMsg.includes('resource_exhausted')) {
      status = 429;
    } else if (code === 'INVALID_ARGUMENT' || lowerMsg.includes('invalid argument') || lowerMsg.includes('bad request') || lowerMsg.includes('minimum allowed deadline')) {
      status = 400;
    } else if (code === 'UNAVAILABLE' || lowerMsg.includes('503') || lowerMsg.includes('unavailable') || lowerMsg.includes('high demand') || lowerMsg.includes('spikes in demand')) {
      status = 503;
    } else if (code === 'DEADLINE_EXCEEDED' || lowerMsg.includes('504') || lowerMsg.includes('deadline')) {
      status = 504;
    } else if (lowerMsg.includes('timeout') || lowerMsg.includes('timed out') || err?.name === 'TimeoutError' || err?.name === 'AbortError' || lowerMsg.includes('abort')) {
      status = 408;
    }
  }

  let classifiedError: ClassifiedErrorType = 'UNKNOWN_ERROR';
  let testStatus: GeminiTestStatus = 'connection_failed';
  let message = cleanMsg;

  if (status === 400 || lowerMsg.includes('invalid argument') || lowerMsg.includes('bad request') || lowerMsg.includes('minimum allowed deadline')) {
    status = 400;
    classifiedError = 'INVALID_REQUEST';
    testStatus = 'invalid';
    code = 'INVALID_REQUEST';
    message = 'Invalid request configuration or model parameters (400).';
  } else if (status === 401 || lowerMsg.includes('unauthenticated') || lowerMsg.includes('access_token_type_unsupported') || lowerMsg.includes('invalid api key') || lowerMsg.includes('api_key_invalid')) {
    status = 401;
    classifiedError = 'INVALID_CREDENTIALS';
    testStatus = 'invalid';
    code = 'INVALID_CREDENTIALS';
    reason = reason || 'ACCESS_TOKEN_TYPE_UNSUPPORTED';
    message = 'Invalid Gemini API key or credentials (401).';
  } else if (status === 403 || lowerMsg.includes('permission') || lowerMsg.includes('denied access') || lowerMsg.includes('forbidden')) {
    status = 403;
    classifiedError = 'PERMISSION_ERROR';
    testStatus = 'permission_denied';
    code = 'PERMISSION_ERROR';
    if (lowerMsg.includes('denied access') || lowerMsg.includes('project has been denied')) {
      message = 'Google project denied access (403): The project linked to this key has been restricted or lacks Generative Language API access. Please generate a new key in Google AI Studio.';
    } else {
      message = 'Gemini permission denied for this credential (403). Please verify API key permissions.';
    }
  } else if (status === 429 || lowerMsg.includes('quota') || lowerMsg.includes('resource_exhausted') || lowerMsg.includes('rate limit')) {
    status = 429;
    classifiedError = 'QUOTA_EXHAUSTED';
    testStatus = 'quota_exhausted';
    code = 'QUOTA_EXHAUSTED';
    message = 'Gemini API quota has been exhausted (429). Please try again later or check your quota.';
  } else if (status === 503 || status === 504 || lowerMsg.includes('503') || lowerMsg.includes('504') || lowerMsg.includes('unavailable') || lowerMsg.includes('high demand') || lowerMsg.includes('spikes in demand')) {
    status = 503;
    classifiedError = 'TEMPORARY_ERROR';
    testStatus = 'temporary_error';
    code = 'TEMPORARY_ERROR';
    message = 'Gemini service is temporarily unavailable (503). Please retry in a few moments.';
  } else if (status === 408 || lowerMsg.includes('timeout') || lowerMsg.includes('timed out') || err?.name === 'TimeoutError' || err?.name === 'AbortError') {
    status = 408;
    classifiedError = 'TIMEOUT';
    testStatus = 'timeout';
    code = 'TIMEOUT';
    message = 'Gemini request timed out. Please check your network connection and retry.';
  } else if (lowerMsg.includes('database') || lowerMsg.includes('db error') || lowerMsg.includes('persistence') || lowerMsg.includes('user_api_keys')) {
    status = 500;
    classifiedError = 'DATABASE_ERROR';
    testStatus = 'database_error';
    code = 'DATABASE_ERROR';
    message = 'Database error: Failed to persist API key.';
  } else if (lowerMsg.includes('fetch') || lowerMsg.includes('network') || lowerMsg.includes('enotfound') || lowerMsg.includes('econnrefused') || (err?.name === 'TypeError' && lowerMsg.includes('fetch'))) {
    status = 0;
    classifiedError = 'NETWORK_ERROR';
    testStatus = 'network_error';
    code = 'NETWORK_ERROR';
    message = 'Network connection failed. Unable to reach Gemini API.';
  } else {
    classifiedError = 'UNKNOWN_ERROR';
    testStatus = 'connection_failed';
    code = code !== 'UNKNOWN_ERROR' ? code : 'CONNECTION_FAILED';
    message = cleanMsg && cleanMsg.length > 5 && !cleanMsg.includes('failed') ? cleanMsg : 'Gemini connection failed. Please check network and try again.';
  }

  return { status, code, reason, message, classifiedError, testStatus };
}

/**
 * Sends a minimal authenticated Gemini request to test key validity.
 * Standardized to use gemini-3.6-flash.
 * Accepts standard (AIza...) and current authorization (AQ...) credentials.
 * Never logs complete keys. Does not fall back to process.env credentials.
 */
export async function testGeminiKey(key: string, userEmail?: string): Promise<GeminiTestResult> {
  const trimmedKey = key ? key.trim() : '';
  const credentialType = classifyCredentialType(trimmedKey);

  if (!trimmedKey) {
    return {
      success: false,
      provider: 'gemini',
      credentialType: 'unknown',
      status: 'invalid',
      code: 'CREDENTIAL_REQUIRED',
      message: 'Credential required.',
      errorType: 'invalid_key'
    };
  }

  const redacted = redactApiKey(trimmedKey);
  const MODEL_NAME = 'gemini-3.6-flash';

  try {
    const ai = new GoogleGenAI({
      apiKey: trimmedKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });

    const testRes = await executeBoundedGeminiCall(
      ai,
      { model: MODEL_NAME, contents: 'ping', timeoutMs: 9500, apiDeadlineMs: 10000, maxRetriesFor503: 0 },
      { userEmail, watcherId: 'credential-test', requestId: `req_key_test_${Date.now()}` }
    );

    if (!testRes.success) {
      const statusCode = testRes.diagnosticStatus === 'TIMEOUT' ? 408 :
                         testRes.diagnosticStatus === 'PERMISSION_ERROR' ? 403 :
                         testRes.diagnosticStatus === 'INVALID_KEY' ? 401 :
                         testRes.diagnosticStatus === 'INVALID_REQUEST' ? 400 :
                         testRes.diagnosticStatus?.startsWith('QUOTA') ? 429 :
                         testRes.diagnosticStatus?.startsWith('TEMPORARY') ? 503 : 0;
      const parsed = parseGeminiError({
        status: statusCode,
        message: testRes.cleanErrorMessage || 'Credential test failed',
        code: testRes.diagnosticStatus
      });

      console.log(`[Gemini Credential Test]
User: ${userEmail || 'unknown'}
Credential Type: ${credentialType}
Result: FAILED
Status: ${parsed.status}
Code: ${parsed.code}
Reason: ${parsed.reason || 'N/A'}
Model: ${MODEL_NAME}`);

      return {
        success: false,
        provider: 'gemini',
        credentialType,
        status: parsed.testStatus,
        code: parsed.code,
        reason: parsed.reason,
        message: parsed.message,
        model: MODEL_NAME,
        errorType: parsed.classifiedError,
        httpStatus: parsed.status
      };
    }

    console.log(`[Gemini Credential Test]
User: ${userEmail || 'unknown'}
Credential Type: ${credentialType}
Result: SUCCESS
Status: 200
Model: ${MODEL_NAME}`);

    return {
      success: true,
      provider: 'gemini',
      credentialType,
      status: 'connected',
      model: MODEL_NAME,
      message: '✓ Gemini credential verified',
      httpStatus: 200
    };
  } catch (err: any) {
    const parsed = parseGeminiError(err);

    console.log(`[Gemini Credential Test]
User: ${userEmail || 'unknown'}
Credential Type: ${credentialType}
Result: FAILED
Status: ${parsed.status}
Code: ${parsed.code}
Reason: ${parsed.reason || 'N/A'}
Model: ${MODEL_NAME}`);

    return {
      success: false,
      provider: 'gemini',
      credentialType,
      status: parsed.testStatus,
      code: parsed.code,
      reason: parsed.reason,
      message: parsed.message,
      model: MODEL_NAME,
      errorType: parsed.classifiedError,
      httpStatus: parsed.status
    };
  }
}

/**
 * Retrieves the Gemini API key for the currently authenticated user.
 * Returns null if no key is saved or if user is not authenticated.
 */
export async function getGeminiKey(): Promise<string | null> {
  try {
    const supabase = await getSupabase();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      console.warn("getGeminiKey: No active session found", sessionError);
      return null;
    }

    const { data, error } = await supabase
      .from('user_api_keys')
      .select('api_key')
      .eq('user_id', session.user.id)
      .eq('provider', 'gemini')
      .maybeSingle();

    if (error) {
      console.warn("Could not fetch Gemini key from database:", error.message);
      return null;
    }

    if (data && data.api_key) {
      return data.api_key;
    }

    return null;
  } catch (err) {
    console.error("Exception in getGeminiKey:", err);
    return null;
  }
}

export interface SaveGeminiKeyOptions {
  isAlreadyVerified?: boolean;
  verifiedResult?: GeminiTestResult;
}

/**
 * Saves a new Gemini API key to Supabase only if it passes authentication testing.
 * Blocks saving invalid or failing credentials.
 * Avoids redundant Gemini verification when the credential was already verified in the UI.
 * Standardizes to gemini-3.6-flash and logs structured diagnostics with safe metadata only.
 */
export async function saveGeminiKey(
  key: string,
  options?: SaveGeminiKeyOptions
): Promise<{
  success: boolean;
  error?: string;
  status?: GeminiTestStatus;
  testResult?: GeminiTestResult;
  classifiedError?: string;
}> {
  const trimmedKey = key ? key.trim() : '';
  if (!trimmedKey) {
    return { success: false, error: "Credential required." };
  }

  const credentialType = classifyCredentialType(trimmedKey);
  const keyPrefix = trimmedKey.startsWith('AQ') ? 'AQ...' : trimmedKey.startsWith('AIza') ? 'AIza...' : 'OTHER...';
  const keyLength = trimmedKey.length;
  const MODEL_NAME = 'gemini-3.6-flash';

  let userId = 'unknown';
  let userEmail = 'unknown';
  let failureStage: 'START' | 'VERIFY' | 'DB' | 'POSTCHECK' | 'NONE' = 'START';

  try {
    const supabase = await getSupabase();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      console.warn("[Gemini Save] No session error or session user", sessionError);
      return { success: false, error: "You must be logged in to save API keys." };
    }

    userId = session.user.id;
    userEmail = session.user.email || 'unknown';
    const redactedKey = redactApiKey(trimmedKey);

    const isAlreadyVerified = Boolean(
      options?.isAlreadyVerified &&
      options?.verifiedResult &&
      options.verifiedResult.success
    );

    // [SAVE GEMINI START]
    console.log(`[SAVE GEMINI START]
- user ID: ${userId}
- credential type: ${credentialType === 'authorization' ? 'AUTHORIZATION' : credentialType === 'standard' ? 'STANDARD' : 'UNKNOWN'}
- key prefix only: ${keyPrefix}
- key length: ${keyLength}
- verification state: ${isAlreadyVerified ? 'ALREADY_VERIFIED' : 'UNVERIFIED'}`);

    let testRes: GeminiTestResult;

    if (isAlreadyVerified && options?.verifiedResult) {
      testRes = options.verifiedResult;
      // [SAVE GEMINI VERIFY]
      console.log(`[SAVE GEMINI VERIFY]
- model: ${MODEL_NAME}
- verification result: SUCCESS (reused verified state)
- HTTP status if available: 200
- classified error if failed: NONE`);
    } else {
      // Validate credential before saving
      failureStage = 'VERIFY';
      testRes = await testGeminiKey(trimmedKey, userEmail);

      // [SAVE GEMINI VERIFY]
      console.log(`[SAVE GEMINI VERIFY]
- model: ${MODEL_NAME}
- verification result: ${testRes.success ? 'SUCCESS' : 'FAILED'}
- HTTP status if available: ${testRes.httpStatus ?? (testRes.success ? 200 : 'N/A')}
- classified error if failed: ${testRes.success ? 'NONE' : (testRes.errorType || testRes.code || 'UNKNOWN_ERROR')}`);

      if (!testRes.success) {
        failureStage = 'VERIFY';
        console.log(`[SAVE GEMINI END]
- SUCCESS or FAILURE: FAILURE
- exact failure stage: VERIFY`);

        return {
          success: false,
          error: `Save blocked: ${testRes.message}`,
          status: testRes.status,
          testResult: testRes,
          classifiedError: testRes.errorType
        };
      }
    }

    // Database operation
    failureStage = 'DB';
    const { data: existingKey, error: checkError } = await supabase
      .from('user_api_keys')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', 'gemini')
      .maybeSingle();

    if (checkError) {
      console.warn("Could not query existing key, attempting upsert anyway", checkError);
    }

    const dbOpType = existingKey?.id ? 'UPDATE' : 'INSERT';
    const commonFields = {
      api_key: trimmedKey,
      updated_at: new Date().toISOString()
    };

    let result;
    if (existingKey?.id) {
      result = await supabase
        .from('user_api_keys')
        .update(commonFields)
        .eq('id', existingKey.id);
    } else {
      result = await supabase
        .from('user_api_keys')
        .insert({
          user_id: userId,
          provider: 'gemini',
          created_at: new Date().toISOString(),
          ...commonFields
        });
    }

    const dbSuccess = !result.error;
    const redactedDbError = result.error ? redactApiKeyInText(result.error.message) : 'NONE';

    // [SAVE GEMINI DB]
    console.log(`[SAVE GEMINI DB]
- database operation started: ${dbOpType} (user_api_keys)
- database operation success/failure: ${dbSuccess ? 'SUCCESS' : 'FAILURE'}
- database error code/message (redacted): ${redactedDbError}`);

    if (result.error) {
      failureStage = 'DB';
      console.log(`[SAVE GEMINI END]
- SUCCESS or FAILURE: FAILURE
- exact failure stage: DB`);

      const dbErrResult: GeminiTestResult = {
        success: false,
        provider: 'gemini',
        credentialType,
        status: 'database_error',
        code: 'DATABASE_ERROR',
        message: 'Database error: Failed to persist API key.'
      };

      return {
        success: false,
        error: 'Database error: Failed to persist API key.',
        status: 'database_error',
        testResult: dbErrResult,
        classifiedError: 'DATABASE_ERROR'
      };
    }

    console.log(`[Gemini Save] Successfully persisted credential (${redactedKey}) for user ${userEmail}`);

    // Update profiles gemini_status to READY on successful save
    try {
      await supabase.from('profiles').update({
        gemini_status: 'READY',
        gemini_last_error: null,
        updated_at: new Date().toISOString()
      }).eq('id', userId);
    } catch {
      // Profile timestamp update fallback
    }

    // Resume all paused watchers and clear watcher gemini errors
    await supabase.from('watchers').update({
      status: 'active',
      gemini_status: 'READY',
      last_gemini_error: null,
      next_gemini_retry_at: null,
      updated_at: new Date().toISOString()
    }).eq('user_id', userId);

    // [SAVE GEMINI POSTCHECK]
    // A verified key persisted to DB does not perform a redundant second Gemini round-trip
    console.log(`[SAVE GEMINI POSTCHECK]
- whether post-save verification occurs: NO (redundant check bypassed)
- model used: N/A
- result: N/A
- classified error: NONE`);

    failureStage = 'NONE';
    // [SAVE GEMINI END]
    console.log(`[SAVE GEMINI END]
- SUCCESS or FAILURE: SUCCESS
- exact failure stage: NONE`);

    return {
      success: true,
      status: 'connected',
      testResult: {
        success: true,
        provider: 'gemini',
        credentialType,
        status: 'connected',
        model: MODEL_NAME,
        message: '✓ Gemini credential verified',
        httpStatus: 200
      }
    };
  } catch (err: any) {
    const rawErrorMsg = err?.message || String(err);
    const parsed = parseGeminiError(err);
    console.error(`Exception in saveGeminiKey at stage ${failureStage}:`, redactApiKeyInText(rawErrorMsg));

    // [SAVE GEMINI END]
    console.log(`[SAVE GEMINI END]
- SUCCESS or FAILURE: FAILURE
- exact failure stage: ${failureStage}`);

    return {
      success: false,
      error: parsed.message || "Could not save Gemini API key. Please try again.",
      status: parsed.testStatus,
      classifiedError: parsed.classifiedError,
      testResult: {
        success: false,
        provider: 'gemini',
        credentialType,
        status: parsed.testStatus,
        code: parsed.code,
        message: parsed.message
      }
    };
  }
}

/**
 * Updates an existing Gemini API key.
 */
export async function updateGeminiKey(key: string): Promise<{ success: boolean; error?: string }> {
  return saveGeminiKey(key);
}

/**
 * Deletes the saved Gemini API key for the authenticated user.
 */
export async function deleteGeminiKey(): Promise<{ success: boolean; error?: string }> {
  try {
    const supabase = await getSupabase();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      return { success: false, error: "You must be logged in to delete API keys." };
    }

    const userId = session.user.id;

    const { error } = await supabase
      .from('user_api_keys')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'gemini');

    if (error) {
      console.warn("Could not delete API key from database:", error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error("Exception in deleteGeminiKey:", err);
    return { success: false, error: err.message || "An unexpected error occurred." };
  }
}


