import { Request, Response } from 'express';
import { createClient } from '@supabase/supabase-js';
import { generateStrategySummary } from '../../src/lib/strategy-summarizer.js';

const getSupabase = () => {
  const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  return createClient(url!, key!, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
};

export default async function strategySummaryHandler(req: Request, res: Response) {
  try {
    const { strategyText, userId } = req.body;

    if (!strategyText || typeof strategyText !== 'string') {
      return res.status(400).json({
        success: false,
        error: 'Missing strategyText in request body.'
      });
    }

    // 1. Generate summary label using Gemini (max 4 words)
    const summary = await generateStrategySummary(strategyText);

    // 2. Store summary in DB if userId is provided
    let updatedInDb = false;
    if (userId) {
      try {
        const supabase = getSupabase();
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
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error'
    });
  }
}
