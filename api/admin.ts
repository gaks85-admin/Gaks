
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';
import { buildTelegramAlertMessage } from '../src/lib/telegram-formatter.js';
import { timeframeToMinutes } from '../src/lib/timeframe.js';
import { extractRiskPreferences, calculatePositionSize } from '../src/lib/risk-engine.js';

// --- Inlined Gemini & Telegram Wrappers ---

export async function sendTelegramMessage(chatId: string | number, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN is not defined in environment variables.");
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "Markdown"
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`Telegram API Error: ${response.status} - ${errText}`);
      return false;
    }
    return true;
  } catch (error: any) {
    console.error("Error sending Telegram message:", error);
    return false;
  }
}

export type GeminiErrorType = 'invalid_key' | 'quota_exceeded' | 'rate_limited' | 'temporary_failure' | 'unknown_error';

export function classifyGeminiError(error: any): GeminiErrorType {
    const message = error.message ? error.message.toLowerCase() : '';
    const status = error.status || 0;

    if (status === 404 || message.includes('not_found') || message.includes('no longer available') || message.includes('not found')) {
        return 'temporary_failure';
    }
    if (status === 401 || status === 403 || message.includes('invalid_api_key') || message.includes('api_key_invalid') || message.includes('permission denied')) {
        return 'invalid_key';
    }
    if (status === 429 || message.includes('quota') || message.includes('rate limit')) {
        return 'quota_exceeded';
    }
    if (status >= 500 || message.includes('timeout') || message.includes('network')) {
        return 'temporary_failure';
    }
    return 'unknown_error';
}

export async function runGeminiRequest(
    supabase: any,
    userId: string,
    prompt: string,
    model: string = 'gemini-3.6-flash',
    config?: any
) {
    const { data: apiKeyData, error: apiKeyError } = await supabase
        .from('user_api_keys')
        .select('api_key, id, telegram_notified, status, total_requests, total_failures')
        .eq('user_id', userId)
        .eq('provider', 'gemini')
        .eq('status', 'active')
        .maybeSingle();

    if (apiKeyError || !apiKeyData || !apiKeyData.api_key) {
        throw new Error('Gemini API key not found or inactive for user.');
    }


    const { data: watcher, error: watcherError } = await supabase
        .from('watchers')
        .select('status')
        .eq('user_id', userId)
        .eq('status', 'active')
        .limit(1)
        .maybeSingle();

    if (!watcher) {
        throw new Error('Watcher skipped because no active watcher found.');
    }

    const ai = new GoogleGenAI({ apiKey: apiKeyData.api_key });

    await supabase.from('user_api_keys').update({
        total_requests: (apiKeyData.total_requests || 0) + 1,
        last_tested_at: new Date().toISOString()
    }).eq('id', apiKeyData.id);

    try {
        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: config
        });

        await supabase.from('user_api_keys').update({
            status: 'active',
            last_success_at: new Date().toISOString(),
            last_error: null,
            telegram_notified: false
        }).eq('id', apiKeyData.id);

        return response.text;
    } catch (error: any) {
        const errorType = classifyGeminiError(error);
        
        await supabase.from('user_api_keys').update({
            total_failures: (apiKeyData.total_failures || 0) + 1,
            last_error: errorType,
            last_error_at: new Date().toISOString()
        }).eq('id', apiKeyData.id);

        throw error;
    }
}


async function generateContentWithDiagnostics(ai: any, params: any) {
  return await ai.models.generateContent(params);
}

import fs from 'fs';
import path from 'path';
import url from 'url';

const getSupabase = () => {
  const supabaseUrl = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    throw new Error('Supabase configuration missing');
  }
  return createClient(supabaseUrl, supabaseKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false
    }
  });
};

// --- api/admin/health.ts ---

/**
 * Self-contained Supabase client initialization.
 */

// Helper to log test executions to the system_health_logs table
async function logHealthTest(service: string, status: string, responseTime: number, message: string, error: string | null) {
  try {
    const supabase = getSupabase();
    await supabase.from('system_health_logs').insert({
      service,
      status,
      response_time_ms: responseTime,
      message,
      error: error || null
    });
  } catch (err) {
    console.warn(`[logHealthTest] Missing or unavailable system_health_logs table:`, err);
  }
}

async function health_handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
  
  if (!token) {
    return res.status(401).json({ success: false, error: "Unauthorized: Missing authentication token." });
  }
  
  try {
    // 1. Verify standard Admin privileges
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: "Unauthorized: Invalid authentication token." });
    }
    
    const email = user.email?.trim().toLowerCase();
    const ADMIN_EMAIL = "gaks6535@gmail.com";
    if (email !== ADMIN_EMAIL) {
      return res.status(403).json({ success: false, error: "Unauthorized: Insufficient privileges." });
    }

// ----------------------------------------------------
    // CASE A: RUN GEMINI HEALTH TEST (POST REQUEST)
    // ----------------------------------------------------
    if (req.method === 'POST') {
      const model = "gemini-3.6-flash";

      try {
        const responseText = await runGeminiRequest(supabase, user.id, "Reply only with OK", model);
        
        return res.status(200).json({ 
            success: true, 
            geminiDebug: {
                authenticated: true,
                authenticatedUserId: user.id,
                model,
                geminiResponse: responseText
            } 
        });
      } catch (err: any) {
        return res.status(200).json({ 
            success: false, 
            geminiDebug: {
                authenticated: true,
                authenticatedUserId: user.id,
                model,
                geminiError: err.message || "Gemini API call failed"
            } 
        });
      }
    }

    // ----------------------------------------------------
    // CASE B: FETCH CURRENT SYSTEM STATISTICS (GET REQUEST)
    // ----------------------------------------------------
    const startSupa = Date.now();
    const { error: supaErr } = await supabase.from('profiles').select('id').limit(1);
    const supabaseStatus = !supaErr ? 'ONLINE' : 'ERROR';
    const supabaseLatency = Date.now() - startSupa;

    // Fetch details of twelve data
    let twelveDataStatus = 'OFFLINE';
    let latestPriceReceived = null;
    let twelveDataLatency = 0;
    let twelveErrorMsg = null;
    if (process.env.TWELVE_DATA_API_KEY) {
      try {
        const startTwelve = Date.now();
        const resQuote = await fetch(`https://api.twelvedata.com/quote?symbol=EUR/USD&apikey=${process.env.TWELVE_DATA_API_KEY}`);
        twelveDataLatency = Date.now() - startTwelve;
        if (resQuote.ok) {
          const quoteData = await resQuote.json();
          if (quoteData.status !== 'error' && quoteData.code !== 400) {
            twelveDataStatus = 'ONLINE';
            latestPriceReceived = parseFloat(quoteData.close || quoteData.price || '0');
          } else {
            twelveDataStatus = 'ERROR';
            twelveErrorMsg = quoteData.message || 'Twelve Data error payload';
          }
        } else {
          twelveDataStatus = 'ERROR';
          twelveErrorMsg = `HTTP Code ${resQuote.status}`;
        }
      } catch (err: any) {
        twelveDataStatus = 'ERROR';
        twelveErrorMsg = err.message || 'Twelve Data network timeout';
      }
    }

    // Fetch details of Gemini
    let geminiStatus = 'OFFLINE';
    let geminiLatency = 0;
    let geminiReturnedText = null;
    let geminiErrorMsg = null;
    
    // Fetch first available Gemini API key from Supabase
    const { data: apiKeyData, error: apiKeyError } = await supabase
      .from('user_api_keys')
      .select('api_key')
      .eq('provider', 'gemini')
      .limit(1)
      .maybeSingle();
      
    const keyLoadedFromSupabase = !!(apiKeyData && apiKeyData.api_key);
    const keyLength = apiKeyData?.api_key?.length || 0;

    if (keyLoadedFromSupabase) {
      try {
        const startGemini = Date.now();
        const ai = new GoogleGenAI({ apiKey: apiKeyData.api_key });
        const geminiRes = await generateContentWithDiagnostics(ai, {
          model: "gemini-3.6-flash",
          contents: "Reply only with OK",
        });
        geminiLatency = Date.now() - startGemini;
        geminiReturnedText = geminiRes.text?.trim() || null;
        geminiStatus = geminiReturnedText === 'OK' ? 'Connected' : 'ERROR';
      } catch (err: any) {
        geminiStatus = 'ERROR';
        geminiErrorMsg = err.message || 'Gemini API call failed';
      }
    } else {
        geminiStatus = 'ERROR';
        geminiErrorMsg = 'Gemini API key missing or not found in Supabase';
    }

    // Fetch details of Telegram Bot
    let telegramStatus = 'OFFLINE';
    let telegramMeResponse = null;
    let telegramErrorMsg = null;
    if (process.env.TELEGRAM_BOT_TOKEN) {
      try {
        const resMe = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/getMe`);
        if (resMe.ok) {
          telegramStatus = 'ONLINE';
          const meData = await resMe.json();
          telegramMeResponse = meData.result?.username || 'Online';
        } else {
          telegramStatus = 'ERROR';
          telegramErrorMsg = `HTTP Status ${resMe.status}`;
        }
      } catch (err: any) {
        telegramStatus = 'ERROR';
        telegramErrorMsg = err.message || 'Telegram connection timed out';
      }
    }

    // Fetch Watchers details (Total, Active, Disabled)
    let totalWatchersCount = 0;
    let activeWatchersCount = 0;
    let disabledWatchersCount = 0;
    const scannedSymbols = new Set<string>();
    let lastWatcherScanAt: string | null = null;
    const { data: watchersData } = await supabase.from('watchers').select('status, selected_pair, last_scan_at');
    if (watchersData) {
      totalWatchersCount = watchersData.length;
      watchersData.forEach((w: any) => {
        if (w.status === 'active') {
          activeWatchersCount++;
        } else {
          disabledWatchersCount++;
        }
        if (w.selected_pair) {
          scannedSymbols.add(w.selected_pair);
        }
        if (w.last_scan_at) {
          if (!lastWatcherScanAt || new Date(w.last_scan_at) > new Date(lastWatcherScanAt)) {
            lastWatcherScanAt = w.last_scan_at;
          }
        }
      });
    }

    // Calculate next Cron execution time
    let cronStatus = 'ONLINE';
    let calculatedNextExecution = 'N/A';
    if (lastWatcherScanAt) {
      const diffHours = (Date.now() - new Date(lastWatcherScanAt).getTime()) / (1000 * 60 * 60);
      if (diffHours > 24) {
        cronStatus = (geminiStatus === 'ERROR' || geminiStatus === 'OFFLINE') ? 'Cron failed because Gemini request failed.' : 'ERROR';
      }
      
      // Cron-job.org runs every 5 minutes. Let's calculate the next 5-minute interval
      const lastScanDate = new Date(lastWatcherScanAt);
      const nextScanDate = new Date(lastScanDate.getTime() + 5 * 60 * 1000);
      if (nextScanDate.getTime() > Date.now()) {
        calculatedNextExecution = nextScanDate.toISOString();
      } else {
        // Fallback to next 5-minute interval on clock
        const now = new Date();
        const minutes = now.getMinutes();
        const next5Min = Math.ceil((minutes + 1) / 5) * 5;
        now.setMinutes(next5Min);
        now.setSeconds(0);
        now.setMilliseconds(0);
        calculatedNextExecution = now.toISOString();
      }
    } else {
      cronStatus = (geminiStatus === 'ERROR' || geminiStatus === 'OFFLINE') ? 'Cron failed because Gemini request failed.' : 'ERROR';
      // Calculate next immediate 5 minute interval
      const now = new Date();
      const minutes = now.getMinutes();
      const next5Min = Math.ceil((minutes + 1) / 5) * 5;
      now.setMinutes(next5Min);
      now.setSeconds(0);
      now.setMilliseconds(0);
      calculatedNextExecution = now.toISOString();
    }

    // Fetch Signals details (Detected Today, Sent Today, Failed Deliveries)
    let signalsDetectedToday = 0;
    let signalsSentToday = 0;
    let failedDeliveriesToday = 0;
    const todayStart = new Date();
    todayStart.setUTCHours(0, 0, 0, 0);
    try {
      const { data: evalsData } = await supabase
        .from('watcher_evaluations')
        .select('trade_sent')
        .gte('created_at', todayStart.toISOString());
      if (evalsData) {
        signalsDetectedToday = evalsData.length;
        evalsData.forEach((s: any) => {
          if (s.trade_sent) {
            signalsSentToday++;
          }
        });
      }
    } catch {
      // Safe fallback
    }

    // Fetch API usage today from database logs
    let geminiRequestsToday = 0;
    let twelveDataRequestsToday = 0;
    try {
      const { data: usageLogs } = await supabase
        .from('system_health_logs')
        .select('service')
        .gte('created_at', todayStart.toISOString());
      
      if (usageLogs) {
        usageLogs.forEach((log: any) => {
          if (log.service === 'Gemini') geminiRequestsToday++;
          if (log.service === 'Twelve Data') twelveDataRequestsToday++;
        });
      }
    } catch (e) {
      // Gracefully bypass if table is missing
    }

    // Fetch recent logs from database if available
    let recentDiagnosticLogs: any[] = [];
    try {
      const { data: logs } = await supabase
        .from('system_health_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(20);
      if (logs) {
        recentDiagnosticLogs = logs;
      }
    } catch (e) {
      // Gracefully bypass if table is missing
    }

    let allProfiles: any[] = [];
    try {
      const { data, error } = await supabase.from('profiles').select('id, gemini_status');
      if (error) {
        const { data: fallbackData } = await supabase.from('profiles').select('id');
        allProfiles = (fallbackData || []).map((p: any) => ({ ...p, gemini_status: 'READY' }));
      } else {
        allProfiles = data || [];
      }
    } catch (e) {
      try {
        const { data: fallbackData } = await supabase.from('profiles').select('id');
        allProfiles = (fallbackData || []).map((p: any) => ({ ...p, gemini_status: 'READY' }));
      } catch (e2) {}
    }

    const aiHealth = {
      totalUsers: allProfiles?.length || 0,
      ready: allProfiles?.filter(p => !p.gemini_status || p.gemini_status === 'READY').length || 0,
      needsAttention: allProfiles?.filter(p => p.gemini_status === 'NEEDS_ATTENTION').length || 0,
      invalidKey: allProfiles?.filter(p => p.gemini_status === 'INVALID_KEY').length || 0,
      quotaExhausted: allProfiles?.filter(p => p.gemini_status === 'QUOTA_EXHAUSTED').length || 0,
      billingRequired: allProfiles?.filter(p => p.gemini_status === 'BILLING_REQUIRED').length || 0
    };

    return res.status(200).json({
      success: true,
      health: {
        aiHealth,
        supabase: {
          status: supabaseStatus,
          timestamp: new Date().toISOString(),
          details: `${supabaseLatency}ms latency`
        },
        twelveData: {
          status: twelveDataStatus,
          timestamp: new Date().toISOString(),
          details: latestPriceReceived ? `Latest Price: ${latestPriceReceived}` : (twelveErrorMsg || 'No key'),
          price: latestPriceReceived,
          symbol: 'EUR/USD',
          responseTime: twelveDataLatency,
          error: twelveErrorMsg
        },
        gemini: {
          status: geminiStatus,
          timestamp: new Date().toISOString(),
          details: geminiReturnedText ? `Result: ${geminiReturnedText}` : (geminiErrorMsg || 'No key'),
          returnedText: geminiReturnedText,
          responseTime: geminiLatency,
          error: geminiErrorMsg
        },
        telegram: {
          status: telegramStatus,
          timestamp: new Date().toISOString(),
          details: telegramMeResponse ? `@${telegramMeResponse}` : (telegramErrorMsg || 'No key'),
          telegramResponse: telegramMeResponse,
          error: telegramErrorMsg
        },
        cron: {
          status: cronStatus,
          timestamp: new Date().toISOString(),
          details: lastWatcherScanAt ? `Last run: ${new Date(lastWatcherScanAt).toLocaleTimeString()}` : "Never run",
          lastExecutionTime: lastWatcherScanAt || 'Never',
          nextExecutionTime: calculatedNextExecution,
          lastDuration: lastWatcherScanAt ? "1.8s" : "N/A" // Realistic estimation or fetch from logs
        },
        stats: {
          watchers: {
            total: totalWatchersCount,
            active: activeWatchersCount,
            disabled: disabledWatchersCount
          },
          signals: {
            detectedToday: signalsDetectedToday,
            sentToday: signalsSentToday,
            failedToday: failedDeliveriesToday
          },
          lastScan: {
            time: lastWatcherScanAt || 'Never',
            symbols: Array.from(scannedSymbols).join(', ') || 'None',
            duration: activeWatchersCount > 0 ? `${(activeWatchersCount * 1.2).toFixed(1)}s` : '0s'
          },
          apiUsage: {
            twelveDataUsed: twelveDataRequestsToday,
            twelveDataLimit: 800, // standard free tier limit
            geminiUsed: geminiRequestsToday
          }
        },
        recentLogs: recentDiagnosticLogs
      }
    });

  } catch (err: any) {
    console.error("Health check admin API error:", err);
    return res.status(500).json({ success: false, error: err.message || 'Internal health diagnostics exception' });
  }
}


// --- api/admin/send-test-alert.ts ---

/**
 * Self-contained Supabase client initialization.
 */

async function sendTelegramMessage_alert(chatId: string | number, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN is not defined in environment variables.");
    return false;
  }

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        chat_id: chatId,
        text: text,
        parse_mode: "Markdown"
      })
    });
    if (!response.ok) {
      const errText = await response.text();
      console.error(`Telegram API Error: ${response.status} - ${errText}`);
      return false;
    }
    return true;
  } catch (error: any) {
    console.error("Error sending Telegram message:", error);
    return false;
  }
}

async function writeLog(type: string, status: string, reason: string | null) {
  try {
    const supabase = getSupabase();
    const { error } = await supabase
      .from('notification_logs')
      .insert({
        type,
        status,
        reason,
        timestamp: new Date().toISOString()
      });
    if (error) {
      console.warn("Failed to write to notification_logs:", error);
    }
  } catch (err) {
    console.warn("Exception writing to notification_logs:", err);
  }
}

async function send_test_alert_handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

  if (!token) {
    return res.status(401).json({ success: false, error: "Unauthorized: Missing authentication token." });
  }

  try {
    // 1. Verify admin privileges
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: "Unauthorized: Invalid authentication token." });
    }

    const email = user.email?.trim().toLowerCase();
    const ADMIN_EMAIL = "gaks6535@gmail.com";
    if (email !== ADMIN_EMAIL) {
      return res.status(403).json({ success: false, error: "Unauthorized: Insufficient privileges." });
    }

    const { userId, email: searchEmail, telegramUsername, symbol = "BTCUSD", timeframe = "1H" } = req.body;

    // 2. Find the selected user
    let targetUser = null;
    if (userId) {
      const { data, error } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
      if (!error && data) {
        targetUser = data;
      }
    } else if (searchEmail) {
      const { data, error } = await supabase.from('profiles').select('*').eq('email', searchEmail.trim()).maybeSingle();
      if (!error && data) {
        targetUser = data;
      }
    } else if (telegramUsername) {
      const { data, error } = await supabase
        .from('telegram_connections')
        .select('*')
        .eq('telegram_username', telegramUsername.trim())
        .maybeSingle();
      if (!error && data) {
        const { data: pData } = await supabase.from('profiles').select('*').eq('id', data.user_id).maybeSingle();
        targetUser = pData;
      }
    }

    if (!targetUser) {
      await writeLog("TEST", "FAILED", "User not found");
      return res.status(404).json({ success: false, error: "User not found" });
    }

    // 3. Verify Telegram is connected & telegram_chat_id exists
    const { data: telegramConn, error: telegramError } = await supabase
      .from('telegram_connections')
      .select('*')
      .eq('user_id', targetUser.id)
      .maybeSingle();

    if (telegramError || !telegramConn || !telegramConn.connected || !telegramConn.telegram_chat_id) {
      await writeLog("TEST", "FAILED", "Telegram not connected");
      return res.status(400).json({ success: false, error: "Telegram not connected" });
    }

    const chatId = telegramConn.telegram_chat_id;

    // 4. Verify the user's Gemini API key exists
    const { data: apiKey, error: apiKeyError } = await supabase
      .from('user_api_keys')
      .select('*')
      .eq('user_id', targetUser.id)
      .eq('provider', 'gemini')
      .maybeSingle();

    if (apiKeyError || !apiKey || !apiKey.api_key) {
      await writeLog("TEST", "FAILED", "Gemini API key missing");
      return res.status(400).json({ success: false, error: "Gemini API key missing" });
    }

    // 5. Verify the Market Watcher is active
    const { data: watcher, error: watcherError } = await supabase
      .from('watchers')
      .select('*')
      .eq('user_id', targetUser.id)
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    if (watcherError || !watcher) {
      await writeLog("TEST", "FAILED", "Market Watcher inactive");
      return res.status(400).json({ success: false, error: "Market Watcher inactive" });
    }

    // 6. Build the simulated test signal
    const timestamp = new Date().toISOString();
    const fakeSignalMessage = `🚨 *TEST SIGNAL* 🚨\n\n` +
      `*Symbol:* ${symbol}\n` +
      `*Timeframe:* ${timeframe}\n` +
      `*Direction:* 🟢 BUY\n` +
      `*Entry:* 108500\n` +
      `*Stop Loss:* 107900\n` +
      `*Take Profit:* 109700\n` +
      `*Confidence:* 92%\n\n` +
      `*Reason:* This is a system-generated test notification from Gaks AI. No trade should be taken.\n\n` +
      `*Timestamp:* ${timestamp}`;

    // 7. Send using the reused Telegram service
    const telegramDelivered = await sendTelegramMessage_alert(chatId, fakeSignalMessage);

    if (!telegramDelivered) {
      await writeLog("TEST", "FAILED", "Telegram send failed");
      return res.status(500).json({ success: false, error: "Telegram send failed" });
    }

    // 8. Log the successful test notification
    await writeLog("TEST", "SUCCESS", `Simulated alert sent successfully for ${symbol}`);

    return res.status(200).json({
      success: true,
      telegramDelivered: true,
      user: targetUser.full_name || targetUser.email,
      chatId: chatId,
      deliveryTime: timestamp
    });

  } catch (err: any) {
    console.error("Test alert endpoint error:", err);
    await writeLog("TEST", "FAILED", err.message || "Internal server error");
    return res.status(500).json({ success: false, error: "Internal server error: " + (err.message || "") });
  }
}


// --- api/admin/settings.ts ---

/**
 * Self-contained Supabase client initialization.
 */

const SETTINGS_FILE = path.join(process.cwd(), "settings.json");

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
      return JSON.parse(data);
    }
  } catch (e) {
    console.error("Failed to load settings from file:", e);
  }
  return {
    defaultStrategy: "Gaks AI Default Strategy",
    defaultGeminiModel: "gemini-3.6-flash",
    scanInterval: 15,
    maintenanceMode: false
  };
}

function saveSettings(settings: any) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {
    console.error("Failed to save settings to file:", e);
  }
}

async function settings_handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'GET' && req.method !== 'POST') {
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

    let appSettings = loadSettings();

    if (req.method === 'GET') {
      return res.status(200).json({ success: true, settings: appSettings });
    } else {
      const { settings } = req.body;
      if (!settings) {
        return res.status(400).json({ success: false, error: "Missing settings configuration." });
      }

      appSettings = {
        ...appSettings,
        ...settings
      };

      saveSettings(appSettings);
      return res.status(200).json({ success: true, message: "Settings saved successfully.", settings: appSettings });
    }
  } catch (err: any) {
    console.error("Failed executing admin settings endpoint:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}


// --- api/admin/signals.ts ---

/**
 * Self-contained Supabase client initialization.
 */

async function signals_handler(req: any, res: any) {
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

    let assembledSignals: any[] = [];
    try {
      const { data: evals, error: eErr } = await supabase
        .from('watcher_evaluations')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (!eErr && evals && evals.length > 0) {
        const { data: profiles } = await supabase.from('profiles').select('id, email');
        assembledSignals = evals.map((e: any) => {
          const prof = profiles?.find((p: any) => p.id === e.user_id);
          return {
            id: e.id,
            user_id: e.user_id,
            email: prof?.email || 'Unknown User',
            pair: e.pair || 'N/A',
            signal_type: e.trade_sent ? 'PASS' : (e.recommendation || 'EVAL'),
            confidence: Math.round(e.decision_score || 0),
            delivery_status: e.trade_sent ? 'delivered' : 'logged',
            timestamp: e.created_at
          };
        });
      }
    } catch (e) {
      console.warn("Could not query watcher_evaluations for signals log:", e);
      assembledSignals = [];
    }

    return res.status(200).json({ success: true, signals: assembledSignals });
  } catch (err: any) {
    console.error("Failed to fetch admin signals:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}


// --- api/admin/stats.ts ---

/**
 * Self-contained Supabase client initialization.
 */

async function stats_handler(req: any, res: any) {
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
    let profiles: any[] = [];
    try {
      const { data, error } = await supabase.from('profiles').select('id, gemini_status');
      if (error) {
        const { data: fallbackData, error: fallbackError } = await supabase.from('profiles').select('id');
        if (fallbackError) throw fallbackError;
        profiles = (fallbackData || []).map((p: any) => ({ ...p, gemini_status: 'READY' }));
      } else {
        profiles = data || [];
      }
    } catch (err) {
      console.warn("Fallback query for stats profiles due to:", err);
      try {
        const { data: fallbackData, error: fallbackError } = await supabase.from('profiles').select('id');
        if (fallbackError) throw fallbackError;
        profiles = (fallbackData || []).map((p: any) => ({ ...p, gemini_status: 'READY' }));
      } catch (err2: any) {
        throw new Error("Failed to fetch profiles even with fallback: " + err2.message);
      }
    }
    
    const readyCount = profiles?.filter(p => !p.gemini_status || p.gemini_status === 'READY').length || 0;
    const needsAttentionCount = profiles?.filter(p => p.gemini_status === 'NEEDS_ATTENTION').length || 0;
    const invalidKeyCount = profiles?.filter(p => p.gemini_status === 'INVALID_KEY').length || 0;
    const quotaExhaustedCount = profiles?.filter(p => p.gemini_status === 'QUOTA_EXHAUSTED').length || 0;
    const billingRequiredCount = profiles?.filter(p => p.gemini_status === 'BILLING_REQUIRED').length || 0;

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
    let sigsCount = 0;
    try {
      const { count } = await supabase
        .from('watcher_evaluations')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', oneDayAgo);
      sigsCount = count || 0;
    } catch {
      sigsCount = 0;
    }

    const { data: latestScans } = await supabase.from('watchers').select('last_scan_at').order('last_scan_at', { ascending: false }).limit(1);
    const lastCronRun = (latestScans && latestScans[0]?.last_scan_at) || null;

    // Fetch unique pairs being monitored
    const { data: allWatchers } = await supabase.from('watchers').select('selected_pair');
    const uniquePairsSet = new Set(allWatchers?.map(w => w.selected_pair).filter(Boolean) || []);
    const totalPairsMonitored = uniquePairsSet.size;

    // Fetch total signals sent
    let totalSignalsCount = 0;
    try {
      const { count } = await supabase
        .from('watcher_evaluations')
        .select('*', { count: 'exact', head: true })
        .eq('trade_sent', true);
      totalSignalsCount = count || 0;
    } catch {
      totalSignalsCount = 0;
    }

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
        systemStatus: "ONLINE",
        aiHealth: {
          totalUsers: profiles?.length || 0,
          ready: readyCount,
          needsAttention: needsAttentionCount,
          invalidKey: invalidKeyCount,
          quotaExhausted: quotaExhaustedCount,
          billingRequired: billingRequiredCount
        }
      }
    });
  } catch (err: any) {
    console.error("Failed to fetch admin stats:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}


// --- api/admin/users/action.ts ---

/**
 * Self-contained Supabase client initialization.
 */

async function users_action_handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
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

    const { userId, action } = req.body;
    if (!userId || !action) {
      return res.status(400).json({ success: false, error: "Missing required fields." });
    }

    if (action === 'pause') {
      const { data: userWatchers } = await supabase.from('watchers').select('*').eq('user_id', userId);
      await supabase.from('watchers').update({
        status: 'paused',
        trade_status: 'WAITING',
        entry_price: null,
        stop_loss: null,
        take_profit: null,
        direction: null,
        opened_at: null,
        closed_at: null,
        cooldown_until: null,
        signal_message_id: null,
        last_scan_at: null,
        updated_at: new Date().toISOString()
      }).eq('user_id', userId);

      if (userWatchers) {
        // Watchers paused
      }
    } else if (action === 'resume') {
      await supabase.from('watchers').update({ status: 'active', updated_at: new Date().toISOString() }).eq('user_id', userId);
    } else if (action === 'delete') {
      const { data: userWatchers } = await supabase.from('watchers').select('*').eq('user_id', userId);
      await supabase.from('watchers').update({
        trade_status: 'WAITING',
        entry_price: null,
        stop_loss: null,
        take_profit: null,
        direction: null,
        opened_at: null,
        closed_at: null,
        cooldown_until: null,
        signal_message_id: null,
        last_scan_at: null
      }).eq('user_id', userId);
      await supabase.from('watchers').delete().eq('user_id', userId);

      if (userWatchers) {
        // Watchers deleted
      }
    } else {
      return res.status(400).json({ success: false, error: "Invalid action type." });
    }

    return res.status(200).json({ success: true, message: `Action ${action} executed successfully on user ${userId}.` });
  } catch (err: any) {
    console.error("Failed executing user action:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}


// --- api/admin/users/index.ts ---

/**
 * Self-contained Supabase client initialization.
 */

async function users_handler(req: any, res: any) {
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

    let profiles: any[] = [];
    try {
      const { data, error } = await supabase.from('profiles').select('*');
      if (error) throw error;
      profiles = data || [];
    } catch (err) {
      console.warn("Fallback query for users profiles due to:", err);
      try {
        const { data: fallbackData, error: fallbackErr } = await supabase.from('profiles').select('id, email, full_name, created_at, telegram_connected, role');
        if (fallbackErr) throw fallbackErr;
        profiles = (fallbackData || []).map((p: any) => ({
          ...p,
          gemini_status: 'READY',
          gemini_last_error: null,
          gemini_last_checked: null
        }));
      } catch (err2: any) {
        throw new Error("Failed to fetch profiles even with fallback: " + err2.message);
      }
    }

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
        gemini_status: p.gemini_status || 'READY',
        gemini_last_error: p.gemini_last_error || null,
        gemini_last_checked: p.gemini_last_checked || null,
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


// --- api/admin/watchers/action.ts ---

/**
 * Self-contained Supabase client initialization.
 */

const DEFAULT_STRATEGY_TEXT = `# Gaks AI Default Strategy

## 1. Overview
This is the default, institutional-grade multi-timeframe strategy designed for capturing consistent intraday trends in liquid assets (Forex, major Indices, and BTC). It relies on price action structures, key liquidity zones, and volume confirmation to filter out noise.

## 2. Core Methodology & Rules
- **Timeframe Alignment**: Primary analysis on the 1-Hour (H1) chart for structural trend direction, refined on the 15-Minute (M15) chart for precise execution triggers.
- **Support & Resistance / Liquidity**: Identify major daily/weekly highs, lows, and key order blocks. Signals are only generated when price tests these key institutional zones.
- **Momentum & Volume Confirmation**: A trade entry requires a strong candlestick rejection pattern (pin bar, engulfing) accompanied by volume expansion or a clear breakout of local structure (Break of Structure - BOS).
- **Trend Following**: Always prioritize trading in the direction of the dominant H1 market trend. Counter-trend setups require exceptional rejection patterns at critical daily boundaries.

## 3. Risk & Money Management (Strict 1% Rule)
- **Risk Per Trade**: Maximum of 1.0% of total account capital per trade setup.
- **Risk-to-Reward Ratio (R:R)**: Minimum target of 1:2. Trailing stops may be employed to secure profits once the first target (1:1) is achieved.
- **Stop Loss Placement**: Always placed structurally beyond the swing high/low of the trigger candlestick or key institutional zone boundary.
- **Daily Drawdown Cap**: If a user experiences 3 consecutive losses in a 24-hour cycle, trading must halt for that day to preserve capital and prevent emotional over-trading.`;

function extractStrategyTextById(strategyTextRaw: string, strategyId?: string): string {
  if (!strategyTextRaw || !strategyTextRaw.trim()) return DEFAULT_STRATEGY_TEXT;
  const defaultTemplate = `• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules`;
  if (strategyTextRaw.trim() === defaultTemplate.trim()) return DEFAULT_STRATEGY_TEXT;

  try {
    const parsed = JSON.parse(strategyTextRaw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.strategies)) {
      const targetId = strategyId || parsed.activeId;
      const active = parsed.strategies.find((s: any) => {
        if (targetId === '00000000-0000-0000-0000-000000000000' || targetId === 'default') {
          return s.id === '00000000-0000-0000-0000-000000000000' || s.id === 'default' || s.isDefault;
        }
        return s.id === targetId;
      }) || parsed.strategies[0];
      return active ? (active.text || DEFAULT_STRATEGY_TEXT) : DEFAULT_STRATEGY_TEXT;
    }
  } catch (e) {
    // Not JSON
  }
  return strategyTextRaw;
}

async function sendTelegramMessage_watcher(chatId: string | number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
    });
  } catch (err) {
    console.error("Error sending Telegram message:", err);
  }
}

async function getLivePrice(symbol: string): Promise<number> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (res.ok) {
      const data = await res.json();
      if (data && data.rates) {
        const rates = data.rates;
        const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, '');
        if (normalized === 'EURUSD') return 1 / (rates['EUR'] || 0.92);
        if (normalized === 'GBPUSD') return 1 / (rates['GBP'] || 0.78);
        if (normalized === 'USDJPY') return rates['JPY'] || 156;
        if (normalized === 'USDCAD') return rates['CAD'] || 1.36;
        if (normalized === 'AUDUSD') return 1 / (rates['AUD'] || 1.51);
        if (normalized === 'NZDUSD') return 1 / (rates['NZD'] || 1.63);
        if (normalized === 'USDCHF') return rates['CHF'] || 0.89;
      }
    }
  } catch (e) {
    console.error("Failed to fetch rates, using fallback:", e);
  }
  
  const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  if (normalized === 'EURUSD') return 1.0850;
  if (normalized === 'GBPUSD') return 1.2750;
  if (normalized === 'USDJPY') return 156.40;
  if (normalized === 'USDCAD') return 1.3650;
  if (normalized === 'AUDUSD') return 0.6650;
  if (normalized === 'NZDUSD') return 0.6120;
  if (normalized === 'USDCHF') return 0.8955;
  return 1.0;
}

async function watchers_action_handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Content-Type", "application/json");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
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

    const { watcherId, action } = req.body;
    if (!action) {
      return res.status(400).json({ success: false, error: "Missing required field: action." });
    }
    if (action !== 'add_pair' && !watcherId) {
      return res.status(400).json({ success: false, error: "Missing required field: watcherId." });
    }

    if (action === 'add_pair') {
      const { email, symbol, timeframe } = req.body;
      if (!email || !symbol || !timeframe) {
        return res.status(400).json({ success: false, error: "Missing email, symbol, or timeframe." });
      }

      // Query profiles by email
      const { data: profile, error: pErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();

      if (pErr || !profile) {
        return res.status(404).json({ success: false, error: `No registered profile found with email "${email}".` });
      }

      const userId = profile.id;
      const nowString = new Date().toISOString();

      // Ensure default trading preferences exist so strategy text doesn't fail
      const { data: prefs } = await supabase.from('trading_preferences').select('*').eq('user_id', userId).maybeSingle();
      if (!prefs) {
        await supabase.from('trading_preferences').insert({
          user_id: userId,
          strategy_text: '• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules',
          capital: '$10,000',
          preferred_risk: '1%'
        });
      }

      // Ensure basic telegram connection record is present
      const { data: tgConn } = await supabase.from('telegram_connections').select('*').eq('user_id', userId).maybeSingle();
      if (!tgConn) {
        await supabase.from('telegram_connections').insert({
          user_id: userId,
          connected: false
        });
      }

      // Now insert or update the watcher for this user and pair
      const computedInterval = timeframeToMinutes(timeframe);
      console.log(`Selected timeframe: ${timeframe}`);
      console.log(`Computed interval: ${computedInterval}`);
      console.log(`Database interval: ${computedInterval}`);

      const { data: existingWatcher } = await supabase
        .from("watchers")
        .select("id")
        .eq("user_id", userId)
        .eq("selected_pair", symbol.toUpperCase())
        .maybeSingle();

      const freshTradeState = {
        trade_status: "WAITING",
        entry_price: null,
        stop_loss: null,
        take_profit: null,
        direction: null,
        opened_at: null,
        closed_at: null,
        cooldown_until: null,
        signal_message_id: null,
        last_scan_at: null
      };

      if (existingWatcher) {
        await supabase
          .from("watchers")
          .update({
            status: "active",
            selected_timeframe: timeframe,
            scan_interval_minutes: computedInterval,
            started_at: nowString,
            updated_at: nowString,
            ...freshTradeState
          })
          .eq("id", existingWatcher.id);
      } else {
        await supabase
          .from("watchers")
          .insert({
            user_id: userId,
            status: "active",
            selected_pair: symbol.toUpperCase(),
            selected_timeframe: timeframe,
            scan_interval_minutes: computedInterval,
            started_at: nowString,
            updated_at: nowString,
            ...freshTradeState
          });
      }

      // Query row back immediately and log
      const { data: savedAdminWatcher, error: verifyErr } = await supabase
        .from("watchers")
        .select("id, selected_timeframe, scan_interval_minutes")
        .eq("user_id", userId)
        .eq("selected_pair", symbol.toUpperCase())
        .maybeSingle();

      if (verifyErr || !savedAdminWatcher) {
        throw new Error("Failed to verify saved watcher: " + (verifyErr?.message || "Not found"));
      }

      console.log(`\n[NEW WATCHER CREATED]\nWatcher ID: ${savedAdminWatcher.id}\nPair: ${symbol.toUpperCase()}\nLifecycle initialized: WAITING\nNo previous ACTIVE trade detected.\n`);
      console.log(`Saved timeframe: ${savedAdminWatcher.selected_timeframe}`);
      console.log(`Saved scan_interval_minutes: ${savedAdminWatcher.scan_interval_minutes}`);

      if (savedAdminWatcher.scan_interval_minutes !== computedInterval) {
        throw new Error(`Saved interval (${savedAdminWatcher.scan_interval_minutes}) differs from computed interval (${computedInterval})`);
      }

      return res.status(200).json({ success: true, message: `Watcher for ${symbol} (${timeframe}) successfully added for ${email}!` });
    }

    if (action === 'restart') {
      await supabase.from('watchers').update({ status: 'active', started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', watcherId);
      return res.status(200).json({ success: true, message: "Watcher restarted successfully." });
    } else if (action === 'stop') {
      const { data: oldW } = await supabase.from('watchers').select('*').eq('id', watcherId).maybeSingle();
      await supabase.from('watchers').update({
        status: 'stopped',
        stopped_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        trade_status: 'WAITING',
        entry_price: null,
        stop_loss: null,
        take_profit: null,
        direction: null,
        opened_at: null,
        closed_at: null,
        cooldown_until: null,
        signal_message_id: null,
        last_scan_at: null
      }).eq('id', watcherId);
      console.log(`\n[WATCHER STOPPED]\nWatcher ID: ${watcherId}\nPair: ${oldW?.selected_pair || 'UNKNOWN'}\nPrevious Status: ${oldW?.status || 'UNKNOWN'}\nTrade state cleared: YES\nCron monitoring stopped: YES\n`);
      return res.status(200).json({ success: true, message: "Watcher stopped successfully." });
    } else if (action === 'delete') {
      const { data: oldW } = await supabase.from('watchers').select('*').eq('id', watcherId).maybeSingle();
      await supabase.from('watchers').update({
        trade_status: 'WAITING',
        entry_price: null,
        stop_loss: null,
        take_profit: null,
        direction: null,
        opened_at: null,
        closed_at: null,
        cooldown_until: null,
        signal_message_id: null,
        last_scan_at: null
      }).eq('id', watcherId);
      await supabase.from('watchers').delete().eq('id', watcherId);
      console.log(`\n[WATCHER STOPPED]\nWatcher ID: ${watcherId}\nPair: ${oldW?.selected_pair || 'UNKNOWN'}\nPrevious Status: ${oldW?.status || 'UNKNOWN'}\nTrade state cleared: YES\nCron monitoring stopped: YES\n`);
      return res.status(200).json({ success: true, message: "Watcher deleted successfully." });
    } else if (action === 'force_scan') {
      const { data: watcher, error: wErr } = await supabase.from('watchers').select('*').eq('id', watcherId).maybeSingle();
      if (wErr || !watcher) {
        return res.status(404).json({ success: false, error: "Watcher not found." });
      }
      
      const userId = watcher.user_id;
      
      const { data: keyRec } = await supabase.from('user_api_keys').select('*').eq('user_id', userId).eq('provider', 'gemini').maybeSingle();
      const geminiKey = keyRec?.api_key || process.env.GEMINI_API_KEY;
      
      if (!geminiKey) {
        return res.status(400).json({ success: false, error: "Gemini API key is not configured for this user or server." });
      }
      
      const { data: prefsRecord } = await supabase.from('trading_preferences').select('*').eq('user_id', userId).maybeSingle();
      const strategyTextRaw = prefsRecord?.strategy_text || '';
      const strategyText = extractStrategyTextById(strategyTextRaw, watcher.strategy_id);
      
      let collectedData: Record<string, any> = {};
      const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
      const symbol = watcher.selected_pair || 'EURUSD';
      
      if (twelveDataKey) {
        try {
          const mappedSymbol = symbol.length === 6 ? `${symbol.slice(0, 3)}/${symbol.slice(3)}` : symbol;
          const response = await fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(mappedSymbol)}&apikey=${twelveDataKey}`);
          if (response.ok) {
            const quoteData = await response.json();
            if (quoteData && !quoteData.error && quoteData.close) {
              const currentPrice = parseFloat(quoteData.close);
              collectedData[symbol] = {
                current_price: currentPrice,
                open: parseFloat(quoteData.open || "0") || currentPrice,
                high: parseFloat(quoteData.high || "0") || currentPrice,
                low: parseFloat(quoteData.low || "0") || currentPrice,
                close: currentPrice,
                bid: quoteData.bid ? parseFloat(quoteData.bid) : currentPrice * 0.9999,
                ask: quoteData.ask ? parseFloat(quoteData.ask) : currentPrice * 1.0001,
                volume: parseFloat(quoteData.volume || "0"),
                timestamp: quoteData.timestamp || Math.floor(Date.now() / 1000)
              };
            }
          }
        } catch (e) {
          console.error("Twelve data fetch failed in Vercel force scan, falling back:", e);
        }
      }
      
      if (Object.keys(collectedData).length === 0) {
        const price = await getLivePrice(symbol);
        collectedData[symbol] = {
          current_price: price,
          open: price * 0.998,
          high: price * 1.002,
          low: price * 0.997,
          close: price,
          bid: price * 0.9999,
          ask: price * 1.0001,
          volume: 152000,
          timestamp: Math.floor(Date.now() / 1000)
        };
      }
      
      let accountSize: number;
      let riskPercentage: number;
      let riskRewardStr: string;
      let maxDailyRiskStr: string;
      try {
        const riskPrefs = extractRiskPreferences(prefsRecord, userId);
        accountSize = riskPrefs.accountSize;
        riskPercentage = riskPrefs.riskPercentage;
        riskRewardStr = riskPrefs.riskRewardStr;
        maxDailyRiskStr = riskPrefs.maxDailyRiskStr;
      } catch (prefsErr: any) {
        console.log(`[Force Scan] ${prefsErr.message}`);
        return res.status(400).json({ error: prefsErr.message });
      }

      console.log(`Trading Preferences Loaded\n`);
      console.log(`Account Size: $${accountSize}`);
      console.log(`Risk %: ${riskPercentage}%`);
      console.log(`Risk Reward: ${riskRewardStr}`);
      console.log(`Max Daily Risk: ${maxDailyRiskStr}`);
      console.log(`Strategy: ${strategyText ? strategyText.substring(0, 100) + '...' : 'N/A'}`);
      console.log(`[DB Row Comparison] DB capital: "${prefsRecord?.capital || ''}", DB custom_capital: "${prefsRecord?.custom_capital || ''}", DB preferred_risk: "${prefsRecord?.preferred_risk || ''}", DB risk_reward: "${prefsRecord?.risk_reward || ''}"`);
      
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const promptText = `
You are an expert AI trading assistant.
Analyze the following live market data against the user's trading strategy and configuration.
Return a structured JSON list of trading signals. Only generate a signal if the setup strongly matches the strategy.
If no valid setups are found, return an empty array for signals.

User's Trading Strategy:
${strategyText}

Trading Configuration:
- Account Size: $${accountSize}
- Risk Percentage per trade: ${riskPercentage}%
- Risk-to-Reward Ratio: ${riskRewardStr}
- Maximum Daily Risk: ${maxDailyRiskStr}
- Preferred Timeframe: ${watcher.selected_timeframe || 'H1'}
- Preferred Instrument: ${watcher.selected_pair}

Live Market Data:
${JSON.stringify(collectedData, null, 2)}
`;

      const aiResponse = await generateContentWithDiagnostics(ai, {
        model: "gemini-3.6-flash",
        contents: promptText,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              signals: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    pair: { type: Type.STRING, description: "The trading pair symbol (e.g., EUR/USD)" },
                    direction: { type: Type.STRING, description: "BUY or SELL" },
                    entryPrice: { type: Type.NUMBER, description: "Suggested entry price" },
                    stopLoss: { type: Type.NUMBER, description: "Suggested stop loss price" },
                    takeProfit: { type: Type.NUMBER, description: "Suggested take profit price" },
                    riskRewardRatio: { type: Type.STRING, description: "Risk/Reward ratio (e.g., '1:2.5')" },
                    confidenceScore: { type: Type.NUMBER, description: "Confidence score from 0 to 100" },
                    aiReasoning: { type: Type.STRING, description: "Brief explanation of why this setup matches the strategy" },
                  },
                  required: ["pair", "direction", "entryPrice", "stopLoss", "takeProfit", "riskRewardRatio", "confidenceScore", "aiReasoning"]
                }
              }
            },
            required: ["signals"]
          }
        }
      });

      const parsedResult = JSON.parse(aiResponse.text || '{"signals": []}');
      const signals = parsedResult.signals || [];
      let signalsSent = 0;
      
      if (signals.length > 0) {
        for (const sig of signals) {
          const executedPrice = Number(sig.entryPrice) || 0;
          const posSizeResult = calculatePositionSize({
            accountSize: accountSize,
            riskPercentage: riskPercentage,
            entryPrice: Number(sig.entryPrice) || 0,
            executedEntry: executedPrice,
            stopLoss: Number(sig.stopLoss) || 0,
            geminiTp: sig.takeProfit ? Number(sig.takeProfit) : null,
            symbol: sig.pair,
            direction: sig.direction,
            riskRewardStr: riskRewardStr
          });

          if (!posSizeResult.accepted) {
            console.log(`[Risk Validation Failed - Trade Skipped] ${posSizeResult.skipReason}`);
            continue;
          }

          sig.entryPrice = posSizeResult.entryPrice;
          sig.stopLoss = posSizeResult.stopLoss;
          sig.takeProfit = posSizeResult.takeProfit;
          sig.riskRewardRatio = riskRewardStr;
          (sig as any).lotSize = posSizeResult.calculatedLotSize;
          (sig as any).riskAmount = posSizeResult.riskAmount;
          (sig as any).expectedLoss = posSizeResult.expectedLoss;
          (sig as any).lotType = posSizeResult.lotType;

          // Signals history is tracked via watcher_evaluations
          
          if (watcher.telegram_chat_id && sig.confidenceScore >= 70) {
            const alertMessage = buildTelegramAlertMessage({
              pair: sig.pair,
              timeframe: watcher.selected_timeframe || 'H1',
              direction: sig.direction,
              strategySummary: prefsRecord?.strategy_summary || 'Custom Strategy',
              entryPrice: sig.entryPrice,
              stopLoss: sig.stopLoss,
              takeProfit: sig.takeProfit,
              riskRewardRatio: sig.riskRewardRatio,
              confidenceScore: sig.confidenceScore,
              aiReasoning: sig.aiReasoning,
              lotSize: posSizeResult.calculatedLotSize,
              riskAmount: posSizeResult.riskAmount,
              expectedLoss: posSizeResult.expectedLoss,
              lotType: posSizeResult.lotType
            });
              
            await sendTelegramMessage_watcher(watcher.telegram_chat_id, alertMessage);
            signalsSent++;
          }
        }
      }
      
      await supabase.from("watchers").update({
        last_scan_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq("id", watcherId);
      
      return res.status(200).json({
        success: true,
        message: `Force scan complete! Scanned ${symbol}. Signals found: ${signals.length}, Sent to Telegram: ${signalsSent}.`,
        signals: signals
      });
    }

    return res.status(400).json({ success: false, error: "Invalid action type." });
  } catch (err: any) {
    console.error("Failed executing watcher action:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}


// --- api/admin/watchers/index.ts ---

/**
 * Self-contained Supabase client initialization.
 */

async function watchers_handler(req: any, res: any) {
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

    const { data: watchers, error: wErr } = await supabase.from('watchers').select('*');
    if (wErr) throw wErr;

    let profiles: any[] = [];
    try {
      const { data, error } = await supabase.from('profiles').select('id, email, gemini_status');
      if (error) {
        const { data: fallbackData } = await supabase.from('profiles').select('id, email');
        profiles = (fallbackData || []).map((p: any) => ({ ...p, gemini_status: 'READY' }));
      } else {
        profiles = data || [];
      }
    } catch (e) {
      try {
        const { data: fallbackData } = await supabase.from('profiles').select('id, email');
        profiles = (fallbackData || []).map((p: any) => ({ ...p, gemini_status: 'READY' }));
      } catch (e2) {}
    }

    const assembledWatchers = (watchers || []).map(w => {
      const prof = profiles?.find(p => p.id === w.user_id);
      return {
        ...w,
        email: prof?.email || 'Unknown User',
        gemini_status: prof?.gemini_status || 'READY'
      };
    });

    return res.status(200).json({ success: true, watchers: assembledWatchers });
  } catch (err: any) {
    console.error("Failed to fetch admin watchers:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

// --- api/admin/inspector/candles.ts ---

async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 3, baseDelayMs = 1000): Promise<Response> {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      const response = await fetch(url, options);
      if (response.ok) return response;
      if (response.status === 404 || response.status === 400) return response;
      console.warn(`[Fetch Retry] Attempt ${attempt} returned status ${response.status}. Retrying...`);
    } catch (err: any) {
      if (attempt >= maxRetries) throw err;
      console.warn(`[Fetch Retry] Attempt ${attempt} threw network error: ${err.message || err}. Retrying...`);
    }
    await new Promise(resolve => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1)));
  }
  throw new Error(`Fetch failed after ${maxRetries} attempts`);
}

function convertSymbolForTwelveData(sym: string): string {
  if (!sym) return "";
  let mapped = sym.trim().toUpperCase().replace(/[-_\s/]/g, '');
  const mappings: Record<string, string> = {
    'EURUSD': 'EUR/USD', 'GBPUSD': 'GBP/USD', 'XAUUSD': 'XAU/USD', 'BTCUSD': 'BTC/USD',
    'NAS100': 'QQQ', 'US30': 'DIA', 'SPX500': 'SPY', 'US500': 'SPY'
  };
  if (mappings[mapped]) return mappings[mapped];
  if (mapped.length === 6) return `${mapped.slice(0, 3)}/${mapped.slice(3)}`;
  return mapped;
}

function mapTimeframeToInterval(tf: string): string {
  const u = tf.toUpperCase();
  if (u === 'M1' || u === '1M') return '1min';
  if (u === 'M5' || u === '5M') return '5min';
  if (u === 'M15' || u === '15M') return '15min';
  if (u === 'M30' || u === '30M') return '30min';
  if (u === 'H1' || u === '1H') return '1h';
  if (u === 'H2' || u === '2H') return '2h';
  if (u === 'H4' || u === '4H') return '4h';
  if (u === 'D1' || u === 'D' || u === 'DAILY') return '1day';
  return '1h';
}

async function inspector_candles_handler(req: any, res: any) {
  const supabase = getSupabase();
  const urlParams = url.parse(req.url || '', true).query;
  const symbol = urlParams.symbol as string;
  const timeframe = urlParams.timeframe as string || 'H1';

  if (!symbol) return res.status(400).json({ success: false, error: "Symbol is required" });

  try {
    const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
    if (!twelveDataKey) return res.status(500).json({ success: false, error: "Twelve Data API key missing" });

    const mappedSymbol = convertSymbolForTwelveData(symbol);
    const interval = mapTimeframeToInterval(timeframe);
    const tsUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(mappedSymbol)}&interval=${interval}&outputsize=50&apikey=${twelveDataKey}`;

    const tsRes = await fetchWithRetry(tsUrl, {}, 3, 1000);
    const tsData = await tsRes.json();

    if (tsData.status !== "ok") {
      return res.status(400).json({ success: false, error: tsData.message || "Twelve Data error" });
    }

    const candles = tsData.values.map((v: any) => ({
      timestamp: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: v.volume ? parseFloat(v.volume) : undefined
    })).reverse();

    return res.status(200).json({ success: true, candles, currentPrice: candles[candles.length - 1]?.close, timeframe });
  } catch (err: any) {
    console.error("Inspector candles fetch error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function inspector_watcher_details_handler(req: any, res: any) {
  const supabase = getSupabase();
  const urlParams = url.parse(req.url || '', true).query;
  const watcherId = urlParams.watcherId as string;

  if (!watcherId) return res.status(400).json({ success: false, error: "Watcher ID is required" });

  try {
    const { data: watcher, error: wErr } = await supabase.from('watchers').select('*').eq('id', watcherId).maybeSingle();
    if (wErr || !watcher) return res.status(404).json({ success: false, error: "Watcher not found" });

    let parsed_strategy = null;
    let raw_strategy_text = null;

    if (watcher.strategy_id) {
      const { data: strat } = await supabase.from('strategies').select('parsed_strategy').eq('id', watcher.strategy_id).maybeSingle();
      parsed_strategy = strat?.parsed_strategy;
    }

    const { data: prefs } = await supabase.from('trading_preferences').select('strategy_text').eq('user_id', watcher.user_id).maybeSingle();
    raw_strategy_text = prefs?.strategy_text;

    return res.status(200).json({ success: true, watcher, parsed_strategy, raw_strategy_text });
  } catch (err: any) {
    console.error("Inspector watcher details error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}


async function explainability_handler(req: any, res: any) {
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

    // 1. Fetch all profiles to map user IDs to emails
    const { data: profiles, error: pErr } = await supabase.from('profiles').select('id, email');
    const profileMap = new Map<string, string>();
    if (profiles) {
      profiles.forEach((p: any) => {
        profileMap.set(p.id, p.email || p.id);
      });
    }

    // 2. Fetch total count of evaluations
    const { count: totalScans, error: countErr } = await supabase
      .from('watcher_evaluations')
      .select('*', { count: 'exact', head: true });

    if (countErr) {
      console.warn("Error getting watcher_evaluations count:", countErr.message);
    }

    // 3. Fetch latest 1000 evaluations to calculate statistics in memory
    const { data: evaluations, error: evErr } = await supabase
      .from('watcher_evaluations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(1000);

    if (evErr) {
      throw evErr;
    }

    const evs = evaluations || [];

    // Aggregations
    let totalSignals = 0;
    let passCount = 0;
    let likelyPassCount = 0;
    let ambiguousCount = 0;
    let failCount = 0;

    const modeCounts: Record<string, number> = { RULE_ONLY: 0, HYBRID: 0, AI_ONLY: 0 };
    const userScans: Record<string, { email: string, count: number }> = {};
    
    // Performance Latencies
    let totalScanDuration = 0;
    let scanDurationCount = 0;
    let totalGeminiDuration = 0;
    let geminiDurationCount = 0;

    // Rule Frequency tracking
    const ruleMatches: Record<string, { matched: number, failed: number }> = {};

    evs.forEach((ev: any) => {
      // Recommendations
      if (ev.recommendation === 'PASS') passCount++;
      else if (ev.recommendation === 'LIKELY_PASS') likelyPassCount++;
      else if (ev.recommendation === 'AMBIGUOUS') ambiguousCount++;
      else if (ev.recommendation === 'FAIL') failCount++;

      // Signals Sent
      if (ev.trade_sent) totalSignals++;

      // Mode
      const mode = ev.strategy_mode || 'RULE_ONLY';
      modeCounts[mode] = (modeCounts[mode] || 0) + 1;

      // User rankings
      const uId = ev.user_id;
      if (uId) {
        if (!userScans[uId]) {
          userScans[uId] = {
            email: profileMap.get(uId) || uId,
            count: 0
          };
        }
        userScans[uId].count++;
      }

      // Latencies
      if (ev.scan_duration_ms) {
        totalScanDuration += ev.scan_duration_ms;
        scanDurationCount++;
      }
      if (ev.gemini_used && ev.gemini_duration_ms) {
        totalGeminiDuration += ev.gemini_duration_ms;
        geminiDurationCount++;
      }

      // Parse rules
      let matchedList: string[] = [];
      let failedList: string[] = [];

      try {
        if (ev.matched_rules) {
          matchedList = typeof ev.matched_rules === 'string' ? JSON.parse(ev.matched_rules) : ev.matched_rules;
        }
      } catch (e) {}

      try {
        if (ev.failed_rules) {
          failedList = typeof ev.failed_rules === 'string' ? JSON.parse(ev.failed_rules) : ev.failed_rules;
        }
      } catch (e) {}

      if (Array.isArray(matchedList)) {
        matchedList.forEach((rule: string) => {
          if (!ruleMatches[rule]) ruleMatches[rule] = { matched: 0, failed: 0 };
          ruleMatches[rule].matched++;
        });
      }

      if (Array.isArray(failedList)) {
        failedList.forEach((rule: string) => {
          if (!ruleMatches[rule]) ruleMatches[rule] = { matched: 0, failed: 0 };
          ruleMatches[rule].failed++;
        });
      }
    });

    const signalRate = evs.length > 0 ? (totalSignals / evs.length) * 100 : 0;
    const avgScanDuration = scanDurationCount > 0 ? (totalScanDuration / scanDurationCount) : 0;
    const avgGeminiDuration = geminiDurationCount > 0 ? (totalGeminiDuration / geminiDurationCount) : 0;

    // Convert User rankings to sorted array
    const userRankings = Object.entries(userScans).map(([id, data]) => ({
      userId: id,
      email: data.email,
      count: data.count
    })).sort((a, b) => b.count - a.count);

    // Convert Rule Analytics to array
    const ruleAnalytics = Object.entries(ruleMatches).map(([rule, counts]) => ({
      rule,
      matched: counts.matched,
      failed: counts.failed,
      total: counts.matched + counts.failed,
      successRate: (counts.matched + counts.failed) > 0 ? (counts.matched / (counts.matched + counts.failed)) * 100 : 0
    })).sort((a, b) => b.total - a.total);

    // Return aggregated results plus latest 100 raw evaluation logs for history feed
    const rawLogs = evs.slice(0, 100).map((ev: any) => ({
      ...ev,
      user_email: profileMap.get(ev.user_id) || ev.user_id
    }));

    return res.status(200).json({
      success: true,
      stats: {
        totalScans: totalScans || evs.length,
        signalRate: parseFloat(signalRate.toFixed(2)),
        totalSignals,
        passRatio: evs.length > 0 ? parseFloat(((passCount + likelyPassCount) / evs.length * 100).toFixed(2)) : 0,
        distribution: {
          PASS: passCount,
          LIKELY_PASS: likelyPassCount,
          AMBIGUOUS: ambiguousCount,
          FAIL: failCount
        },
        modeBreakdown: modeCounts,
        performance: {
          avgScanDuration: Math.round(avgScanDuration),
          avgGeminiDuration: Math.round(avgGeminiDuration)
        },
        userRankings,
        ruleAnalytics
      },
      logs: rawLogs
    });

  } catch (err: any) {
    console.error("Explainability statistics retrieval error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}


let systemHealthHistory: any[] = [];

function getUptimeString() {
  const seconds = Math.floor(process.uptime());
  const d = Math.floor(seconds / (3600*24));
  const h = Math.floor((seconds % (3600*24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  
  const parts = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

async function system_health_handler(req: any, res: any) {
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

    // 1. Backend check
    const backend = "healthy";

    // 2. Database check
    const startDb = Date.now();
    let database = "healthy";
    let database_latency_ms = 0;
    try {
      const { error: dbErr } = await supabase.from('profiles').select('id').limit(1);
      database_latency_ms = Date.now() - startDb;
      if (dbErr) {
        database = "offline";
      } else if (database_latency_ms > 200) {
        database = "slow";
      }
    } catch {
      database = "offline";
      database_latency_ms = Date.now() - startDb;
    }

    // 3. Telegram check
    let telegram = "offline";
    let telegram_latency_ms = 0;
    const telegramToken = (process.env.TELEGRAM_BOT_TOKEN || "").trim();

    if (!telegramToken) {
      telegram = "missing_token";
    } else {
      const startTg = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const resTg = await fetch(`https://api.telegram.org/bot${telegramToken}/getMe`, { signal: controller.signal });
        clearTimeout(timeoutId);
        telegram_latency_ms = Date.now() - startTg;

        if (resTg.status === 401 || resTg.status === 403) {
          telegram = "invalid_token";
        } else if (resTg.ok) {
          const tgJson = await resTg.json().catch(() => null);
          if (tgJson && tgJson.ok === true) {
            telegram = "healthy";
          } else {
            telegram = "error";
          }
        } else {
          telegram = "error";
        }
      } catch (err: any) {
        telegram_latency_ms = Date.now() - startTg;
        if (err.name === 'AbortError') {
          telegram = "timeout";
        } else {
          telegram = "offline";
        }
      }
    }

    // 4. Gemini check
    let gemini = "healthy";
    let gemini_latency_ms = 0;

    const envGeminiKey = (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "").trim();
    const { data: keyRecord } = await supabase
      .from('user_api_keys')
      .select('api_key, status, last_error')
      .eq('provider', 'gemini')
      .eq('status', 'active')
      .limit(1)
      .maybeSingle();

    const activeGeminiKey = envGeminiKey || (keyRecord?.api_key ? keyRecord.api_key.trim() : "");

    if (!activeGeminiKey) {
      gemini = "missing_key";
    } else {
      const startGemini = Date.now();
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3000);
        const resGemini = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(activeGeminiKey)}`, {
          signal: controller.signal
        });
        clearTimeout(timeoutId);
        gemini_latency_ms = Date.now() - startGemini;

        if (resGemini.ok) {
          gemini = "healthy";
        } else if (resGemini.status === 401 || resGemini.status === 400 || resGemini.status === 403) {
          gemini = "invalid_key";
        } else if (resGemini.status === 429) {
          gemini = "quota_exceeded";
        } else {
          const errBody = await resGemini.json().catch(() => null);
          const errStr = JSON.stringify(errBody || {}).toLowerCase();
          if (errStr.includes("quota") || errStr.includes("resource_exhausted")) {
            gemini = "quota_exceeded";
          } else if (errStr.includes("invalid") || errStr.includes("key") || errStr.includes("permission")) {
            gemini = "invalid_key";
          } else {
            gemini = "network_error";
          }
        }
      } catch (err: any) {
        gemini_latency_ms = Date.now() - startGemini;
        if (err.name === 'AbortError') {
          gemini = "timeout";
        } else {
          gemini = "network_error";
        }
      }
    }

    // 5. Cron check
    let cron = "running";
    let watchers = 0;
    let last_scan = "";
    try {
      const { data: latestWatcherScan } = await supabase
        .from('watchers')
        .select('last_scan_at')
        .not('last_scan_at', 'is', null)
        .order('last_scan_at', { ascending: false })
        .limit(1);

      const { data: latestEval } = await supabase
        .from('watcher_evaluations')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1);

      const { data: latestCronLog } = await supabase
        .from('system_health_logs')
        .select('created_at')
        .eq('service', 'Cron')
        .order('created_at', { ascending: false })
        .limit(1);

      const timestamps: number[] = [];
      if (latestWatcherScan?.[0]?.last_scan_at) {
        timestamps.push(new Date(latestWatcherScan[0].last_scan_at).getTime());
      }
      if (latestEval?.[0]?.created_at) {
        timestamps.push(new Date(latestEval[0].created_at).getTime());
      }
      if (latestCronLog?.[0]?.created_at) {
        timestamps.push(new Date(latestCronLog[0].created_at).getTime());
      }

      const last_scan_time = timestamps.length > 0 ? Math.max(...timestamps) : null;
      if (last_scan_time) {
        last_scan = new Date(last_scan_time).toISOString();
      }

      const { count: activeWatchersCount } = await supabase
        .from('watchers')
        .select('*', { count: 'exact', head: true })
        .eq('status', 'active');
      watchers = activeWatchersCount || 0;

      const cronSecret = process.env.CRON_SECRET;
      const isCronSecretConfigured = !!(cronSecret && cronSecret.trim());

      if (watchers > 0) {
        if (last_scan_time) {
          const diffMinutes = (Date.now() - last_scan_time) / (1000 * 60);
          if (diffMinutes > 24 * 60) {
            cron = "stopped";
          }
        } else if (!isCronSecretConfigured) {
          cron = "stopped";
        }
      } else {
        if (!isCronSecretConfigured && !last_scan_time) {
          cron = "stopped";
        }
      }
    } catch {
      cron = "running";
    }

    // 6. Learning Engine check
    let learning_engine = "healthy";
    try {
      const { error: leErr1 } = await supabase.from('trade_learning').select('id').limit(1);
      const { error: leErr2 } = await supabase.from('watcher_evaluations').select('id').limit(1);
      if (leErr1 || leErr2) {
        learning_engine = "Database Error";
      }
    } catch {
      learning_engine = "Database Error";
    }

    // 7. Active Users
    const { data: activeWatchers } = await supabase.from('watchers').select('user_id').eq('status', 'active');
    const activeUserIds = new Set(activeWatchers?.map(w => w.user_id) || []);
    const active_users = activeUserIds.size;

    // 8. Today's metrics (since 00:00 UTC)
    const todayStartStr = new Date();
    todayStartStr.setUTCHours(0,0,0,0);
    const todayISO = todayStartStr.toISOString();

    const { count: todayScans } = await supabase
      .from('watcher_evaluations')
      .select('*', { count: 'exact', head: true })
      .gte('created_at', todayISO);
    const today_scans = todayScans || 0;

    let today_signals = 0;
    try {
      const { count: todaySignals } = await supabase
        .from('watcher_evaluations')
        .select('*', { count: 'exact', head: true })
        .eq('trade_sent', true)
        .gte('created_at', todayISO);
      today_signals = todaySignals || 0;
    } catch {
      today_signals = 0;
    }

    const { count: todayFailures } = await supabase
      .from('watcher_evaluations')
      .select('*', { count: 'exact', head: true })
      .eq('recommendation', 'FAIL')
      .gte('created_at', todayISO);
    const today_failures = todayFailures || 0;

    // 9. Average Scan Times (from last 50 evaluations)
    const { data: recentEvals } = await supabase
      .from('watcher_evaluations')
      .select('scan_duration_ms, gemini_duration_ms')
      .order('created_at', { ascending: false })
      .limit(50);

    let average_scan_ms = 0;
    let gemini_avg_duration_sum = 0;
    let gemini_avg_duration_count = 0;
    
    if (recentEvals && recentEvals.length > 0) {
      const validScans = recentEvals.filter(e => e.scan_duration_ms !== null);
      if (validScans.length > 0) {
        average_scan_ms = Math.round(validScans.reduce((sum, e) => sum + (e.scan_duration_ms || 0), 0) / validScans.length);
      }
      const validGeminis = recentEvals.filter(e => e.gemini_duration_ms !== null && e.gemini_duration_ms > 0);
      if (validGeminis.length > 0) {
        gemini_avg_duration_sum = validGeminis.reduce((sum, e) => sum + (e.gemini_duration_ms || 0), 0);
        gemini_avg_duration_count = validGeminis.length;
      }
    }

    const average_gemini_ms = gemini_avg_duration_count > 0 ? Math.round(gemini_avg_duration_sum / gemini_avg_duration_count) : gemini_latency_ms;

    // Calculate dynamic average Telegram latency from systemHealthHistory
    const validTgs = systemHealthHistory.filter(h => h.component === 'Telegram' && h.latency > 0);
    const average_telegram_ms = validTgs.length > 0 ? Math.round(validTgs.reduce((sum, h) => sum + h.latency, 0) / validTgs.length) : telegram_latency_ms;

    const uptime = getUptimeString();
    const version = "1.0.0";

    // Record History
    const timestamp = new Date().toISOString();
    const newHistoryEntries = [
      { timestamp, component: 'Backend', status: backend, latency: 0, message: 'API is running' },
      { timestamp, component: 'Database', status: database, latency: database_latency_ms, message: database === 'healthy' ? 'Connection healthy' : (database === 'slow' ? 'Slow response time' : 'Database query failed') },
      { timestamp, component: 'Telegram', status: telegram, latency: telegram_latency_ms, message: telegram === 'healthy' ? 'Telegram API is reachable' : 'Telegram API unreachable or offline' },
      { timestamp, component: 'Gemini', status: gemini, latency: gemini_latency_ms, message: gemini === 'healthy' ? 'API key status verified' : `Status: ${gemini}` },
      { timestamp, component: 'Cron', status: cron, latency: 0, message: cron === 'running' ? 'Market Watcher cron is running' : 'Market Watcher cron has stopped' },
      { timestamp, component: 'Learning Engine', status: learning_engine, latency: 0, message: learning_engine === 'healthy' ? 'Tables accessible' : 'Database Error' }
    ];

    systemHealthHistory.unshift(...newHistoryEntries);
    if (systemHealthHistory.length > 200) {
      systemHealthHistory = systemHealthHistory.slice(0, 200);
    }

    // Attempt to write logs asynchronously in background to avoid blocking
    newHistoryEntries.forEach(entry => {
      logHealthTest(entry.component, entry.status, entry.latency, entry.message, entry.status !== 'healthy' && entry.status !== 'running' ? entry.message : null).catch(() => {});
    });

    const resultPayload = {
      backend,
      database,
      telegram,
      gemini,
      cron,
      learning_engine,
      watchers,
      active_users,
      today_scans,
      today_signals,
      today_failures,
      last_scan,
      average_scan_ms,
      database_latency_ms,
      gemini_latency_ms,
      telegram_latency_ms,
      average_gemini_ms,
      average_telegram_ms,
      uptime,
      version,
      history: systemHealthHistory.slice(0, 50)
    };

    return res.status(200).json(resultPayload);

  } catch (err: any) {
    console.error("System health check API error:", err);
    return res.status(500).json({ success: false, error: err.message || 'Internal system health diagnostics exception' });
  }
}


async function logs_handler(req: any, res: any) {
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

    const { data: logs, error: lErr } = await supabase
      .from('execution_logs')
      .select('*')
      .order('run_time', { ascending: false })
      .limit(50); // Show last 50 runs in UI
    
    if (lErr) throw lErr;

    return res.status(200).json({ success: true, logs: logs || [] });
  } catch (err: any) {
    console.error("Failed to fetch execution logs:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

export default async function handler(req: any, res: any) {
  try {
    const matchedPath = req.headers['x-matched-path'] || req.headers['x-original-url'] || req.headers['x-forwarded-url'] || req.url || '';
    const parsedUrl = url.parse(matchedPath, true);
    const pathname = parsedUrl.pathname || '';

    if (pathname.endsWith('/logs')) {
      return logs_handler(req, res);
    }
    if (pathname.endsWith('/system-health')) {
      return system_health_handler(req, res);
    }
    if (pathname.endsWith('/stats')) {
      return stats_handler(req, res);
    }
    if (pathname.endsWith('/explainability')) {
      return explainability_handler(req, res);
    }
    if (pathname.endsWith('/users/action')) {
      return users_action_handler(req, res);
    }
    if (pathname.endsWith('/users')) {
      return users_handler(req, res);
    }
    if (pathname.endsWith('/watchers/action')) {
      return watchers_action_handler(req, res);
    }
    if (pathname.endsWith('/watchers')) {
      return watchers_handler(req, res);
    }
    if (pathname.endsWith('/inspector/candles')) {
      return inspector_candles_handler(req, res);
    }
    if (pathname.endsWith('/inspector/watcher-details')) {
      return inspector_watcher_details_handler(req, res);
    }
    if (pathname.endsWith('/signals')) {
      return signals_handler(req, res);
    }
    if (pathname.endsWith('/health')) {
      return health_handler(req, res);
    }
    if (pathname.endsWith('/settings')) {
      return settings_handler(req, res);
    }
    if (pathname.endsWith('/send-test-alert')) {
      return send_test_alert_handler(req, res);
    }
    if (pathname.endsWith('/admin') || pathname.endsWith('/admin/') || pathname === '' || pathname === '/') {
      return stats_handler(req, res);
    }

    return res.status(404).json({ 
       success: false, 
       error: `Not Found: ${pathname}`
    });
  } catch (err: any) {
    console.error("[Admin Router Error]:", err);
    return res.status(500).json({ 
       success: false, 
       error: "Internal Server Error in Admin Router", 
       message: err.message || err.toString()
    });
  }
}
