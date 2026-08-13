import { createClient } from '@supabase/supabase-js';
import { getUserPerformanceSnapshot } from '../../src/lib/performance-snapshot.js';
import { getLearningStatus } from '../../src/lib/learning-status.js';
import { verifyAdminAuth } from '../auth-admin.js';

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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();

    if (!token) {
      return res.status(401).json({
        error: 'Unauthorized'
      });
    }

    const supabase = getSupabase(token);

    // 1. Enforce Server-Side Admin Authorization Check FIRST
    // Prevents unauthorized calculation of expensive performance diagnostics
    const authResult = await verifyAdminAuth(req, supabase);
    if (!authResult.isAdmin) {
      return res.status(authResult.statusCode || 403).json({
        error: authResult.error || 'Forbidden'
      });
    }

    // 2. Admin authorized: determine target user scope
    const targetUserId = req.query?.userId || req.body?.userId || authResult.userId;
    if (!targetUserId) {
      return res.status(400).json({
        error: 'Missing user ID'
      });
    }

    console.log(`[PERFORMANCE SNAPSHOT API] Admin (${authResult.email}) requesting snapshot for user: ${targetUserId}`);

    const snapshot = await getUserPerformanceSnapshot(targetUserId, { supabase });
    const learningStatus = await getLearningStatus(targetUserId, { supabase, completedTrades: snapshot ? undefined : [] });

    return res.status(200).json({
      success: true,
      snapshot,
      learningStatus
    });
  } catch (err: any) {
    console.error('[PERFORMANCE SNAPSHOT API Error]', err);
    return res.status(500).json({
      error: 'Internal server error while compiling performance snapshot'
    });
  }
}
