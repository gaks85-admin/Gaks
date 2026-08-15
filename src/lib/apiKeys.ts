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

export type GeminiTestStatus = 'connected' | 'invalid' | 'quota_exhausted' | 'connection_failed';

export interface GeminiTestResult {
  status: GeminiTestStatus;
  message: string;
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
 * Sends a minimal authenticated Gemini request to test key validity.
 * Does not perform market analysis or consume unnecessary tokens.
 */
export async function testGeminiKey(key: string): Promise<GeminiTestResult> {
  const trimmedKey = key ? key.trim() : '';
  if (!trimmedKey) {
    return {
      status: 'invalid',
      message: '✕ Invalid Gemini API key',
      errorType: 'invalid_key'
    };
  }

  const redacted = redactApiKey(trimmedKey);
  console.log(`[Gemini Test] Testing API Key: ${redacted}`);

  try {
    const ai = new GoogleGenAI({ apiKey: trimmedKey });
    await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: 'ping'
    });
    return {
      status: 'connected',
      message: '✓ Gemini API connected'
    };
  } catch (err: any) {
    const rawMsg = (err?.message || String(err)).toLowerCase();
    const status = err?.status || 0;
    console.error(`[Gemini Test] Failure for key (${redacted}):`, status, rawMsg.slice(0, 100));

    if (
      status === 401 ||
      status === 403 ||
      rawMsg.includes('invalid') ||
      rawMsg.includes('permission denied') ||
      rawMsg.includes('api_key_invalid') ||
      rawMsg.includes('unauthorized')
    ) {
      return {
        status: 'invalid',
        message: '✕ Invalid Gemini API key',
        errorType: 'invalid_key'
      };
    } else if (
      status === 429 ||
      rawMsg.includes('quota') ||
      rawMsg.includes('rate limit') ||
      rawMsg.includes('resource_exhausted')
    ) {
      return {
        status: 'quota_exhausted',
        message: '⚠ Gemini quota exhausted',
        errorType: 'quota_exceeded'
      };
    } else {
      return {
        status: 'connection_failed',
        message: '⚠ Gemini connection failed',
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
 * Saves a new Gemini API key to Supabase.
 * Validates the value before saving. If Supabase persistence fails,
 * returns error and does NOT update state.
 */
export async function saveGeminiKey(key: string): Promise<{ success: boolean; error?: string; status?: GeminiTestStatus }> {
  console.log("[Gemini Save] Function called");
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    return { success: false, error: "API key cannot be empty." };
  }

  try {
    const supabase = await getSupabase();
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      console.warn("[Gemini Save] No session error or session user", sessionError);
      return { success: false, error: "You must be logged in to save API keys." };
    }

    const userId = session.user.id;
    const redactedKey = redactApiKey(trimmedKey);
    console.log(`[Gemini Save] userId = ${userId}, key = ${redactedKey}`);

    // Validate key before saving
    const testRes = await testGeminiKey(trimmedKey);
    if (testRes.status !== 'connected' && testRes.status !== 'quota_exhausted') {
      return {
        success: false,
        error: testRes.message,
        status: testRes.status
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

    console.log(`[Gemini Save] Successfully persisted key ${redactedKey} to Supabase`);

    // Update profiles gemini_status to READY
    await supabase.from('profiles').update({
      gemini_status: 'READY',
      gemini_last_error: null,
      gemini_last_checked: new Date().toISOString(),
      updated_at: new Date().toISOString()
    }).eq('id', userId);

    // Resume all paused watchers
    await supabase.from('watchers').update({ status: 'active', updated_at: new Date().toISOString() }).eq('user_id', userId).eq('status', 'paused');

    return { success: true, status: testRes.status };
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

