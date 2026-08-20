import { runGeminiRequest } from './geminiWrapper.js';
import { GoogleGenAI } from '@google/genai';
import { sendTelegramMessage } from './telegramWrapper.js';

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

export type GeminiTestStatus = 'connected' | 'invalid' | 'quota_exhausted' | 'connection_failed' | 'permission_denied';

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

/**
 * Safely parses Google Gemini API errors to extract http status, RPC error code, reason, and user message.
 */
export function parseGeminiError(err: any): {
  status: number;
  code: string;
  reason?: string;
  message: string;
} {
  let status = err?.status || err?.statusCode || err?.response?.status || 0;
  let code = 'UNKNOWN_ERROR';
  let reason: string | undefined = undefined;
  let rawMessage = typeof err?.message === 'string' ? err.message : String(err || '');

  if (rawMessage.trim().startsWith('{') && rawMessage.trim().endsWith('}')) {
    try {
      const parsed = JSON.parse(rawMessage.trim());
      if (parsed?.error) {
        if (parsed.error.code) status = parsed.error.code;
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

  const lowerMsg = rawMessage.toLowerCase();

  if (!status) {
    if (code === 'UNAUTHENTICATED' || lowerMsg.includes('unauthenticated') || lowerMsg.includes('oauth') || lowerMsg.includes('credential')) status = 401;
    else if (code === 'PERMISSION_DENIED' || lowerMsg.includes('permission')) status = 403;
    else if (code === 'RESOURCE_EXHAUSTED' || lowerMsg.includes('quota') || lowerMsg.includes('rate limit')) status = 429;
    else if (code === 'INVALID_ARGUMENT' || lowerMsg.includes('invalid') || lowerMsg.includes('api_key_invalid')) status = 400;
  }

  let message = rawMessage;
  if (status === 401) {
    code = code !== 'UNKNOWN_ERROR' ? code : 'UNAUTHENTICATED';
    reason = reason || 'ACCESS_TOKEN_TYPE_UNSUPPORTED';
    message = 'Gemini rejected this authorization credential.';
  } else if (status === 400 || lowerMsg.includes('invalid api key') || lowerMsg.includes('api_key_invalid')) {
    code = 'INVALID_ARGUMENT';
    reason = reason || 'API_KEY_INVALID';
    message = 'Invalid Gemini API key.';
  } else if (status === 403) {
    code = code !== 'UNKNOWN_ERROR' ? code : 'PERMISSION_DENIED';
    message = 'Gemini permission denied for this credential.';
  } else if (status === 429) {
    code = 'RESOURCE_EXHAUSTED';
    message = 'Gemini API quota has been exhausted.';
  }

  return { status, code, reason, message };
}

/**
 * Sends a minimal authenticated Gemini request to test key validity.
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

  try {
    const ai = new GoogleGenAI({
      apiKey: trimmedKey,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build'
        }
      }
    });
    await ai.models.generateContent({
      model: 'gemini-3.5-flash-lite',
      contents: 'ping'
    });

    console.log(`[Gemini Credential Test]
User: ${userEmail || 'unknown'}
Credential Type: ${credentialType}
Result: SUCCESS
Status: 200
Model: gemini-3.5-flash-lite`);

    return {
      success: true,
      provider: 'gemini',
      credentialType,
      status: 'connected',
      model: 'gemini-3.5-flash-lite',
      message: '✓ Gemini credential verified'
    };
  } catch (err: any) {
    const parsed = parseGeminiError(err);

    console.log(`[Gemini Credential Test]
User: ${userEmail || 'unknown'}
Credential Type: ${credentialType}
Result: FAILED
Status: ${parsed.status}
Code: ${parsed.code}
Reason: ${parsed.reason || 'N/A'}`);

    if (parsed.status === 401 || parsed.status === 400) {
      return {
        success: false,
        provider: 'gemini',
        credentialType,
        status: 'invalid',
        code: parsed.code,
        reason: parsed.reason,
        message: parsed.message,
        errorType: 'invalid_key'
      };
    } else if (parsed.status === 403) {
      return {
        success: false,
        provider: 'gemini',
        credentialType,
        status: 'permission_denied',
        code: parsed.code,
        reason: parsed.reason,
        message: parsed.message,
        errorType: 'permission_denied'
      };
    } else if (parsed.status === 429) {
      return {
        success: false,
        provider: 'gemini',
        credentialType,
        status: 'quota_exhausted',
        code: 'RESOURCE_EXHAUSTED',
        reason: parsed.reason || 'RATE_LIMIT_EXCEEDED',
        message: 'Gemini API quota has been exhausted.',
        errorType: 'quota_exceeded'
      };
    } else {
      return {
        success: false,
        provider: 'gemini',
        credentialType,
        status: 'connection_failed',
        code: parsed.code,
        reason: parsed.reason,
        message: '⚠ Gemini connection failed.',
        errorType: 'temporary_failure'
      };
    }
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

/**
 * Saves a new Gemini API key to Supabase only if it passes authentication testing.
 * Blocks saving invalid or failing credentials.
 */
export async function saveGeminiKey(key: string): Promise<{
  success: boolean;
  error?: string;
  status?: GeminiTestStatus;
  testResult?: GeminiTestResult;
}> {
  console.log("[Gemini Save] Function called");
  const trimmedKey = key ? key.trim() : '';
  if (!trimmedKey) {
    return { success: false, error: "Credential required." };
  }

  try {
    const supabase = await getSupabase();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      console.warn("[Gemini Save] No session error or session user", sessionError);
      return { success: false, error: "You must be logged in to save API keys." };
    }

    const userId = session.user.id;
    const userEmail = session.user.email || 'unknown';
    const redactedKey = redactApiKey(trimmedKey);

    // Validate credential before saving
    const testRes = await testGeminiKey(trimmedKey, userEmail);

    if (!testRes.success) {
      console.warn(`[Gemini Save] Save blocked for user ${userId} (${userEmail}) due to failed verification: ${testRes.message}`);
      return {
        success: false,
        error: `Save blocked: ${testRes.message}`,
        status: testRes.status,
        testResult: testRes
      };
    }

    // Check if key already exists
    const { data: existingKey, error: checkError } = await supabase
      .from('user_api_keys')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', 'gemini')
      .maybeSingle();

    if (checkError) {
      console.warn("Could not query existing key, attempting upsert anyway", checkError);
    }

    let result;
    const commonFields = {
      api_key: trimmedKey,
      updated_at: new Date().toISOString()
    };

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

    if (result.error) {
      console.error("[Gemini Save] Persistence failed:", result.error.message);
      return {
        success: false,
        error: "Could not save Gemini API key. Please try again."
      };
    }

    console.log(`[Gemini Save] Successfully persisted credential (${redactedKey}) for user ${userEmail}`);

    // Update profiles gemini_status safely if supported
    try {
      await supabase.from('profiles').update({
        updated_at: new Date().toISOString()
      }).eq('id', userId);
    } catch {
      // Profile timestamp update fallback
    }

    // Resume all paused watchers
    await supabase.from('watchers').update({ status: 'active', updated_at: new Date().toISOString() }).eq('user_id', userId).eq('status', 'paused');

    return {
      success: true,
      status: testRes.status,
      testResult: testRes
    };
  } catch (err: any) {
    console.error("Exception in saveGeminiKey:", err);
    return { success: false, error: "Could not save Gemini API key. Please try again." };
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


