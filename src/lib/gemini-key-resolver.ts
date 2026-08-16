import { redactApiKey } from './apiKeys.js';

export interface GeminiKeyResolutionResult {
  userId: string;
  watcherId: string;
  keySource: 'user_api_keys' | 'NONE';
  keyPresent: boolean;
  keyRedacted: string;
  apiKey: string | null;
  status: 'RESOLVED' | 'MISSING_KEY';
}

/**
 * Redacts any embedded Gemini API key (e.g. AIzaSy... or AQ...) inside arbitrary text or error messages.
 */
export function redactApiKeyInText(text: string | null | undefined): string {
  if (!text) return '';
  return text
    .replace(/AIzaSy[A-Za-z0-9_-]{20,60}/g, '[REDACTED_GEMINI_KEY]')
    .replace(/AQ\.[A-Za-z0-9_-]{10,120}/g, '[REDACTED_GEMINI_KEY]')
    .replace(/AQ[A-Za-z0-9_-]{10,120}/g, '[REDACTED_GEMINI_KEY]');
}

/**
 * Resolves the Gemini API key authoritatively for a specific user from Supabase user_api_keys table.
 * Strictly NEVER falls back to process.env.GEMINI_API_KEY for user execution.
 * Prints structured diagnostics safely without exposing full keys.
 */
export async function resolveUserGeminiKey(
  supabase: any,
  userId: string,
  watcherId: string = 'manual-scan',
  context?: { userEmail?: string; pair?: string; timeframe?: string }
): Promise<GeminiKeyResolutionResult> {
  let rawKey: string | null = null;

  if (supabase && userId) {
    try {
      const { data: keyRecord, error } = await supabase
        .from('user_api_keys')
        .select('api_key')
        .eq('user_id', userId)
        .eq('provider', 'gemini')
        .maybeSingle();

      if (!error && keyRecord && keyRecord.api_key) {
        rawKey = String(keyRecord.api_key).trim();
      }
    } catch (err) {
      console.error(`[Gemini Key Resolution] DB query exception for user ${userId}:`, err);
    }
  }

  const keyPresent = !!rawKey;
  const keySource = keyPresent ? 'user_api_keys' : 'NONE';
  const keyRedacted = redactApiKey(rawKey);
  const status = keyPresent ? 'RESOLVED' : 'MISSING_KEY';

  const userEmail = context?.userEmail || 'unknown';
  const pair = context?.pair || 'unknown';
  const timeframe = context?.timeframe || 'unknown';

  console.log(`[Gemini Key Resolution]
User: ${userEmail}
Watcher: ${watcherId}
Pair: ${pair}
Timeframe: ${timeframe}
Key Source: ${keySource}
Key Present: ${keyPresent ? 'YES' : 'NO'}
Key Redacted: ${keyRedacted}
Status: ${status}`);

  return {
    userId,
    watcherId,
    keySource,
    keyPresent,
    keyRedacted,
    apiKey: rawKey,
    status
  };
}

export interface GeminiErrorClassification {
  profileStatus: 'INVALID_KEY' | 'QUOTA_EXHAUSTED' | 'TEMP_ERROR' | 'NEEDS_ATTENTION';
  diagnosticStatus: 'INVALID_KEY' | 'QUOTA_EXHAUSTED' | 'TIMEOUT' | 'API_ERROR';
  cleanErrorMessage: string;
}

/**
 * Classifies Gemini API error responses into user profile status and diagnostic status,
 * ensuring all API keys in error strings are redacted.
 */
export function classifyAndRedactGeminiError(error: any): GeminiErrorClassification {
  const rawMsg = error?.message || String(error);
  const cleanMsg = redactApiKeyInText(rawMsg);
  const errStatus = error?.status || 0;
  const lowerMsg = cleanMsg.toLowerCase();

  let profileStatus: 'INVALID_KEY' | 'QUOTA_EXHAUSTED' | 'TEMP_ERROR' | 'NEEDS_ATTENTION' = 'NEEDS_ATTENTION';
  let diagnosticStatus: 'INVALID_KEY' | 'QUOTA_EXHAUSTED' | 'TIMEOUT' | 'API_ERROR' = 'API_ERROR';

  if (
    errStatus === 401 ||
    errStatus === 403 ||
    lowerMsg.includes('invalid api key') ||
    lowerMsg.includes('permission denied') ||
    lowerMsg.includes('access_token_type_unsupported') ||
    lowerMsg.includes('unauthenticated') ||
    lowerMsg.includes('invalid') ||
    lowerMsg.includes('unauthorized') ||
    lowerMsg.includes('api_key_invalid')
  ) {
    profileStatus = 'INVALID_KEY';
    diagnosticStatus = 'INVALID_KEY';
  } else if (
    errStatus === 429 ||
    lowerMsg.includes('resource_exhausted') ||
    lowerMsg.includes('quota exceeded') ||
    lowerMsg.includes('rate limit') ||
    lowerMsg.includes('retryinfo') ||
    lowerMsg.includes('retrydelay')
  ) {
    profileStatus = 'QUOTA_EXHAUSTED';
    diagnosticStatus = 'QUOTA_EXHAUSTED';
  } else if (
    errStatus >= 500 ||
    errStatus === 503 ||
    lowerMsg.includes('timeout') ||
    lowerMsg.includes('gateway') ||
    lowerMsg.includes('network')
  ) {
    profileStatus = 'TEMP_ERROR';
    diagnosticStatus = 'TIMEOUT';
  } else {
    profileStatus = 'NEEDS_ATTENTION';
    diagnosticStatus = 'API_ERROR';
  }

  return {
    profileStatus,
    diagnosticStatus,
    cleanErrorMessage: cleanMsg
  };
}
