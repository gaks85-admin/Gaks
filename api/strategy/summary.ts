import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { generateStrategySummary } from '../../src/lib/strategy-summarizer.js';
import { resolveUserGeminiKey } from '../../src/lib/gemini-key-resolver.js';

const getSupabase = (token?: string) => {
  const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  return createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers }
  });
};

export default async function strategySummaryHandler(req: Request, res: Response) {
  try {
    const { strategyText, userId: bodyUserId } = req.body;

    if (!strategyText || typeof strategyText !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing strategyText in request body.'
      });
    }

    const authHeader = req.headers.authorization || '';
    const tokenHeader = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
    let userId = bodyUserId;
    let supabase = getSupabase(tokenHeader);

    if (tokenHeader) {
      try {
        const { data: { user } } = await supabase.auth.getUser(tokenHeader);
        if (user) {
          userId = user.id;
          supabase = getSupabase(tokenHeader);
        }
      } catch (authErr) {
        // Fall back to bodyUserId if provided
      }
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Authentication required. Please log in or configure your Gemini API key under Settings.'
      });
    }

    const keyRes = await resolveUserGeminiKey(supabase, userId, 'strategy-summary');
    if (!keyRes.keyPresent || !keyRes.apiKey) {
      return res.status(400).json({
        success: false,
        error: 'Gemini API key is required to generate strategy summary. Please configure your Gemini API key under Settings.'
      });
    }

    // Extract active strategy text if it's a JSON string
    let activeText = strategyText;
    try {
      const parsed = JSON.parse(strategyText);
      if (parsed && typeof parsed === 'object' && Array.isArray(parsed.strategies)) {
        const active = parsed.strategies.find((s: any) => s.id === parsed.activeId) || parsed.strategies[0];
        activeText = active ? (active.text || '') : '';
      }
    } catch (e) {
      // Not JSON, use as-is
    }

    // 1. Generate summary label using Gemini (max 4 words)
    const summary = await generateStrategySummary(activeText, {
      apiKey: keyRes.apiKey,
      userId,
      supabase,
      keySource: keyRes.keySource,
      watcherId: 'strategy-summary'
    });

    // 2. Store summary in DB if userId is provided
    let updatedInDb = false;
    if (userId) {
      try {
        const { error } = await supabase
          .from('trading_preferences')
          .upsert({
            user_id: userId,
            strategy_text: strategyText,
            strategy_summary: summary,
            updated_at: new Date().toISOString()
          }, { onConflict: 'user_id' });

        if (!error) {
          updatedInDb = true;
        } else if (error.message?.includes('strategy_summary') || error.code === 'PGRST204' || error.message?.includes('schema cache')) {
          console.warn('[Strategy Summary API] Note: strategy_summary column not present in trading_preferences table yet. Upserting strategy_text safely without it.');
          const { error: fallbackErr } = await supabase
            .from('trading_preferences')
            .upsert({
              user_id: userId,
              strategy_text: strategyText,
              updated_at: new Date().toISOString()
            }, { onConflict: 'user_id' });

          if (!fallbackErr) {
            updatedInDb = true;
          } else {
            console.error('[Strategy Summary API] Fallback upsert error:', fallbackErr.message);
          }
        } else {
          console.error('[Strategy Summary API] Supabase update error:', error.message);
        }
      } catch (dbErr: any) {
        console.error('[Strategy Summary API] Exception updating Supabase:', dbErr.message);
      }
    }

    return res.status(200).json({
      success: true,
      strategy_summary: summary,
      updated_in_db: updatedInDb
    });
  } catch (err: any) {
    console.error('[Strategy Summary API] Error:', err.message);
    const statusCode = err.errorType === 'QUOTA_EXHAUSTED' ? 429 : 400;
    return res.status(statusCode).json({
      success: false,
      error: err.message || 'Internal server error',
      errorType: err.errorType
    });
  }
}
