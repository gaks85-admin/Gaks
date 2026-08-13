import { createClient } from '@supabase/supabase-js';
import { getUserPerformanceSnapshot } from '../../src/lib/performance-snapshot.js';
import { getLearningStatus } from '../../src/lib/learning-status.js';

const getSupabase = (token?: string) => {
  const url = process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  if (!url || !key) {
    throw new Error('Supabase configuration missing');
  }

  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers }
  });
};

export default async function performanceSnapshotHandler(req: any, res: any) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

    let userId: string | null = null;
    let supabase = getSupabase(token);

    if (token) {
      const { data: { user }, error: authErr } = await supabase.auth.getUser(token);
      if (!authErr && user) {
        userId = user.id;
      }
    }

    if (!userId && req.body?.userId) {
      userId = req.body.userId;
    }

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: 'Unauthorized: Valid user authentication token required.'
      });
    }

    console.log(`[PERFORMANCE SNAPSHOT API] Fetching snapshot for user: ${userId}`);

    const snapshot = await getUserPerformanceSnapshot(userId, { supabase });
    const learningStatus = await getLearningStatus(userId, { supabase, completedTrades: snapshot ? undefined : [] });

    return res.status(200).json({
      success: true,
      snapshot,
      learningStatus
    });
  } catch (err: any) {
    console.error('[PERFORMANCE SNAPSHOT API Error]', err);
    return res.status(500).json({
      success: false,
      error: err.message || 'Internal server error while compiling performance snapshot'
    });
  }
}
