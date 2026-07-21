import { GoogleGenAI, Type, Schema } from '@google/genai';

export interface ParsedStrategy {
  indicators?: string[];
  emaValues?: number[];
  rsiThresholds?: { overbought?: number; oversold?: number };
  bos?: boolean;
  choch?: boolean;
  liquiditySweep?: boolean;
  fairValueGap?: boolean;
  session?: string;
  timeframe?: string;
  entryConditions?: string[];
  exitConditions?: string[];
  stopLoss?: string;
  takeProfit?: string;
  minimumRiskReward?: number;
}

/**
 * Parses a natural language trading strategy into a structured JSON object using Gemini.
 *
 * @param strategyText The user's trading strategy description in natural language
 * @param apiKey The Gemini API key
 * @returns A structured JSON representation of the strategy
 */
export async function parseUserStrategy(
  strategyText: string,
  apiKey: string
): Promise<ParsedStrategy> {
  const ai = new GoogleGenAI({ apiKey });

  const systemInstruction = `You are a professional trading strategy parsing assistant.
Your job is to read a natural language trading strategy and convert it into a structured JSON format.
Extract any mentioned indicators, specific EMA values, RSI thresholds, Smart Money Concepts (BOS, CHoCH, liquidity sweeps, fair value gaps), session preferences, timeframes, entry conditions, exit conditions, stop loss parameters, take profit parameters, and minimum risk-reward ratio.
If a parameter is not mentioned, omit it or set it to null/false depending on the field type.`;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      indicators: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "List of technical indicators mentioned (e.g., 'EMA', 'RSI', 'MACD').",
      },
      emaValues: {
        type: Type.ARRAY,
        items: { type: Type.INTEGER },
        description: "Specific EMA periods mentioned (e.g., 50, 200).",
      },
      rsiThresholds: {
        type: Type.OBJECT,
        properties: {
          overbought: { type: Type.INTEGER },
          oversold: { type: Type.INTEGER },
        },
        description: "RSI overbought and oversold thresholds if specified.",
      },
      bos: {
        type: Type.BOOLEAN,
        description: "Whether Break of Structure (BOS) is used.",
      },
      choch: {
        type: Type.BOOLEAN,
        description: "Whether Change of Character (CHoCH) is used.",
      },
      liquiditySweep: {
        type: Type.BOOLEAN,
        description: "Whether liquidity sweeps are considered.",
      },
      fairValueGap: {
        type: Type.BOOLEAN,
        description: "Whether Fair Value Gaps (FVG) are considered.",
      },
      session: {
        type: Type.STRING,
        description: "Trading session preferences (e.g., 'London', 'New York', 'Asian').",
      },
      timeframe: {
        type: Type.STRING,
        description: "Preferred trading timeframe (e.g., '15m', '1H', '4H', 'Daily').",
      },
      entryConditions: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "List of specific conditions required to enter a trade.",
      },
      exitConditions: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "List of specific conditions required to exit a trade.",
      },
      stopLoss: {
        type: Type.STRING,
        description: "Stop loss placement logic (e.g., 'below swing low', '1%').",
      },
      takeProfit: {
        type: Type.STRING,
        description: "Take profit placement logic (e.g., 'next liquidity pool', '2%').",
      },
      minimumRiskReward: {
        type: Type.NUMBER,
        description: "Minimum required risk-reward ratio (e.g., 2 for 1:2 RR).",
      },
    },
  };

  const response = await ai.models.generateContent({
    model: 'gemini-2.5-flash',
    contents: strategyText,
    config: {
      systemInstruction: systemInstruction,
      responseMimeType: 'application/json',
      responseSchema: responseSchema,
      temperature: 0.1,
    },
  });

  let responseText = "";
  if (typeof response.text === 'function') {
    responseText = await (response.text as any)();
  } else if (typeof response.text === 'string') {
    responseText = response.text;
  } else {
    responseText = (response as any).candidates?.[0]?.content?.parts?.[0]?.text ?? "{}";
  }

  try {
    const parsed = JSON.parse(responseText);
    return parsed as ParsedStrategy;
  } catch (e) {
    console.error("Failed to parse Gemini response as JSON", e);
    return {};
  }
}
