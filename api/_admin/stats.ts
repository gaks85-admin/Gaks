import { getSupabase } from '../../lib/supabase-server';

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

    // Fetch stats
    const { data: profiles, error: pErr } = await supabase.from('profiles').select('id');
    if (pErr) throw pErr;
    
    const { data: activeW, error: awErr } = await supabase.from('watchers').select('id').eq('status', 'active');
    if (awErr) throw awErr;
    const { data: stoppedW, error: swErr } = await supabase.from('watchers').select('id').eq('status', 'stopped');
    if (swErr) throw swErr;
    const { data: pausedW, error: pwErr } = await supabase.from('watchers').select('id').eq('status', 'paused');
    if (pwErr) throw pwErr;

    const { data: tgConn, error: tgErr } = await supabase.from('telegram_connections').select('id').eq('connected', true);
    const tgCount = tgErr ? 0 : (tgConn?.length || 0);

    const { data: keys, error: kErr } = await supabase.from('user_api_keys').select('user_id').eq('provider', 'gemini');
    const keysSet = new Set(keys?.map(k => k.user_id) || []);
    const missingKeyCount = (profiles || []).filter(u => !keysSet.has(u.id)).length;

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: sigs, error: sigErr } = await supabase.from('signals').select('id').gte('timestamp', oneDayAgo);
    const sigsCount = sigErr ? 0 : (sigs?.length || 0);

    const { data: latestScans } = await supabase.from('watchers').select('last_scan_at').order('last_scan_at', { ascending: false }).limit(1);
    const lastCronRun = (latestScans && latestScans[0]?.last_scan_at) || null;

    // Fetch unique pairs being monitored
    const { data: allWatchers } = await supabase.from('watchers').select('selected_pair');
    const uniquePairsSet = new Set(allWatchers?.map(w => w.selected_pair).filter(Boolean) || []);
    const totalPairsMonitored = uniquePairsSet.size;

    // Fetch total signals sent
    const { count: totalSignalsCount } = await supabase
      .from('signals')
      .select('*', { count: 'exact', head: true });

    return res.status(200).json({
      success: true,
      stats: {
        totalUsers: profiles?.length || 0,
        activeWatchers: activeW?.length || 0,
        stoppedWatchers: (stoppedW?.length || 0) + (pausedW?.length || 0),
        telegramConnected: tgCount,
        missingGeminiKey: missingKeyCount,
        signalsToday: sigsCount,
        totalSignalsSent: totalSignalsCount || 0,
        totalPairsMonitored,
        lastCronRun,
        systemStatus: "ONLINE"
      }
    });
  } catch (err: any) {
    console.error("Failed to fetch admin stats:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
