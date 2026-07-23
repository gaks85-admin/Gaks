import { GoogleGenAI } from '@google/genai';

/**
 * Summarize strategy text using Gemini into a concise label (<= 4 words).
 * Returns "Custom Strategy" if missing, unclassifiable, or on error.
 */
export async function generateStrategySummary(strategyText: string): Promise<string> {
  if (!strategyText || !strategyText.trim()) {
    return 'Custom Strategy';
  }

  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
  if (!apiKey) {
    console.warn('[Strategy Summarizer] Gemini API key not found in environment, returning Custom Strategy');
    return 'Custom Strategy';
  }

  try {
    const ai = new GoogleGenAI({ apiKey });
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

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    let rawText = '';
    if (typeof response.text === 'string') {
      rawText = response.text;
    } else if (typeof response.text === 'function') {
      rawText = await (response.text as any)();
    } else {
      rawText = (response as any).candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

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
  } catch (err: any) {
    console.error('[Strategy Summarizer] Gemini error:', err?.message || err);
    return 'Custom Strategy';
  }
}
