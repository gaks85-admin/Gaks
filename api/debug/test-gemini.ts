import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

const getSupabase = () => {
  const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    throw new Error('Supabase configuration missing');
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
};

export default async function testGeminiHandler(req: Request, res: Response) {
  try {
    const supabase = getSupabase();
    
    // Read one Gemini API key from user_api_keys
    const { data: keyData, error: keyError } = await supabase
      .from('user_api_keys')
      .select('api_key')
      .eq('provider', 'gemini')
      .limit(1)
      .maybeSingle();

    if (keyError) {
      return res.status(500).json({
        success: false,
        error: keyError,
        message: "Failed to fetch API key from Supabase"
      });
    }

    if (!keyData || !keyData.api_key) {
      return res.status(404).json({
        success: false,
        error: "No Gemini API key found in user_api_keys table"
      });
    }

    const ai = new GoogleGenAI({ apiKey: keyData.api_key });
    
    // Call Gemini
    const geminiResponse = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: "Reply with exactly the word OK"
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
    console.error("Caught ApiError:", {
      status: error.status,
      code: error.code,
      message: error.message,
      details: error.details
    });

    return res.status(error.status || 500).json({
      status: error.status || 500,
      success: false,
      error: {
        message: error.message,
        stack: error.stack,
        details: error
      }
    });
  }
}
