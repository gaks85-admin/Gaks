import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { sendTelegramMessage } from './telegramWrapper.js';
import { resolveUserGeminiKey, classifyAndRedactGeminiError } from './gemini-key-resolver.js';

// Simplified Error Classification
export type GeminiErrorType = 'invalid_key' | 'quota_exceeded' | 'rate_limited' | 'temporary_failure' | 'unknown_error';

export function classifyGeminiError(error: any): GeminiErrorType {
    const { diagnosticStatus } = classifyAndRedactGeminiError(error);
    if (diagnosticStatus === 'INVALID_KEY' || diagnosticStatus === 'PERMISSION_ERROR') return 'invalid_key';
    if (diagnosticStatus === 'QUOTA_EXHAUSTED') return 'quota_exceeded';
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
}

export interface BoundedGeminiResult {
  success: boolean;
  text?: string;
  errorType?: 'TIMEOUT' | 'TEMPORARY_ERROR' | 'QUOTA_EXHAUSTED' | 'INVALID_CREDENTIALS' | 'PERMISSION_ERROR' | 'INVALID_REQUEST' | 'UNKNOWN_ERROR';
  cleanErrorMessage?: string;
  attemptsExecuted: number;
  durationMs: number;
  retried: boolean;
}

/**
 * Bounded execution layer for Gemini AI requests.
 * Enforces hard timeouts (default 8,000ms), 503 single retry with backoff,
 * 429 quota handling without retry, fail closed, and structured logging.
 */
export async function executeBoundedGeminiCall(
  ai: GoogleGenAI,
  options: BoundedGeminiOptions,
  context: { userEmail?: string; watcherId?: string; pair?: string }
): Promise<BoundedGeminiResult> {
  const model = options.model || 'gemini-3.6-flash';
  const timeoutMs = options.timeoutMs || 8000;
  const maxRetriesFor503 = options.maxRetriesFor503 ?? 1;
  const backoffMs = options.backoffMsFor503 ?? 500;

  const userStr = context.userEmail || 'unknown';
  const watcherStr = context.watcherId || 'unknown';

  let attempt = 0;
  let retried = false;
  const startTime = Date.now();

  while (attempt <= maxRetriesFor503) {
    attempt++;
    if (attempt > 1) {
      retried = true;
    }
    const attemptStart = Date.now();

    console.log(`[GEMINI REQUEST]\nUser: ${userStr}\nWatcher: ${watcherStr}\nModel: ${model}\nAttempt: ${attempt}`);

    let timeoutTimer: NodeJS.Timeout | null = null;
    try {
      const fetchPromise = ai.models.generateContent({
        model: model,
        contents: options.contents,
        config: options.config
      });

      const timeoutPromise = new Promise<never>((_, reject) => {
        timeoutTimer = setTimeout(() => {
          const err: any = new Error(`Gemini request timed out after ${timeoutMs}ms`);
          err.name = 'TimeoutError';
          reject(err);
        }, timeoutMs);
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

      console.log(`[GEMINI SUCCESS]\nUser: ${userStr}\nWatcher: ${watcherStr}\nAttempt: ${attempt}\nDuration: ${attemptDuration}ms`);

      return {
        success: true,
        text: rawText,
        attemptsExecuted: attempt,
        durationMs: totalDuration,
        retried
      };

    } catch (err: any) {
      if (timeoutTimer) clearTimeout(timeoutTimer);

      const attemptDuration = Date.now() - attemptStart;
      const totalDuration = Date.now() - startTime;
      const { diagnosticStatus, cleanErrorMessage, is503, isTimeout, isQuota } = classifyAndRedactGeminiError(err);

      if (isTimeout || err?.name === 'TimeoutError' || diagnosticStatus === 'TIMEOUT') {
        console.log(`[GEMINI TIMEOUT]\nUser: ${userStr}\nWatcher: ${watcherStr}\nDuration: ${attemptDuration}ms\nAction: SKIP`);

        return {
          success: false,
          errorType: 'TIMEOUT',
          cleanErrorMessage: cleanErrorMessage || `Gemini request timed out after ${timeoutMs}ms`,
          attemptsExecuted: attempt,
          durationMs: totalDuration,
          retried
        };
      }

      if (isQuota || diagnosticStatus === 'QUOTA_EXHAUSTED') {
        console.log(`[GEMINI QUOTA]\nUser: ${userStr}\nWatcher: ${watcherStr}\nModel: ${model}\nAction: SKIPPED\nReason: QUOTA_EXHAUSTED`);

        return {
          success: false,
          errorType: 'QUOTA_EXHAUSTED',
          cleanErrorMessage: cleanErrorMessage || 'Quota exceeded or rate limit reached',
          attemptsExecuted: attempt,
          durationMs: totalDuration,
          retried
        };
      }

      if (is503 || diagnosticStatus === 'TEMPORARY_ERROR') {
        if (attempt <= maxRetriesFor503) {
          console.log(`[GEMINI 503]\nUser: ${userStr}\nWatcher: ${watcherStr}\nAttempt: ${attempt}\nAction: RETRY`);
          await new Promise(resolve => setTimeout(resolve, backoffMs));
          continue;
        } else {
          console.log(`[GEMINI 503]\nUser: ${userStr}\nWatcher: ${watcherStr}\nAttempt: ${attempt}\nAction: SKIP`);

          return {
            success: false,
            errorType: 'TEMPORARY_ERROR',
            cleanErrorMessage: cleanErrorMessage || 'Gemini service 503 unavailable after retries',
            attemptsExecuted: attempt,
            durationMs: totalDuration,
            retried
          };
        }
      }

      const finalErrorType = diagnosticStatus === 'INVALID_KEY' ? 'INVALID_CREDENTIALS' :
                             diagnosticStatus === 'PERMISSION_ERROR' ? 'PERMISSION_ERROR' :
                             diagnosticStatus === 'INVALID_REQUEST' ? 'INVALID_REQUEST' : 'UNKNOWN_ERROR';

      return {
        success: false,
        errorType: finalErrorType,
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
    model: string = 'gemini-3.6-flash',
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
