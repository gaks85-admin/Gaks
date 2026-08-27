import { GoogleGenAI } from '@google/genai';
import { executeBoundedGeminiCall } from './geminiWrapper.js';
import { resolveUserGeminiKey } from './gemini-key-resolver.js';

export interface StrategySummarizerOptions {
  apiKey?: string | null;
  supabase?: any;
  userId?: string;
  watcherId?: string;
  keySource?: string;
}

/**
 * Summarize strategy text using Gemini into a concise label (<= 4 words).
 * Requires an authenticated user's resolved Gemini API key passed explicitly or resolved from user_api_keys.
 * Never depends on or falls back to global environment variables.
 */
export async function generateStrategySummary(
  strategyText: string,
  apiKeyOrOptions?: string | StrategySummarizerOptions
): Promise<string> {
  if (!strategyText || !strategyText.trim()) {
    return 'Custom Strategy';
  }

  let resolvedApiKey: string | null = null;
  let keySource = 'user_api_keys';
  let userId: string | undefined;
  let watcherId = 'strategy-summarizer';

  if (typeof apiKeyOrOptions === 'string') {
    resolvedApiKey = apiKeyOrOptions;
  } else if (apiKeyOrOptions && typeof apiKeyOrOptions === 'object') {
    if (apiKeyOrOptions.apiKey) {
      resolvedApiKey = apiKeyOrOptions.apiKey;
      keySource = apiKeyOrOptions.keySource || 'user_api_keys';
    } else if (apiKeyOrOptions.supabase && apiKeyOrOptions.userId) {
      const keyRes = await resolveUserGeminiKey(
        apiKeyOrOptions.supabase,
        apiKeyOrOptions.userId,
        apiKeyOrOptions.watcherId || 'strategy-summarizer'
      );
      resolvedApiKey = keyRes.apiKey;
      keySource = keyRes.keySource;
      userId = apiKeyOrOptions.userId;
    }
    if (apiKeyOrOptions.userId) userId = apiKeyOrOptions.userId;
    if (apiKeyOrOptions.watcherId) watcherId = apiKeyOrOptions.watcherId;
  }

  if (!resolvedApiKey || !resolvedApiKey.trim()) {
    console.error('[Strategy Summarizer] Gemini API key resolution failed: Key Present: NO');
    const err = new Error('Gemini API key is required to summarize strategy. Please configure your Gemini API key under Settings.');
    (err as any).errorType = 'INVALID_CREDENTIALS';
    throw err;
  }

  // Safe diagnostic logging (never exposes actual key)
  console.log('[Strategy Summarizer] Gemini key resolved');
  console.log(`Key Source: ${keySource}`);
  console.log('Key Present: YES');

  const ai = new GoogleGenAI({ apiKey: resolvedApiKey.trim() });
  const prompt = `You are an expert trading strategy classifier. Analyze the following trading strategy text and classify it into a single concise strategy label or name.

Examples of standard concise strategy labels:
- Trendline Breakout
- Support & Resistance
- EMA 20 Crossover
- EMA + RSI Confirmation
- Break of Structure
- Liquidity Sweep + BOS
- Moving Average Trend Following
- Supply & Demand
- ICT Silver Bullet
- Scalping Strategy
- Swing Strategy
- Price Action
- RSI Divergence
- MACD Crossover

Strict Rules:
1. Return ONLY the concise strategy name/label. Do NOT include any explanations, bullet points, headers, or quotes.
2. The label MUST NOT exceed 4 words.
3. If the strategy cannot be confidently classified, return exactly: Custom Strategy

Trading Strategy Text:
${strategyText.substring(0, 3000)}`;

  const sumRes = await executeBoundedGeminiCall(
    ai,
    {
      model: 'gemini-3.5-flash-lite',
      contents: prompt,
      timeoutMs: 12000,
      maxRetriesFor503: 1
    },
    {
      userId,
      watcherId,
      keySource,
      requestId: `req_sum_${Date.now()}`
    }
  );

  if (!sumRes.success) {
    console.error(`[Strategy Summarizer] Gemini error (${sumRes.errorType}): ${sumRes.cleanErrorMessage}`);
    const err = new Error(sumRes.cleanErrorMessage || `Strategy Summarizer failed (${sumRes.errorType})`);
    (err as any).errorType = sumRes.errorType || 'GEMINI_ERROR';
    (err as any).diagnosticStatus = sumRes.diagnosticStatus;
    throw err;
  }

  const rawText = sumRes.text || '';
  let result = rawText.trim().replace(/^["'`]+|["'`]+$/g, '');

  // Validate word count (must never exceed 4 words)
  const words = result.split(/\s+/).filter(Boolean);
  if (!result || words.length === 0 || words.length > 4) {
    if (words.length > 0 && words.length <= 4) {
      result = words.join(' ');
    } else {
      result = 'Custom Strategy';
    }
  }

  return result || 'Custom Strategy';
}
