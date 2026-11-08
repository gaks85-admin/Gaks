import crypto from 'crypto';
import { MarkedZone } from './zone-engine.js';
import { MarketStructure } from './market-structure-engine.js';
import { runGeminiRequest, GEMINI_MARKET_WATCHER_MODEL } from './geminiWrapper.js';
import { Candle } from './strategy-engine.js';
import { checkAndIncrementGeminiBudget } from './gemini-budget-tracker.js';

export function computeZoneFingerprint(pair: string, timeframe: string, candidates: MarkedZone[]): string {
  const sorted = [...candidates].sort((a, b) => a.low - b.low || a.high - b.high);
  const raw = `${(pair || 'PAIR').toUpperCase()}_${(timeframe || 'H1').toUpperCase()}_` +
    sorted.map(c => `${c.type}:${c.direction}:${c.low}:${c.high}:${c.originCandle || c.createdCandleTime || ''}`).join('|');
  return crypto.createHash('sha256').update(raw).digest('hex').substring(0, 16);
}

// In-memory analysis cache
const zoneAnalysisCache = new Map<string, { fingerprint: string; winnerId: string; aiReason: string; timestamp: number }>();

/**
  * Uses Gemini AI to curate a list of candidate zones and select the single highest-quality Point of Interest (POI).
  * Enforces local deterministic OHLC zone discovery first, daily budgets (10 regular, 15 admin, Africa/Lagos timezone),
  * zone fingerprint caching, boundary validation, and fail-closed local fallback.
  */
export async function curateZonesWithAI(
  supabase: any,
  candidates: MarkedZone[],
  marketStructure: MarketStructure,
  strategyText: string,
  userId: string,
  pair: string,
  candles: Candle[],
  userEmail?: string | null
): Promise<{ winner: MarkedZone; aiReason: string; geminiUsed: boolean; budgetStatus?: string } | null> {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) {
    return { winner: candidates[0], aiReason: "Automatically selected as the only valid structural candidate.", geminiUsed: false };
  }

  const timeframe = marketStructure.timeframe || 'H1';
  const fingerprint = computeZoneFingerprint(pair, timeframe, candidates);

  // 1. Check cache
  const cached = zoneAnalysisCache.get(fingerprint);
  if (cached && Date.now() - cached.timestamp < 30 * 60 * 1000) {
    const winner = candidates.find(c => c.id === cached.winnerId) || candidates[0];
    return { winner, aiReason: cached.aiReason, geminiUsed: false, budgetStatus: 'CACHE_REUSED' };
  }

  // 2. Check Daily Gemini Budget
  const budgetCheck = await checkAndIncrementGeminiBudget(supabase, userId, userEmail);
  if (!budgetCheck.allowed) {
    console.log(`[GEMINI BUDGET EXHAUSTED] User ${userId} reached daily limit (${budgetCheck.currentCount}/${budgetCheck.maxLimit}). Preserving local zone detection without calling Gemini.`);
    return {
      winner: candidates[0],
      aiReason: "GEMINI_DAILY_BUDGET_EXHAUSTED — Using highest-priority local deterministic structural zone.",
      geminiUsed: false,
      budgetStatus: 'BUDGET_EXHAUSTED'
    };
  }

  // 3. Construct Gemini prompt for batch analysis of candidate zones
  const latestCandle = candles[candles.length - 1];
  const currentPrice = latestCandle?.close || 0;
  const htfTrend = marketStructure.htfTrend || marketStructure.trend || 'SIDEWAYS';
  const htfTimeframe = marketStructure.htfTimeframe || 'H4';

  const zoneList = candidates.map((z, i) => {
    return `${i + 1}. [ID: ${z.id}] Type: ${z.type}, Direction: ${z.direction}, Range: ${z.low} - ${z.high}, Strength: ${z.strength}/100, Invalidation: ${z.invalidationLevel}. Reasoning: ${z.reasoning}`;
  }).join('\n');

  const prompt = `You are a Senior Institutional Trading Specialist specializing in Smart Money Concepts (SMC), ICT, and Supply/Demand analysis.
Analyze the actual detected supply and demand zones from OHLC candle data.

### MARKET CONTEXT
- Pair: ${pair}
- Current Price: ${currentPrice}
- Timeframe Trend (${htfTimeframe}): ${htfTrend}
- Market State: ${marketStructure.trend} (Local)

### USER TRADING STRATEGY
"${strategyText}"

### DETECTED CANDIDATE ZONES
${zoneList}

### EVALUATION INSTRUCTIONS
1. Evaluate the validity, structural quality, and freshness of each candidate zone.
2. Validate that boundaries correspond to actual candle structures supplied. Do not invent or move boundaries arbitrarily.
3. Select the SINGLE best candidate zone ID.

### RESPONSE FORMAT
Return ONLY a valid JSON object:
{
  "winnerId": "the_zone_id",
  "reason": "Professional evaluation of validity, structural quality, and freshness."
}
`;

  try {
    const text = await runGeminiRequest(supabase, userId, prompt, GEMINI_MARKET_WATCHER_MODEL);
    if (text) {
      const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleanText);
      const winner = candidates.find(c => c.id === parsed.winnerId);
      if (winner) {
        const aiReason = parsed.reason || "Validated by Gemini AI zone analysis.";
        zoneAnalysisCache.set(fingerprint, { fingerprint, winnerId: winner.id, aiReason, timestamp: Date.now() });
        return { winner, aiReason, geminiUsed: true, budgetStatus: 'SUCCESS' };
      }
    }
  } catch (err: any) {
    console.warn(`[GEMINI ZONE ANALYSIS ERROR] Preserving local zone detection:`, err?.message || err);
  }

  // Fallback: Gemini unavailable, failed, or timed out. Preserve local detection data.
  return {
    winner: candidates[0],
    aiReason: "Gemini analysis UNAVAILABLE/PENDING/FAILED — Preserving authoritative local structural zone detection.",
    geminiUsed: false,
    budgetStatus: 'UNAVAILABLE'
  };
}
