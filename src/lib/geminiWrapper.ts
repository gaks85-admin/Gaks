import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { sendTelegramMessage } from './telegramWrapper.js';
import { resolveUserGeminiKey, classifyAndRedactGeminiError, GeminiQuotaDetails, redactApiKeyInText } from './gemini-key-resolver.js';

export const GEMINI_API_DEADLINE_MS = 10_000;
export const GEMINI_APPLICATION_TIMEOUT_MS = 9_500;

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
  timeoutMs?: number; // Application-level timeout (default 10500ms)
  apiDeadlineMs?: number; // Gemini API deadline (default 10000ms, MUST be >= 10000ms)
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
 * Enforces per-user rate limiting, hard timeouts (10,000ms API deadline / 10,500ms app timeout),
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
  const model = options.model || 'gemini-2.5-flash';
  const apiDeadlineMs = Math.max(10_000, options.apiDeadlineMs ?? GEMINI_API_DEADLINE_MS);
  const appTimeoutMs = options.timeoutMs ?? GEMINI_APPLICATION_TIMEOUT_MS;
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

    if (options.remainingGlobalBudgetMs !== undefined && remainingGlobalBudget < appTimeoutMs) {
      console.log(`[GEMINI SKIP]
User ID: ${userStr}
Watcher ID: ${watcherStr}
Pair: ${pairStr}
Timeframe: ${timeframeStr}
Reason: Insufficient global cron budget remaining (${remainingGlobalBudget}ms < ${appTimeoutMs}ms required threshold)`);

      return {
        success: false,
        errorType: 'TIMEOUT',
        diagnosticStatus: 'CRON_DEADLINE',
        cleanErrorMessage: `Insufficient remaining global cron budget (${remainingGlobalBudget}ms) to safely execute Gemini request (${appTimeoutMs}ms required)`,
        attemptsExecuted: Math.max(0, attempt - 1),
        durationMs: Date.now() - startTime,
        retried
      };
    }

    const effectiveApiDeadlineMs = apiDeadlineMs;
    const effectiveAppTimeoutMs = appTimeoutMs;
    const thinkingLevel = options.config?.thinkingConfig?.thinkingLevel || 'minimal';

    console.log(`[GEMINI REQUEST START]
User: ${userStr}
Watcher: ${watcherStr}
Pair: ${pairStr}
TF: ${timeframeStr}
Model: ${model}
API Deadline: ${effectiveApiDeadlineMs}ms
App Timeout: ${effectiveAppTimeoutMs}ms
Thinking Level: ${thinkingLevel}`);

    const controller = new AbortController();
    let timeoutTimer: NodeJS.Timeout | null = null;

    try {
      const mergedConfig = {
        ...(options.config || {}),
        httpOptions: {
          timeout: effectiveApiDeadlineMs,
          ...(options.config?.httpOptions || {})
        },
        thinkingConfig: {
          thinkingLevel: thinkingLevel,
          ...(options.config?.thinkingConfig || {})
        },
        abortSignal: controller.signal,
        signal: controller.signal
      };

      const fetchPromise = ai.models.generateContent({
        model: model,
        contents: options.contents,
        config: mergedConfig
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          controller.abort();
          const err = new Error(`Gemini request timed out after ${effectiveAppTimeoutMs}ms`);
          err.name = 'TimeoutError';
          reject(err);
        }, effectiveAppTimeoutMs);
      });

      const aiResponse = await Promise.race([fetchPromise, timeoutPromise]);
      if (timeoutTimer) clearTimeout(timeoutTimer);

      const attemptDuration = Date.now() - attemptStart;
      const totalDuration = Date.now() - startTime;

      let rawText = '';
      if (typeof (aiResponse as any)?.text === 'function') {
        rawText = await (aiResponse as any).text();
      } else if (typeof aiResponse?.text === 'string') {
        rawText = aiResponse.text;
      } else {
        rawText = (aiResponse as any)?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
      }

      console.log(`[GEMINI REQUEST END]
User: ${userStr}
Watcher: ${watcherStr}
Pair: ${pairStr}
TF: ${timeframeStr}
Model: ${model}
DurationMs: ${attemptDuration}
Status: SUCCESS`);

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
      const attemptDuration = Date.now() - attemptStart;
      const totalDuration = Date.now() - startTime;
      const { diagnosticStatus, cleanErrorMessage, is503, is504, isTimeout, isQuota, quotaDetails } = classifyAndRedactGeminiError(err);

      console.log(`[GEMINI REQUEST END]
User: ${userStr}
Watcher: ${watcherStr}
Pair: ${pairStr}
TF: ${timeframeStr}
Model: ${model}
DurationMs: ${attemptDuration}
Status: ${diagnosticStatus}`);

      // 1. LOCAL APPLICATION TIMEOUT
      if (isTimeout || err?.name === 'TimeoutError' || err?.name === 'AbortError' || diagnosticStatus === 'TIMEOUT') {
        console.log(`[GEMINI TIMEOUT] User: ${userStr} | Watcher: ${watcherStr} | Pair: ${pairStr} | TF: ${timeframeStr} | Model: ${model} | App Timeout: ${effectiveAppTimeoutMs}ms | API Deadline: ${effectiveApiDeadlineMs}ms
DurationMs: ${attemptDuration}`);

        return {
          success: false,
          errorType: 'TIMEOUT',
          diagnosticStatus: 'TIMEOUT',
          cleanErrorMessage: cleanErrorMessage || `Gemini request timed out after ${effectiveAppTimeoutMs}ms`,
          attemptsExecuted: attempt,
          durationMs: totalDuration,
          retried
        };
      }

      // 2. 400 / INVALID_REQUEST (including minimum deadline errors)
      if (diagnosticStatus === 'INVALID_REQUEST') {
        console.log(`[GEMINI INVALID REQUEST] SDK timeout configuration rejected or invalid request:
User: ${userStr}
Watcher: ${watcherStr}
Pair: ${pairStr}
TF: ${timeframeStr}
HTTP Status: ${err?.status || err?.statusCode || 400}
Classified Status: INVALID_REQUEST
Redacted Error Message: ${cleanErrorMessage}
Configured SDK Timeout: ${effectiveApiDeadlineMs}ms
Configured App Timeout: ${effectiveAppTimeoutMs}ms`);

        return {
          success: false,
          errorType: 'INVALID_REQUEST',
          diagnosticStatus: 'INVALID_REQUEST',
          cleanErrorMessage: cleanErrorMessage || 'Invalid request configuration (400)',
          attemptsExecuted: attempt,
          durationMs: totalDuration,
          retried: false
        };
      }

      // 2. 504 / DEADLINE_EXCEEDED: Fail fast, DO NOT RETRY
      if (is504) {
        console.log(`[GEMINI 504]
Gemini Status: TEMPORARY_ERROR
HTTP Status: 504
Provider Status: DEADLINE_EXCEEDED
Retry: NO
Action: SKIPPED`);

        return {
          success: false,
          errorType: 'TEMPORARY_ERROR',
          diagnosticStatus: 'TEMPORARY_504',
          cleanErrorMessage: cleanErrorMessage || 'Deadline expired before operation could complete (504)',
          attemptsExecuted: attempt,
          durationMs: totalDuration,
          retried: false
        };
      }

      // 3. 429 / QUOTA_EXHAUSTED: DO NOT RETRY
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

      // 4. 503 / UNAVAILABLE: At most 1 retry if global deadline permits
      if (is503) {
        if (attempt <= maxRetriesFor503) {
          const elapsedSoFar = Date.now() - startTime;
          const remainingBudget = (options.remainingGlobalBudgetMs ?? 25000) - elapsedSoFar;
          if (remainingBudget < (backoffMs + effectiveAppTimeoutMs + 500)) {
            console.log(`[GEMINI 503] User ID: ${userStr}, Watcher ID: ${watcherStr}, Pair: ${pairStr}, Timeframe: ${timeframeStr}. Action: SKIP RETRY (Insufficient global budget remaining: ${remainingBudget}ms < ${backoffMs + effectiveAppTimeoutMs + 500}ms needed)`);

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

      // 5. Other non-retryable errors (400, 401, 403, etc.)
      console.log(`[GEMINI FAILURE]
User ID: ${userStr}
Watcher ID: ${watcherStr}
Status: ${diagnosticStatus}
Clean Error: ${cleanErrorMessage}`);

      const finalErrorType = (diagnosticStatus as string) === 'INVALID_KEY' ? 'INVALID_CREDENTIALS' :
                             (diagnosticStatus as string) === 'PERMISSION_ERROR' ? 'PERMISSION_ERROR' :
                             (diagnosticStatus as string) === 'INVALID_REQUEST' ? 'INVALID_REQUEST' : 'UNKNOWN_ERROR';

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
    model: string = 'gemini-2.5-flash',
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
      { model, contents: prompt, config, timeoutMs: GEMINI_APPLICATION_TIMEOUT_MS, apiDeadlineMs: GEMINI_API_DEADLINE_MS, maxRetriesFor503: 1 },
      { watcherId: 'gemini-wrapper' }
    );

    if (!res.success || !res.text) {
      throw new Error(res.cleanErrorMessage || 'Gemini execution failed in bounded wrapper');
    }

    return res.text;
}
