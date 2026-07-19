import { createClient } from '@supabase/supabase-js';

/**
 * Self-contained Supabase client initialization.
 */
const getSupabase = () => {
  const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    throw new Error('Supabase configuration missing (VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required)');
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });
};

export default async function handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
  
  if (!token) {
    return res.status(401).json({ success: false, error: "Unauthorized: Missing authentication token." });
  }
  
  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: "Unauthorized: Invalid authentication token." });
    }
    
    const email = user.email?.trim().toLowerCase();
    const ADMIN_EMAIL = "gaks6535@gmail.com";
    if (email !== ADMIN_EMAIL) {
      return res.status(403).json({ success: false, error: "Unauthorized: Insufficient privileges." });
    }

    const { data: profiles, error: pErr } = await supabase.from('profiles').select('*');
    if (pErr) throw pErr;

    const { data: watchers } = await supabase.from('watchers').select('*');
    const { data: keys } = await supabase.from('user_api_keys').select('*').eq('provider', 'gemini');

    const assembledUsers = (profiles || []).map(p => {
      const watcher = watchers?.find(w => w.user_id === p.id);
      const hasKey = keys?.some(k => k.user_id === p.id && k.api_key);

      return {
        id: p.id,
        email: p.email,
        full_name: p.full_name,
        created_at: p.created_at,
        telegram_connected: p.telegram_connected,
        gemini_configured: !!hasKey,
        watcher_status: watcher?.status || 'stopped',
        selected_pair: watcher?.selected_pair || 'None',
        selected_timeframe: watcher?.selected_timeframe || 'None',
        selected_strategy: watcher?.strategy_id ? 'Custom' : 'Default',
        last_scan_at: watcher?.last_scan_at || null
      };
    });

    return res.status(200).json({ success: true, users: assembledUsers });
  } catch (err: any) {
    console.error("Failed to fetch admin users:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
