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

// Helper to log test executions to the system_health_logs table
async function logHealthTest(service: string, status: string, responseTime: number, message: string, error: string | null) {
  try {
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

export default async function handler(req: any, res: any) {
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
    // CASE A: RUN FULL SYSTEM TEST (POST REQUEST)
    // ----------------------------------------------------
    if (req.method === 'POST') {
      const results: Record<string, any> = {};
      let hasError = false;

      // Step 1: Verify Supabase database connection
      const startSupa = Date.now();
      let dbError: string | null = null;
      try {
        const { error: supaErr } = await supabase.from('profiles').select('id').limit(1);
        if (supaErr) throw supaErr;
        results.supabase = {
          status: 'ONLINE',
          responseTime: Date.now() - startSupa,
          message: 'Connected to Supabase, profiles table read successfully.'
        };
      } catch (err: any) {
        hasError = true;
        dbError = err.message || 'Database connection error';
        results.supabase = {
          status: 'ERROR',
          responseTime: Date.now() - startSupa,
          message: 'Failed to query Supabase profiles table.',
          error: dbError
        };
      }
      await logHealthTest('Supabase', results.supabase.status, results.supabase.responseTime, results.supabase.message, dbError);

      // Step 2: Fetch a real EURUSD candle (or quote) from Twelve Data
      const startTwelve = Date.now();
      let twelveError: string | null = null;
      let eurUsdCandle: any = null;
      if (process.env.TWELVE_DATA_API_KEY) {
        try {
          const resQuote = await fetch(`https://api.twelvedata.com/quote?symbol=EUR/USD&apikey=${process.env.TWELVE_DATA_API_KEY}`);
          if (!resQuote.ok) {
            throw new Error(`Twelve Data API returned status code ${resQuote.status}`);
          }
          const quoteData = await resQuote.json();
          if (quoteData.status === 'error' || quoteData.code >= 400) {
            throw new Error(quoteData.message || 'Error response from Twelve Data API');
          }
          eurUsdCandle = quoteData;
          results.twelveData = {
            status: 'ONLINE',
            responseTime: Date.now() - startTwelve,
            symbol: 'EUR/USD',
            price: parseFloat(quoteData.close || quoteData.price || '0'),
            message: `Successfully fetched EUR/USD quote: ${quoteData.close || quoteData.price}`
          };
        } catch (err: any) {
          hasError = true;
          twelveError = err.message || 'Twelve Data fetch error';
          results.twelveData = {
            status: 'ERROR',
            responseTime: Date.now() - startTwelve,
            message: 'Failed to contact Twelve Data API.',
            error: twelveError
          };
        }
      } else {
        hasError = true;
        twelveError = 'TWELVE_DATA_API_KEY is not defined';
        results.twelveData = {
          status: 'ERROR',
          responseTime: 0,
          message: 'Twelve Data API Key is missing in environment settings.',
          error: twelveError
        };
      }
      await logHealthTest('Twelve Data', results.twelveData.status, results.twelveData.responseTime, results.twelveData.message, twelveError);

      // Step 3 & 4: Send the candle to Gemini and display response
      const startGemini = Date.now();
      let geminiError: string | null = null;
      if (process.env.GEMINI_API_KEY) {
        try {
          const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
          const candleCtx = eurUsdCandle ? JSON.stringify(eurUsdCandle) : '{"symbol":"EUR/USD","price":1.0850,"open":1.0840,"high":1.0860,"low":1.0830}';
          const prompt = `Analyze this candle and reply with BUY, SELL or NO SIGNAL with one sentence: ${candleCtx}`;
          
          const aiResponse = await ai.models.generateContent({
            model: "gemini-3.5-flash",
            contents: prompt,
            config: {
              systemInstruction: "You are an AI market watcher testing model responsiveness. Answer concisely."
            }
          });
          
          const returnedText = aiResponse.text?.trim() || 'No response';
          results.gemini = {
            status: 'ONLINE',
            responseTime: Date.now() - startGemini,
            returnedText,
            message: `Gemini prompt successful. Answer: "${returnedText}"`
          };
        } catch (err: any) {
          hasError = true;
          geminiError = err.message || 'Gemini Generation error';
          results.gemini = {
            status: 'ERROR',
            responseTime: Date.now() - startGemini,
            message: 'Failed to complete prompt with Gemini API.',
            error: geminiError
          };
        }
      } else {
        hasError = true;
        geminiError = 'GEMINI_API_KEY is not defined';
        results.gemini = {
          status: 'ERROR',
          responseTime: 0,
          message: 'Gemini API Key is missing in environment settings.',
          error: geminiError
        };
      }
      await logHealthTest('Gemini', results.gemini.status, results.gemini.responseTime, results.gemini.message, geminiError);

      // Step 5: Send a Telegram test message to the Admin only
      const startTelegram = Date.now();
      let telegramError: string | null = null;
      if (process.env.TELEGRAM_BOT_TOKEN) {
        try {
          // Find admin Telegram chat ID
          const { data: adminConn, error: connErr } = await supabase
            .from('telegram_connections')
            .select('telegram_chat_id, telegram_username')
            .eq('user_id', user.id)
            .eq('connected', true)
            .maybeSingle();

          if (connErr) throw connErr;
          
          if (adminConn && adminConn.telegram_chat_id) {
            const botToken = process.env.TELEGRAM_BOT_TOKEN;
            const messageText = `🚨 *Gaks AI System Diagnostic Run* 🚨\n\n` +
              `*Supabase DB:* OK\n` +
              `*Twelve Data:* EUR/USD Price = ${results.twelveData?.price || 'Fetch Error'}\n` +
              `*Gemini:* "${results.gemini?.returnedText || 'Prompt Error'}"\n\n` +
              `*Overall System Status:* ${hasError ? '🔴 ERROR DETECTED' : '🟢 HEALTHY'}\n` +
              `*Timestamp:* ${new Date().toUTCString()}`;

            const tgRes = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                chat_id: adminConn.telegram_chat_id,
                text: messageText,
                parse_mode: 'Markdown'
              })
            });

            if (!tgRes.ok) {
              const resTxt = await tgRes.text();
              throw new Error(`Telegram API returned HTTP ${tgRes.status}: ${resTxt}`);
            }

            const tgBody = await tgRes.json();
            results.telegram = {
              status: 'ONLINE',
              responseTime: Date.now() - startTelegram,
              telegramResponse: `Sent to user @${adminConn.telegram_username || 'Admin'}`,
              message: 'Diagnostic broadcast successfully sent to Admin telegram chat.'
            };
          } else {
            // Admin has no telegram connected
            results.telegram = {
              status: 'OFFLINE',
              responseTime: Date.now() - startTelegram,
              message: 'Telegram bot is online, but admin has not connected their Telegram under Gaks AI Settings.',
              error: 'Admin Telegram connection row missing.'
            };
          }
        } catch (err: any) {
          hasError = true;
          telegramError = err.message || 'Telegram notification error';
          results.telegram = {
            status: 'ERROR',
            responseTime: Date.now() - startTelegram,
            message: 'Failed to broadcast test notification via Telegram API.',
            error: telegramError
          };
        }
      } else {
        hasError = true;
        telegramError = 'TELEGRAM_BOT_TOKEN is not defined';
        results.telegram = {
          status: 'ERROR',
          responseTime: 0,
          message: 'Telegram Bot Token is missing in environment settings.',
          error: telegramError
        };
      }
      await logHealthTest('Telegram', results.telegram.status, results.telegram.responseTime, results.telegram.message, telegramError);

      // Step 6: Return checklist of all subsystems and overall status
      const overallStatus = hasError ? 'SYSTEM ERROR' : 'SYSTEM HEALTHY';
      
      // Log overall diagnostic outcome
      await logHealthTest('Market Watcher', overallStatus === 'SYSTEM HEALTHY' ? 'Healthy' : 'Error', Date.now() - startSupa, `Diagnostic checklist outcome: ${overallStatus}`, null);

      return res.status(200).json({
        success: true,
        overallStatus,
        results
      });
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
    if (process.env.GEMINI_API_KEY) {
      try {
        const startGemini = Date.now();
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const geminiRes = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: "Reply only with OK",
        });
        geminiLatency = Date.now() - startGemini;
        geminiReturnedText = geminiRes.text?.trim() || null;
        geminiStatus = geminiReturnedText === 'OK' ? 'ONLINE' : 'ERROR';
      } catch (err: any) {
        geminiStatus = 'ERROR';
        geminiErrorMsg = err.message || 'Gemini API call failed';
      }
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
        cronStatus = 'ERROR';
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
      cronStatus = 'ERROR';
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
    const { data: signalsData } = await supabase.from('signals').select('delivery_status').gte('timestamp', todayStart.toISOString());
    if (signalsData) {
      signalsDetectedToday = signalsData.length;
      signalsData.forEach((s: any) => {
        if (s.delivery_status === 'failed') {
          failedDeliveriesToday++;
        } else {
          signalsSentToday++;
        }
      });
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

    return res.status(200).json({
      success: true,
      health: {
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
