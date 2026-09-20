import { MarkedZone } from './zone-engine.js';
import { MarketStructure } from './market-structure-engine.js';
import { runGeminiRequest, GEMINI_MARKET_WATCHER_MODEL } from './geminiWrapper.js';
import { Candle } from './strategy-engine.js';

/**
 * Uses Gemini AI to curate a list of candidate zones and select the single highest-quality Point of Interest (POI).
 * This adds a layer of "institutional logic" and contextual filtering above the deterministic rule engine.
 */
export async function curateZonesWithAI(
  supabase: any,
  candidates: MarkedZone[],
  marketStructure: MarketStructure,
  strategyText: string,
  userId: string,
  pair: string,
  candles: Candle[]
): Promise<{ winner: MarkedZone; aiReason: string } | null> {
  if (!candidates || candidates.length === 0) return null;
  if (candidates.length === 1) return { winner: candidates[0], aiReason: "Automatically selected as the only valid structural candidate." };

  const latestCandle = candles[candles.length - 1];
  const currentPrice = latestCandle?.close || 0;
  const htfTrend = marketStructure.htfTrend || marketStructure.trend || 'SIDEWAYS';
  const htfTimeframe = marketStructure.htfTimeframe || 'H4';

  const zoneList = candidates.map((z, i) => {
    return `${i + 1}. [ID: ${z.id}] Type: ${z.type}, Direction: ${z.direction}, Range: ${z.low} - ${z.high}, Strength: ${z.strength}/100. Reasoning: ${z.reasoning}`;
  }).join('\n');

  const prompt = `You are a Senior Institutional Trading Specialist specializing in Smart Money Concepts (SMC), ICT, and Supply/Demand analysis.
Your mission is to curate a list of potential "Zones of Interest" and select the SINGLE highest-quality zone for a live trade setup.

### MARKET CONTEXT
- Pair: ${pair}
- Current Price: ${currentPrice}
- Timeframe Trend (${htfTimeframe}): ${htfTrend}
- Market State: ${marketStructure.trend} (Local)
- Volatility: ${marketStructure.volatilityInformation?.volatilityLevel || 'Normal'}

### USER TRADING STRATEGY
"${strategyText}"

### CANDIDATE ZONES (from deterministic engine)
${zoneList}

### EVALUATION INSTRUCTIONS
1. **Trend Alignment**: Prioritize zones that align with the ${htfTimeframe} ${htfTrend} trend.
2. **Quality vs Noise**: Distinguish between "noise" (minor pullbacks) and "institutional levels" (major displacement origins).
3. **Liquidity Analysis**: Look for zones that formed after a liquidity sweep or created a Break of Structure (BOS).
4. **Strategy Matching**: Ensure the zone fits the user's explicit strategy requirements.
5. **Inducement Warning**: If a zone looks like "retail support/resistance" that is likely to be swept, avoid it.

Select the BEST zone ID. You must pick exactly one from the provided list.

### RESPONSE FORMAT
Return ONLY a valid JSON object:
{
  "winnerId": "the_zone_id",
  "reason": "Brief professional explanation of why this zone is superior to others (e.g., 'Selected due to its origin at a major displacement move that swept internal liquidity and aligns perfectly with the H4 bearish trend.')"
}
`;

  try {
    const text = await runGeminiRequest(supabase, userId, prompt, GEMINI_MARKET_WATCHER_MODEL);

    if (text) {
      // Clean the response from potential markdown blocks
      const cleanText = text.replace(/```json/g, '').replace(/```/g, '').trim();
      try {
        const parsed = JSON.parse(cleanText);
        const winner = candidates.find(c => c.id === parsed.winnerId);
        
        if (winner) {
          return {
            winner,
            aiReason: parsed.reason || "Selected by AI as the highest-quality structural level."
          };
        }
      } catch (e) {
        console.error(`[ZONE CURATOR] Failed to parse Gemini response: ${text}`);
      }
    }

    // Fallback: If AI fails or returns invalid data, return the strongest candidate
    console.log(`[ZONE CURATOR] AI curation failed or returned invalid result. Falling back to strongest structural candidate.`);
    return { winner: candidates[0], aiReason: "AI curation failed. Selected strongest structural candidate via deterministic rules." };
  } catch (error) {
    console.error(`[ZONE CURATOR] Critical error during AI curation:`, error);
    return { winner: candidates[0], aiReason: "AI curation error. Falling back to deterministic priority." };
  }
}
