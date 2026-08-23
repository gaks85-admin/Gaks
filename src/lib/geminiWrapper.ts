import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { sendTelegramMessage } from './telegramWrapper.js';
import { resolveUserGeminiKey, classifyAndRedactGeminiError, GeminiQuotaDetails, redactApiKeyInText } from './gemini-key-resolver.js';

// Simplified Error Classification
export type GeminiErrorType = 'invalid_key' | 'quota_exceeded' | 'rate_limited' | 'temporary_failure' | 'unknown_error';

export class UserGeminiRateLimiter {
  private requestsMap = new Map<string, number[]>();
  private maxRpm: number;

  constructor(maxRpm: number = Number(process.env.MAX_GEMINI_RPM_PER_USER) || 10) {
    this.maxRpm = maxRpm;
  }

  public canMakeRequest(userId: string): { allowed: boolean; currentRpm: number; maxRpm: number } {
    if (!userId) return { allowed: true, currentRpm: 0, maxRpm: this.maxRpm };
    const now = Date.now();
    const windowStart = now - 60000;
    const userTimestamps = (this.requestsMap.get(userId) || []).filter(ts => ts > windowStart);
    this.requestsMap.set(userId, userTimestamps);

    if (userTimestamps.length >= this.maxRpm) {
      return { allowed: false, currentRpm: userTimestamps.length, maxRpm: this.maxRpm };
    }
    return { allowed: true, currentRpm: userTimestamps.length, maxRpm: this.maxRpm };
  }

  public recordRequest(userId: string): void {
    if (!userId) return;
    const now = Date.now();
    const windowStart = now - 60000;
    const userTimestamps = (this.requestsMap.get(userId) || []).filter(ts => ts > windowStart);
    userTimestamps.push(now);
    this.requestsMap.set(userId, userTimestamps);
  }
}

export const globalUserGeminiRateLimiter = new UserGeminiRateLimiter();

export function classifyGeminiError(error: any): GeminiErrorType {
    const { diagnosticStatus } = classifyAndRedactGeminiError(error);
    if (diagnosticStatus === 'INVALID_KEY' || diagnosticStatus === 'PERMISSION_ERROR') return 'invalid_key';
    if (diagnosticStatus.startsWith('QUOTA_')) return 'quota_exceeded';
    if (diagnosticStatus === 'TIMEOUT' || diagnosticStatus === 'TEMPORARY_ERROR') return 'temporary_failure';
    return 'unknown_error';
}

export interface BoundedGeminiOptions {
  model?: string;
  contents: string;
  config?: any;
  timeoutMs?: number; // default 8000ms
  maxRetriesFor503?: number; // default 1 (max 2 attempts total)
  backoffMsFor503?: number; // default 500ms
  remainingGlobalBudgetMs?: number; // remaining ms in global cron deadline
}

export interface BoundedGeminiResult {
  success: boolean;
  text?: string;
  errorType?: 'TIMEOUT' | 'TEMPORARY_ERROR' | 'QUOTA_EXHAUSTED' | 'INVALID_CREDENTIALS' | 'PERMISSION_ERROR' | 'INVALID_REQUEST' | 'UNKNOWN_ERROR';
  diagnosticStatus?: string;
  quotaDetails?: GeminiQuotaDetails;
  cleanErrorMessage?: string;
  attemptsExecuted: number;
  durationMs: number;
  retried: boolean;
}

/**
 * Bounded execution layer for Gemini AI requests.
 * Enforces per-user rate limiting, hard timeouts (8,000ms configurable),
 * 503 single retry with backoff and global deadline check,
 * 429 quota handling without retry, fail closed, and structured logging.
 */
export interface BoundedGeminiContext {
  userId?: string;
  userEmail?: string;
  watcherId?: string;
  pair?: string;
  timeframe?: string;
  keySource?: string;
  requestId?: string;
}

function extractQuotaModelFromError(err: any): string {
  const msg = err?.message || String(err);
  const match = msg.match(/(?:models\/|model\s+)?(gemini-[a-zA-Z0-9_.-]+)/i);
  return match ? match[1] : 'NOT_SPECIFIED_IN_ERROR_RESPONSE';
}

/**
 * Bounded execution layer for Gemini AI requests.
 * Enforces per-user rate limiting,
 * 503 single retry with backoff and global deadline check,
 * 429 quota handling without retry, fail closed, and structured logging.
 */
export async function executeBoundedGeminiCall(
  ai: GoogleGenAI,
  options: BoundedGeminiOptions,
  context: BoundedGeminiContext
): Promise<BoundedGeminiResult> {
  const model = options.model || 'gemini-3.5-flash-lite';
  const timeoutMs = options.timeoutMs ?? 12000;
  const maxRetriesFor503 = options.maxRetriesFor503 ?? 1;
  const backoffMs = options.backoffMsFor503 ?? 500;

  const userStr = context.userId || context.userEmail || 'unknown';
  const watcherStr = context.watcherId || 'unknown';
  const pairStr = context.pair || 'unknown';
  const timeframeStr = context.timeframe || 'unknown';
  const keySourceStr = context.keySource || 'user_api_keys';

  // Check per-user rate limiter before executing
  if (context.userId) {
    const limitCheck = globalUserGeminiRateLimiter.canMakeRequest(context.userId);
    if (!limitCheck.allowed) {
      console.log(`[GEMINI RATE LIMIT SKIPPED]
User ID: ${userStr}
Watcher ID: ${watcherStr}
Pair: ${pairStr}
Timeframe: ${timeframeStr}
Model: ${model}
Action: SKIPPED (Application Per-User Rate Limit Threshold Reached)
Current RPM: ${limitCheck.currentRpm} / Max Allowed: ${limitCheck.maxRpm}`);

      return {
        success: false,
        errorType: 'QUOTA_EXHAUSTED',
        diagnosticStatus: 'QUOTA_RPM',
        cleanErrorMessage: `Application per-user Gemini rate limit safety threshold reached (${limitCheck.currentRpm}/${limitCheck.maxRpm} RPM)`,
        attemptsExecuted: 0,
        durationMs: 0,
        retried: false
      };
    }
  }

  let attempt = 0;
  let retried = false;
  const startTime = Date.now();

  while (attempt <= maxRetriesFor503) {
    attempt++;
    if (attempt > 1) {
      retried = true;
    }
    const attemptStart = Date.now();

    if (context.userId) {
      globalUserGeminiRateLimiter.recordRequest(context.userId);
    }

    // Pre-flight check: ensure remaining global cron budget allows execution
    const elapsedSoFar = Date.now() - startTime;
    const remainingGlobalBudget = options.remainingGlobalBudgetMs !== undefined
      ? options.remainingGlobalBudgetMs - elapsedSoFar
      : 25000;

    if (remainingGlobalBudget <= 250) {
      console.log(`[GEMINI SKIP]
User ID: ${userStr}
Watcher ID: ${watcherStr}
Pair: ${pairStr}
Timeframe: ${timeframeStr}
Reason: Insufficient global cron budget remaining (${remainingGlobalBudget}ms <= 250ms required threshold)`);

      return {
        success: false,
        errorType: 'TIMEOUT',
        diagnosticStatus: 'CRON_DEADLINE',
        cleanErrorMessage: `Insufficient remaining global cron budget (${remainingGlobalBudget}ms) to safely execute Gemini request`,
        attemptsExecuted: Math.max(0, attempt - 1),
        durationMs: Date.now() - startTime,
        retried
      };
    }

    const effectiveTimeoutMs = Math.min(options.timeoutMs ?? 8000, remainingGlobalBudget - 250);
    const requestStartIso = new Date(attemptStart).toISOString();

    console.log(`[GEMINI MODEL TRACE] model=${model} keySource=${keySourceStr} watcher=${watcherStr} user=${userStr} startTimestamp=${requestStartIso}`);

    console.log(`[GEMINI REQUEST]
User ID: ${userStr}
Watcher ID: ${watcherStr}
Pair: ${pairStr}
Timeframe: ${timeframeStr}
Model: ${model}
Effective Timeout: ${effectiveTimeoutMs}ms
Remaining Cron Budget: ${remainingGlobalBudget}ms
Request Start Timestamp: ${requestStartIso}`);

    const controller = new AbortController();
    let timeoutTimer: NodeJS.Timeout | null = null;

    let fetchPromise: Promise<any>;
    try {
      const mergedConfig = {
        ...(options.config || {}),
        abortSignal: controller.signal,
        signal: controller.signal
      };

      fetchPromise = ai.models.generateContent({
        model: model,
        contents: options.contents,
        config: mergedConfig
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          controller.abort();
          const err = new Error(`Gemini request timed out after ${effectiveTimeoutMs}ms`);
          err.name = 'TimeoutError';
          reject(err);
        }, effectiveTimeoutMs);
      });

      const aiResponse = await Promise.race([fetchPromise, timeoutPromise]);
      if (timeoutTimer) clearTimeout(timeoutTimer);

      const totalDuration = Date.now() - startTime;

      let rawText = '';
      if (typeof (aiResponse as any)?.text === 'function') {
        rawText = await (aiResponse as any).text();
      } else if (typeof aiResponse?.text === 'string') {
        rawText = aiResponse.text;
      } else {
        rawText = (aiResponse as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      }

      console.log(`[GEMINI SUCCESS]
User ID: ${userStr}
Watcher ID: ${watcherStr}
Pair: ${pairStr}
Timeframe: ${timeframeStr}
Model: ${model}
Duration: ${totalDuration}ms
503 Retry Required: ${retried ? 'YES' : 'NO'}`);

      return {
        success: true,
        text: rawText,
        diagnosticStatus: 'SUCCESS',
        attemptsExecuted: attempt,
        durationMs: totalDuration,
        retried
      };

    } catch (err: any) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const totalDuration = Date.now() - startTime;
      const { diagnosticStatus, cleanErrorMessage, is503, isTimeout, isQuota, quotaDetails } = classifyAndRedactGeminiError(err);

      // 1. TIMEOUT
      if (isTimeout || err?.name === 'TimeoutError' || err?.name === 'AbortError' || diagnosticStatus === 'TIMEOUT') {
        const remainingBudget = options.remainingGlobalBudgetMs
          ? `${options.remainingGlobalBudgetMs - totalDuration}ms`
          : 'unknown';
        const requestEndIso = new Date().toISOString();

        console.log(`[GEMINI TIMEOUT TRACE]
Requested model: ${model}
Timeout duration: ${effectiveTimeoutMs}ms
Request Start Time: ${requestStartIso}
Request End Time: ${requestEndIso}
Timeout Source: Application Promise.race timeout (${effectiveTimeoutMs}ms limit reached)`);

        console.log(`[GEMINI TIMEOUT]
User ID: ${userStr}
Watcher ID: ${watcherStr}
Timeout: ${effectiveTimeoutMs}ms
Remaining Cron Budget: ${remainingBudget}`);

        if (fetchPromise!) {
          fetchPromise
            .then(() => {
              console.log(`[GEMINI LATE RESOLUTION AFTER TIMEOUT] Requested model: ${model} | Watcher ID: ${watcherStr} | Resolved after application timeout (${Date.now() - attemptStart}ms)`);
            })
            .catch((lateErr: any) => {
              const lateClean = redactApiKeyInText(lateErr?.message || String(lateErr));
              console.log(`[GEMINI LATE REJECTION AFTER TIMEOUT] Requested model: ${model} | Watcher ID: ${watcherStr} | Late Error: ${lateClean} (${Date.now() - attemptStart}ms)`);
            });
        }

        return {
          success: false,
          errorType: 'TIMEOUT',
          diagnosticStatus: 'TIMEOUT',
          cleanErrorMessage: cleanErrorMessage || `Gemini request timed out after ${effectiveTimeoutMs}ms`,
          attemptsExecuted: attempt,
          durationMs: totalDuration,
          retried
        };
      }

      // 2. 429 / QUOTA_EXHAUSTED: DO NOT RETRY IMMEDIATELY.
      if (isQuota || diagnosticStatus.startsWith('QUOTA_')) {
        const reportedQuotaModel = extractQuotaModelFromError(err);
        console.log(`[GEMINI QUOTA EXHAUSTED TRACE]
Requested model: ${model}
Quota model: ${reportedQuotaModel}
User ID: ${userStr}
Watcher ID: ${watcherStr}
Status: ${diagnosticStatus}
Clean Error: ${cleanErrorMessage}`);

        console.log(`[GEMINI QUOTA]
User ID: ${userStr}
Watcher ID: ${watcherStr}
Status: ${diagnosticStatus}
Action: USER_QUOTA_CIRCUIT_OPEN`);

        return {
          success: false,
          errorType: 'QUOTA_EXHAUSTED',
          diagnosticStatus,
          quotaDetails,
          cleanErrorMessage: cleanErrorMessage || 'Quota exceeded or rate limit reached (429)',
          attemptsExecuted: attempt,
          durationMs: totalDuration,
          retried
        };
      }

      // 3. 503 / UNAVAILABLE / TEMPORARY_ERROR: At most 1 retry if global deadline permits
      if (is503 || diagnosticStatus === 'TEMPORARY_ERROR') {
        if (attempt <= maxRetriesFor503) {
          const elapsedSoFar = Date.now() - startTime;
          const remainingBudget = (options.remainingGlobalBudgetMs ?? 25000) - elapsedSoFar;
          if (remainingBudget < (backoffMs + timeoutMs)) {
            console.log(`[GEMINI 503] User ID: ${userStr}, Watcher ID: ${watcherStr}, Pair: ${pairStr}, Timeframe: ${timeframeStr}. Action: SKIP RETRY (Insufficient global budget remaining: ${remainingBudget}ms < ${backoffMs + timeoutMs}ms needed)`);

            return {
              success: false,
              errorType: 'TEMPORARY_ERROR',
              diagnosticStatus: 'TEMPORARY_503',
              cleanErrorMessage: 'Gemini 503 retry skipped due to insufficient remaining global deadline budget',
              attemptsExecuted: attempt,
              durationMs: totalDuration,
              retried
            };
          }

          console.log(`[GEMINI 503]
User ID: ${userStr}
Watcher ID: ${watcherStr}
Retry: ATTEMPT_${attempt + 1}`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        } else {
          return {
            success: false,
            errorType: 'TEMPORARY_ERROR',
            diagnosticStatus: 'TEMPORARY_503',
            cleanErrorMessage: cleanErrorMessage || 'Gemini service 503 unavailable after retry',
            attemptsExecuted: attempt,
            durationMs: totalDuration,
            retried
          };
        }
      }

      // 4. Other non-retryable errors
      const finalErrorType = diagnosticStatus === 'INVALID_KEY' ? 'INVALID_CREDENTIALS' :
                             diagnosticStatus === 'PERMISSION_ERROR' ? 'PERMISSION_ERROR' :
                             diagnosticStatus === 'INVALID_REQUEST' ? 'INVALID_REQUEST' : 'UNKNOWN_ERROR';

      return {
        success: false,
        errorType: finalErrorType,
        diagnosticStatus,
        cleanErrorMessage,
        attemptsExecuted: attempt,
        durationMs: totalDuration,
        retried
      };
    }
  }

  return {
    success: false,
    errorType: 'UNKNOWN_ERROR',
    diagnosticStatus: 'UNKNOWN_ERROR',
    cleanErrorMessage: 'Unexpected execution loop exit in Gemini execution layer',
    attemptsExecuted: attempt,
    durationMs: Date.now() - startTime,
    retried
  };
}

export async function runGeminiRequest(
    supabase: any,
    userId: string,
    prompt: string,
    model: string = 'gemini-3.5-flash-lite',
    config?: any
) {
    const keyRes = await resolveUserGeminiKey(supabase, userId, 'gemini-wrapper');
    if (!keyRes.keyPresent || !keyRes.apiKey) {
        throw new Error(`Gemini API key not found in user_api_keys for user ${userId}`);
    }
    const finalApiKey = keyRes.apiKey;

    // Load watcher status
    const { data: watcher, error: watcherError } = await supabase
        .from('watchers')
        .select('status')
        .eq('user_id', userId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

    if (!watcher) {
        throw new Error('Watcher skipped because no active watcher found.');
    }

    // Initialize GoogleGenAI
    const ai = new GoogleGenAI({ apiKey: finalApiKey });

    const res = await executeBoundedGeminiCall(
      ai,
      { model, contents: prompt, config, timeoutMs: 8000, maxRetriesFor503: 1 },
      { watcherId: 'gemini-wrapper' }
    );

    if (!res.success || !res.text) {
      throw new Error(res.cleanErrorMessage || 'Gemini execution failed in bounded wrapper');
    }

    return res.text;
}
