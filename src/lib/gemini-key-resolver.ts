import { redactApiKey } from './apiKeys.js';
import { createHash } from 'crypto';

export interface GeminiKeyResolutionResult {
  userId: string;
  watcherId: string;
  keySource: 'user_api_keys' | 'NONE';
  keyPresent: boolean;
  keyRedacted: string;
  keyFingerprint: string;
  apiKey: string | null;
  status: 'RESOLVED' | 'MISSING_KEY';
}

/**
 * Computes a safe 8-character SHA-256 fingerprint of an API key for safe diagnostics.
 * Never exposes any characters of the actual key.
 */
export function computeKeyFingerprint(key: string | null | undefined): string {
  if (!key) return 'NONE';
  const trimmed = key.trim();
  if (!trimmed) return 'NONE';
  try {
    return createHash('sha256').update(trimmed).digest('hex').substring(0, 8);
  } catch {
    return 'HASH_ERR';
  }
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
        .order('created_at', { ascending: false })
        .limit(1)
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
  const keyFingerprint = computeKeyFingerprint(rawKey);
  const status = keyPresent ? 'RESOLVED' : 'MISSING_KEY';

  const userEmail = context?.userEmail || 'unknown';
  const pair = context?.pair || 'unknown';
  const timeframe = context?.timeframe || 'unknown';

  console.log(`[Gemini Key Resolution]
User ID: ${userId}
User Email: ${userEmail}
Watcher: ${watcherId}
Pair: ${pair}
Timeframe: ${timeframe}
Key Source: ${keySource}
Key Fingerprint: ${keyFingerprint}
Key Present: ${keyPresent ? 'YES' : 'NO'}
Key Redacted: ${keyRedacted}
Status: ${status}`);

  return {
    userId,
    watcherId,
    keySource,
    keyPresent,
    keyRedacted,
    keyFingerprint,
    apiKey: rawKey,
    status
  };
}

export interface GeminiQuotaDetails {
  quotaType: 'QUOTA_RPM' | 'QUOTA_TPM' | 'QUOTA_RPD' | 'QUOTA_UNKNOWN';
  quotaMetric?: string;
  quotaId?: string;
  retryDelaySeconds?: number;
}

export interface GeminiErrorClassification {
  profileStatus: 'INVALID_KEY' | 'QUOTA_EXHAUSTED' | 'TEMP_ERROR' | 'NEEDS_ATTENTION';
  diagnosticStatus: 'INVALID_KEY' | 'QUOTA_RPM' | 'QUOTA_TPM' | 'QUOTA_RPD' | 'QUOTA_UNKNOWN' | 'TIMEOUT' | 'TEMPORARY_ERROR' | 'INVALID_REQUEST' | 'PERMISSION_ERROR' | 'API_ERROR';
  cleanErrorMessage: string;
  is503: boolean;
  isTimeout: boolean;
  isQuota: boolean;
  quotaDetails?: GeminiQuotaDetails;
}

/**
 * Extracts structured quota violation details (metric, quotaId, retryDelay, quotaType) from error objects or raw message text.
 */
export function parseQuotaDetails(error: any, lowerMsg: string): GeminiQuotaDetails {
  let quotaMetric: string | undefined;
  let quotaId: string | undefined;
  let retryDelaySeconds: number | undefined;

  const metricMatch = lowerMsg.match(/quota metric ['"]?([a-z0-9_./-]+)['"]?/i) || lowerMsg.match(/metric:?\s*['"]?([a-z0-9_./-]+)['"]?/i);
  if (metricMatch) {
    quotaMetric = metricMatch[1];
  }

  const idMatch = lowerMsg.match(/quota id ['"]?([a-z0-9_./-]+)['"]?/i) || lowerMsg.match(/quotaid:?\s*['"]?([a-z0-9_./-]+)['"]?/i);
  if (idMatch) {
    quotaId = idMatch[1];
  }

  const retryMatch = lowerMsg.match(/retry after\s*(\d+)/i) || lowerMsg.match(/retrydelay:?\s*(\d+)/i) || lowerMsg.match(/retryin:?\s*(\d+)/i);
  if (retryMatch) {
    retryDelaySeconds = parseInt(retryMatch[1], 10);
  }

  const isPerDay = lowerMsg.includes('perday') || lowerMsg.includes('per_day') || lowerMsg.includes('daily') || (quotaId && quotaId.toLowerCase().includes('perday')) || (quotaMetric && quotaMetric.toLowerCase().includes('daily'));
  const isTpm = lowerMsg.includes('token') || lowerMsg.includes('tpm') || (quotaMetric && quotaMetric.toLowerCase().includes('token'));
  const isRpm = lowerMsg.includes('request') || lowerMsg.includes('rpm') || lowerMsg.includes('minute') || (quotaId && quotaId.toLowerCase().includes('minute')) || (quotaMetric && quotaMetric.toLowerCase().includes('request'));

  let quotaType: 'QUOTA_RPM' | 'QUOTA_TPM' | 'QUOTA_RPD' | 'QUOTA_UNKNOWN' = 'QUOTA_UNKNOWN';
  if (isPerDay) {
    quotaType = 'QUOTA_RPD';
  } else if (isTpm) {
    quotaType = 'QUOTA_TPM';
  } else if (isRpm) {
    quotaType = 'QUOTA_RPM';
  }

  return {
    quotaType,
    quotaMetric,
    quotaId,
    retryDelaySeconds
  };
}

/**
 * Classifies Gemini API error responses into user profile status and diagnostic status,
 * ensuring all API keys in error strings are redacted.
 */
export function classifyAndRedactGeminiError(error: any): GeminiErrorClassification {
  const rawMsg = error?.message || String(error);
  const cleanMsg = redactApiKeyInText(rawMsg);
  const errStatus = error?.status || error?.statusCode || (error?.code ? Number(error.code) : 0);
  const lowerMsg = cleanMsg.toLowerCase();

  let profileStatus: 'INVALID_KEY' | 'QUOTA_EXHAUSTED' | 'TEMP_ERROR' | 'NEEDS_ATTENTION' = 'NEEDS_ATTENTION';
  let diagnosticStatus: 'INVALID_KEY' | 'QUOTA_RPM' | 'QUOTA_TPM' | 'QUOTA_RPD' | 'QUOTA_UNKNOWN' | 'TIMEOUT' | 'TEMPORARY_ERROR' | 'INVALID_REQUEST' | 'PERMISSION_ERROR' | 'API_ERROR' = 'API_ERROR';

  const isTimeout = lowerMsg.includes('timeout') || lowerMsg.includes('etimedout') || error?.name === 'TimeoutError' || error?.name === 'AbortError' || lowerMsg.includes('abort');
  const is503 = errStatus === 503 || lowerMsg.includes('503') || lowerMsg.includes('unavailable') || lowerMsg.includes('high demand') || lowerMsg.includes('spikes in demand');
  const isQuota = errStatus === 429 || lowerMsg.includes('429') || lowerMsg.includes('resource_exhausted') || lowerMsg.includes('quota exceeded') || lowerMsg.includes('rate limit') || lowerMsg.includes('retryinfo') || lowerMsg.includes('retrydelay');

  let quotaDetails: GeminiQuotaDetails | undefined;

  if (
    errStatus === 401 ||
    lowerMsg.includes('invalid api key') ||
    lowerMsg.includes('access_token_type_unsupported') ||
    lowerMsg.includes('unauthenticated') ||
    lowerMsg.includes('api_key_invalid')
  ) {
    profileStatus = 'INVALID_KEY';
    diagnosticStatus = 'INVALID_KEY';
  } else if (
    errStatus === 403 ||
    lowerMsg.includes('permission denied') ||
    lowerMsg.includes('forbidden')
  ) {
    profileStatus = 'INVALID_KEY';
    diagnosticStatus = 'PERMISSION_ERROR';
  } else if (
    errStatus === 400 ||
    lowerMsg.includes('invalid argument') ||
    lowerMsg.includes('bad request')
  ) {
    profileStatus = 'NEEDS_ATTENTION';
    diagnosticStatus = 'INVALID_REQUEST';
  } else if (isQuota) {
    profileStatus = 'QUOTA_EXHAUSTED';
    quotaDetails = parseQuotaDetails(error, lowerMsg);
    diagnosticStatus = quotaDetails.quotaType;
  } else if (isTimeout) {
    profileStatus = 'TEMP_ERROR';
    diagnosticStatus = 'TIMEOUT';
  } else if (is503 || errStatus >= 500 || lowerMsg.includes('gateway') || lowerMsg.includes('network')) {
    profileStatus = 'TEMP_ERROR';
    diagnosticStatus = 'TEMPORARY_ERROR';
  } else {
    profileStatus = 'NEEDS_ATTENTION';
    diagnosticStatus = 'API_ERROR';
  }

  return {
    profileStatus,
    diagnosticStatus,
    cleanErrorMessage: cleanMsg,
    is503,
    isTimeout,
    isQuota,
    quotaDetails
  };
}
