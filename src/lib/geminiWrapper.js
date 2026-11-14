import { GoogleGenAI } from "@google/genai";
import { resolveUserGeminiKey, classifyAndRedactGeminiError } from "./gemini-key-resolver.js";
const GEMINI_API_DEADLINE_MS = 14e3;
const GEMINI_APPLICATION_TIMEOUT_MS = 12e3;
const GEMINI_MARKET_WATCHER_MODEL = "gemini-3.6-flash";
class UserGeminiRateLimiter {
  requestsMap = /* @__PURE__ */ new Map();
  maxRpm;
  maxRpd;
  constructor(maxRpm = Number(process.env.MAX_GEMINI_RPM_PER_USER) || 10, maxRpd = Number(process.env.MAX_GEMINI_RPD_PER_USER) || 18) {
    this.maxRpm = maxRpm;
    this.maxRpd = maxRpd;
  }
  canMakeRequest(userId) {
    if (!userId) return { allowed: true, currentRpm: 0, maxRpm: this.maxRpm, currentRpd: 0, maxRpd: this.maxRpd };
    const now = Date.now();
    const oneMinuteAgo = now - 6e4;
    const oneDayAgo = now - 864e5;
    const userTimestamps = (this.requestsMap.get(userId) || []).filter((ts) => ts > oneDayAgo);
    this.requestsMap.set(userId, userTimestamps);
    const currentRpm = userTimestamps.filter((ts) => ts > oneMinuteAgo).length;
    const currentRpd = userTimestamps.length;
    if (currentRpm >= this.maxRpm) {
      return { allowed: false, currentRpm, maxRpm: this.maxRpm, currentRpd, maxRpd: this.maxRpd };
    }
    if (currentRpd >= this.maxRpd) {
      return { allowed: false, currentRpm, maxRpm: this.maxRpm, currentRpd, maxRpd: this.maxRpd };
    }
    return { allowed: true, currentRpm, maxRpm: this.maxRpm, currentRpd, maxRpd: this.maxRpd };
  }
  recordRequest(userId) {
    if (!userId) return;
    const now = Date.now();
    const oneDayAgo = now - 864e5;
    const userTimestamps = (this.requestsMap.get(userId) || []).filter((ts) => ts > oneDayAgo);
    userTimestamps.push(now);
    this.requestsMap.set(userId, userTimestamps);
  }
}
const globalUserGeminiRateLimiter = new UserGeminiRateLimiter();
function classifyGeminiError(error) {
  const { diagnosticStatus } = classifyAndRedactGeminiError(error);
  if (diagnosticStatus === "INVALID_KEY" || diagnosticStatus === "PERMISSION_ERROR") return "invalid_key";
  if (diagnosticStatus.startsWith("QUOTA_")) return "quota_exceeded";
  if (diagnosticStatus === "TIMEOUT" || diagnosticStatus === "TEMPORARY_ERROR" || diagnosticStatus === "CANCELLED") return "temporary_failure";
  return "unknown_error";
}
function extractQuotaModelFromError(err) {
  const msg = err?.message || String(err);
  const match = msg.match(/(?:models\/|model\s+)?(gemini-[a-zA-Z0-9_.-]+)/i);
  return match ? match[1] : "NOT_SPECIFIED_IN_ERROR_RESPONSE";
}
async function executeBoundedGeminiCall(ai, options, context) {
  const model = options.model || GEMINI_MARKET_WATCHER_MODEL;
  const apiDeadlineMs = Math.max(1e4, options.apiDeadlineMs ?? GEMINI_API_DEADLINE_MS);
  const appTimeoutMs = options.timeoutMs ?? GEMINI_APPLICATION_TIMEOUT_MS;
  const maxRetriesFor503 = options.maxRetriesFor503 ?? 1;
  const backoffMs = options.backoffMsFor503 ?? 500;
  const userStr = context.userEmail || context.userId || "unknown";
  const watcherStr = context.watcherId || "unknown";
  const pairStr = context.pair || "unknown";
  const timeframeStr = context.timeframe || "unknown";
  const keySourceStr = context.keySource || "user_api_keys";
  const isDebug = process.env.LOG_LEVEL === "debug" || process.env.DEBUG === "true";
  if (context.userId) {
    const limitCheck = globalUserGeminiRateLimiter.canMakeRequest(context.userId);
    if (!limitCheck.allowed) {
      const isDaily = limitCheck.currentRpd >= limitCheck.maxRpd;
      const metricStr = isDaily ? `${limitCheck.currentRpd}/${limitCheck.maxRpd} RPD (daily budget)` : `${limitCheck.currentRpm}/${limitCheck.maxRpm} RPM`;
      console.log(`[GEMINI] SKIP | reason=${isDaily ? "daily_budget_reached" : "rate_limit_exceeded"} | current=${metricStr}`);
      if (isDebug) {
        console.log(`[GEMINI RATE LIMIT SKIPPED] User: ${userStr} | Watcher: ${watcherStr} | Pair: ${pairStr} | TF: ${timeframeStr} | Model: ${model}`);
      }
      return {
        success: false,
        errorType: "QUOTA_EXHAUSTED",
        diagnosticStatus: isDaily ? "QUOTA_RPD" : "QUOTA_RPM",
        cleanErrorMessage: `Application per-user Gemini rate limit safety threshold reached (${metricStr})`,
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
    const elapsedSoFar = Date.now() - startTime;
    const remainingGlobalBudget = options.remainingGlobalBudgetMs !== void 0 ? options.remainingGlobalBudgetMs - elapsedSoFar : 25e3;
    if (options.remainingGlobalBudgetMs !== void 0 && remainingGlobalBudget < appTimeoutMs) {
      console.log(`[GEMINI] SKIP | reason=insufficient_cron_budget | remaining=${remainingGlobalBudget}ms`);
      if (isDebug) {
        console.log(`[GEMINI SKIP] User: ${userStr} | Watcher: ${watcherStr} | Pair: ${pairStr} | TF: ${timeframeStr} | Remaining: ${remainingGlobalBudget}ms`);
      }
      return {
        success: false,
        errorType: "TIMEOUT",
        diagnosticStatus: "CRON_DEADLINE",
        cleanErrorMessage: `Insufficient remaining global cron budget (${remainingGlobalBudget}ms) to safely execute Gemini request (${appTimeoutMs}ms required)`,
        attemptsExecuted: Math.max(0, attempt - 1),
        durationMs: Date.now() - startTime,
        retried
      };
    }
    const effectiveApiDeadlineMs = apiDeadlineMs;
    const effectiveAppTimeoutMs = appTimeoutMs;
    const thinkingLevel = options.config?.thinkingConfig?.thinkingLevel || "minimal";
    if (isDebug) {
      console.log(`[GEMINI REQUEST START] User: ${userStr} | Watcher: ${watcherStr} | Pair: ${pairStr} | TF: ${timeframeStr} | Model: ${model} | Timeout: ${effectiveAppTimeoutMs}ms`);
    }
    const controller = new AbortController();
    let timeoutTimer = null;
    let didTimeout = false;
    try {
      const mergedConfig = {
        ...options.config || {},
        httpOptions: {
          timeout: effectiveApiDeadlineMs,
          ...options.config?.httpOptions || {}
        },
        thinkingConfig: {
          thinkingLevel,
          ...options.config?.thinkingConfig || {}
        },
        abortSignal: controller.signal,
        signal: controller.signal
      };
      const fetchPromise = ai.models.generateContent({
        model,
        contents: options.contents,
        config: mergedConfig
      });
      fetchPromise.catch(() => {
      });
      const timeoutPromise = new Promise((_, reject) => {
        timeoutTimer = setTimeout(() => {
          didTimeout = true;
          controller.abort();
          const err = new Error(`Gemini request timed out after ${effectiveAppTimeoutMs}ms`);
          err.name = "TimeoutError";
          reject(err);
        }, effectiveAppTimeoutMs);
      });
      const aiResponse = await Promise.race([fetchPromise, timeoutPromise]);
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const attemptDuration = Date.now() - attemptStart;
      const totalDuration = Date.now() - startTime;
      let rawText = "";
      if (typeof aiResponse?.text === "function") {
        rawText = await aiResponse.text();
      } else if (typeof aiResponse?.text === "string") {
        rawText = aiResponse.text;
      } else {
        rawText = aiResponse?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
      }
      console.log(`[GEMINI] CALL | model=${model} | duration=${attemptDuration}ms | status=OK`);
      return {
        success: true,
        text: rawText,
        diagnosticStatus: "SUCCESS",
        attemptsExecuted: attempt,
        durationMs: totalDuration,
        retried
      };
    } catch (err) {
      if (timeoutTimer) clearTimeout(timeoutTimer);
      const attemptDuration = Date.now() - attemptStart;
      const totalDuration = Date.now() - startTime;
      const classification = classifyAndRedactGeminiError(err);
      let { diagnosticStatus, cleanErrorMessage, is503, is504, isTimeout, isCancelled, isQuota, quotaDetails } = classification;
      if (didTimeout) {
        isTimeout = true;
        isCancelled = false;
        diagnosticStatus = "TIMEOUT";
        cleanErrorMessage = `Gemini request timed out after ${effectiveAppTimeoutMs}ms`;
      }
      if (isDebug) {
        console.log(`[GEMINI REQUEST END] User: ${userStr} | Watcher: ${watcherStr} | Pair: ${pairStr} | Status: ${diagnosticStatus} | Duration: ${attemptDuration}ms`);
      }
      if (isTimeout || err?.name === "TimeoutError" || diagnosticStatus === "TIMEOUT") {
        const timeoutMsg = `Gemini request timed out after ${effectiveAppTimeoutMs}ms`;
        console.log(`[GEMINI] TIMEOUT | duration=${effectiveAppTimeoutMs}ms`);
        return {
          success: false,
          errorType: "TIMEOUT",
          diagnosticStatus: "TIMEOUT",
          cleanErrorMessage: timeoutMsg,
          attemptsExecuted: attempt,
          durationMs: totalDuration,
          retried
        };
      }
      if (isCancelled || diagnosticStatus === "CANCELLED") {
        const cancelMsg = cleanErrorMessage || "The operation was cancelled by caller or network";
        console.log(`[GEMINI] CANCELLED | reason=caller_or_network`);
        return {
          success: false,
          errorType: "CANCELLED",
          diagnosticStatus: "CANCELLED",
          cleanErrorMessage: cancelMsg,
          attemptsExecuted: attempt,
          durationMs: totalDuration,
          retried
        };
      }
      if (diagnosticStatus === "INVALID_REQUEST") {
        console.log(`[GEMINI] ERROR | status=INVALID_REQUEST | retry=0 | duration=${totalDuration}ms`);
        if (isDebug) {
          console.log(`[GEMINI INVALID REQUEST] User: ${userStr} | Watcher: ${watcherStr} | Redacted Msg: ${cleanErrorMessage}`);
        }
        return {
          success: false,
          errorType: "INVALID_REQUEST",
          diagnosticStatus: "INVALID_REQUEST",
          cleanErrorMessage: cleanErrorMessage || "Invalid request configuration (400)",
          attemptsExecuted: attempt,
          durationMs: totalDuration,
          retried: false
        };
      }
      if (is504) {
        console.log(`[GEMINI] ERROR | status=TEMPORARY_504 | retry=0 | duration=${totalDuration}ms`);
        return {
          success: false,
          errorType: "TEMPORARY_ERROR",
          diagnosticStatus: "TEMPORARY_504",
          cleanErrorMessage: cleanErrorMessage || "Deadline expired before operation could complete (504)",
          attemptsExecuted: attempt,
          durationMs: totalDuration,
          retried: false
        };
      }
      if (isQuota || diagnosticStatus.startsWith("QUOTA_")) {
        console.log(`[GEMINI] ERROR | status=${diagnosticStatus} | retry=0 | duration=${totalDuration}ms`);
        if (isDebug) {
          console.log(`[GEMINI QUOTA] User: ${userStr} | Watcher: ${watcherStr} | Clean Msg: ${cleanErrorMessage}`);
        }
        return {
          success: false,
          errorType: "QUOTA_EXHAUSTED",
          diagnosticStatus,
          quotaDetails,
          cleanErrorMessage: cleanErrorMessage || "Quota exceeded or rate limit reached (429)",
          attemptsExecuted: attempt,
          durationMs: totalDuration,
          retried
        };
      }
      if (is503) {
        if (attempt <= maxRetriesFor503) {
          const elapsedSoFar2 = Date.now() - startTime;
          const remainingBudget = (options.remainingGlobalBudgetMs ?? 25e3) - elapsedSoFar2;
          if (remainingBudget < backoffMs + effectiveAppTimeoutMs + 500) {
            console.log(`[GEMINI] ERROR | status=TEMPORARY_503 | retry=0 | duration=${totalDuration}ms`);
            return {
              success: false,
              errorType: "TEMPORARY_ERROR",
              diagnosticStatus: "TEMPORARY_503",
              cleanErrorMessage: "Gemini 503 retry skipped due to insufficient remaining global deadline budget",
              attemptsExecuted: attempt,
              durationMs: totalDuration,
              retried
            };
          }
          console.log(`[GEMINI] ERROR | status=TEMPORARY_503 | retry=1 | duration=${totalDuration}ms`);
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
          continue;
        } else {
          console.log(`[GEMINI] ERROR | status=TEMPORARY_503 | retry=1 | duration=${totalDuration}ms`);
          return {
            success: false,
            errorType: "TEMPORARY_ERROR",
            diagnosticStatus: "TEMPORARY_503",
            cleanErrorMessage: cleanErrorMessage || "Gemini service 503 unavailable after retry",
            attemptsExecuted: attempt,
            durationMs: totalDuration,
            retried
          };
        }
      }
      console.log(`[GEMINI] ERROR | status=${diagnosticStatus} | retry=0 | duration=${totalDuration}ms`);
      if (isDebug) {
        console.log(`[GEMINI FAILURE] User: ${userStr} | Watcher: ${watcherStr} | Status: ${diagnosticStatus} | Clean Msg: ${cleanErrorMessage}`);
      }
      const finalErrorType = diagnosticStatus === "INVALID_KEY" ? "INVALID_CREDENTIALS" : diagnosticStatus === "PERMISSION_ERROR" ? "PERMISSION_ERROR" : diagnosticStatus === "INVALID_REQUEST" ? "INVALID_REQUEST" : "UNKNOWN_ERROR";
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
    errorType: "UNKNOWN_ERROR",
    diagnosticStatus: "UNKNOWN_ERROR",
    cleanErrorMessage: "Unexpected execution loop exit in Gemini execution layer",
    attemptsExecuted: attempt,
    durationMs: Date.now() - startTime,
    retried
  };
}
async function runGeminiRequest(supabase, userId, prompt, model = GEMINI_MARKET_WATCHER_MODEL, config) {
  const keyRes = await resolveUserGeminiKey(supabase, userId, "gemini-wrapper");
  if (!keyRes.keyPresent || !keyRes.apiKey) {
    throw new Error(`Gemini API key not found in user_api_keys for user ${userId}`);
  }
  const finalApiKey = keyRes.apiKey;
  const { data: watcher, error: watcherError } = await supabase.from("watchers").select("status").eq("user_id", userId).eq("status", "active").limit(1).maybeSingle();
  if (!watcher) {
    throw new Error("Watcher skipped because no active watcher found.");
  }
  const ai = new GoogleGenAI({ apiKey: finalApiKey });
  const res = await executeBoundedGeminiCall(
    ai,
    { model, contents: prompt, config, timeoutMs: GEMINI_APPLICATION_TIMEOUT_MS, apiDeadlineMs: GEMINI_API_DEADLINE_MS, maxRetriesFor503: 1 },
    { watcherId: "gemini-wrapper" }
  );
  if (!res.success || !res.text) {
    throw new Error(res.cleanErrorMessage || "Gemini execution failed in bounded wrapper");
  }
  return res.text;
}
export {
  GEMINI_API_DEADLINE_MS,
  GEMINI_APPLICATION_TIMEOUT_MS,
  GEMINI_MARKET_WATCHER_MODEL,
  UserGeminiRateLimiter,
  classifyGeminiError,
  executeBoundedGeminiCall,
  globalUserGeminiRateLimiter,
  runGeminiRequest
};
