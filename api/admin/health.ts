import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

const SUPABASE_URL = "https://wkujrqmxivljnuvumfau.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_PUBLIC_KEY;
const supabase = createClient(SUPABASE_URL, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

export default async function handler(req: any, res: any) {
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

    const startSupa = Date.now();
    const { error: supaErr } = await supabase.from('profiles').select('id').limit(1);
    const supabaseStatus = !supaErr ? 'ONLINE' : 'ERROR';
    const supabaseLatency = Date.now() - startSupa;

    let geminiStatus = 'OFFLINE';
    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        await ai.models.generateContent({
          model: "gemini-2.5-flash",
          contents: "Respond with exactly 'OK'",
        });
        geminiStatus = 'ONLINE';
      } catch (err) {
        geminiStatus = 'ERROR';
      }
    }

    let telegramStatus = 'OFFLINE';
    if (process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const resMe = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
        telegramStatus = resMe.ok ? 'ONLINE' : 'ERROR';
      } catch {
        telegramStatus = 'ERROR';
      }
    }

    let twelveDataStatus = 'OFFLINE';
    if (process.env.TWELVE_DATA_API_KEY) {
      try {
        const resQuote = await fetch(`https://api.twelvedata.com/quote?symbol=EUR/USD&apikey=${process.env.TWELVE_DATA_API_KEY}`);
        twelveDataStatus = resQuote.ok ? 'ONLINE' : 'ERROR';
      } catch {
        twelveDataStatus = 'ERROR';
      }
    }

    const { data: latestScans } = await supabase.from('watchers').select('last_scan_at').order('last_scan_at', { ascending: false }).limit(1);
    const lastCronTime = (latestScans && latestScans[0]?.last_scan_at) || null;
    let cronStatus = 'ONLINE';
    if (lastCronTime) {
      const diffHours = (Date.now() - new Date(lastCronTime).getTime()) / (1000 * 60 * 60);
      if (diffHours > 24) {
        cronStatus = 'OFFLINE';
      }
    } else {
      cronStatus = 'OFFLINE';
    }

    return res.status(200).json({
      success: true,
      health: {
        supabase: { status: supabaseStatus, timestamp: new Date().toISOString(), details: `${supabaseLatency}ms latency` },
        gemini: { status: geminiStatus, timestamp: new Date().toISOString() },
        telegram: { status: telegramStatus, timestamp: new Date().toISOString() },
        twelveData: { status: twelveDataStatus, timestamp: new Date().toISOString() },
        cron: { status: cronStatus, timestamp: new Date().toISOString(), details: lastCronTime ? `Last run: ${new Date(lastCronTime).toLocaleString()}` : "Never run" }
      }
    });
  } catch (err: any) {
    console.error("Health check error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
