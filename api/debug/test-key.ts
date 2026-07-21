import { Request, Response } from 'express';
import { GoogleGenAI } from '@google/genai';

export default async function testKeyHandler(req: Request, res: Response) {
  try {
    const { apiKey } = req.body;
    if (!apiKey || typeof apiKey !== 'string') {
      return res.status(400).json({
        success: false,
        error: "No API key provided."
      });
    }

    const ai = new GoogleGenAI({ apiKey });
    
    const geminiResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: "Say hello",
    });

    let responseText = "";
    if (typeof geminiResponse.text === 'function') {
      responseText = await (geminiResponse.text as any)();
    } else if (typeof geminiResponse.text === 'string') {
      responseText = geminiResponse.text;
    } else {
      responseText = (geminiResponse as any).candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    }

    return res.status(200).json({
      status: 200,
      success: true,
      responseText: responseText,
      fullResponseObject: geminiResponse
    });

  } catch (error: any) {
    console.error("Caught ApiError in debug endpoint:", {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details
    });

    return res.status(error.status || 500).json({
      status: error.status || 500,
      success: false,
      error: {
        code: error.code || null,
        message: error.message || String(error),
        details: error.details || null
      }
    });
  }
}
