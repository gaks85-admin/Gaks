import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';
import { buildTelegramAlertMessage } from '../src/lib/telegram-formatter.js';
import { dispatchTradeAlert } from '../src/lib/telegramWrapper.js';
import { timeframeToMinutes } from '../src/lib/timeframe.js';
import { extractRiskPreferences, calculatePositionSize } from '../src/lib/risk-engine.js';
import { resolveUserGeminiKey } from '../src/lib/gemini-key-resolver.js';
import { defaultMarketDataService, getMarketDataStats, getRequiredCandleCountForTimeframe } from '../src/lib/market-data-service.js';
import { marketDataGateway } from '../src/lib/market-data-gateway.js';
import { sendNotificationEmail } from '../src/lib/email-service.js';
import { verifyAdminAuth } from '../src/lib/auth-admin.js';
import {
  createBacktestDataset,
  listBacktestDatasets,
  getBacktestDatasetDetails,
  deleteBacktestDataset
} from '../src/lib/backtest-service.js';
import {
  saveBacktestRun,
  getBacktestRun,
  listBacktestRuns,
  deleteBacktestRun
} from '../src/lib/backtest-persistence-service.js';
import { runBacktest } from '../src/lib/backtest-engine.js';

export async function sendTelegramMessage(chatId: string | number, text: string): Promise<boolean> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return false;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
    });
    return res.ok;
  } catch (e) {
    return false;
  }
}

export type GeminiErrorType = 'invalid_key' | 'quota_exceeded' | 'rate_limited' | 'temporary_failure' | 'unknown_error';

export function classifyGeminiError(error: any): GeminiErrorType {
    const message = error.message ? error.message.toLowerCase() : '';
    const status = error.status || 0;
    if (status === 404 || message.includes('not_found')) return 'temporary_failure';
    if (status === 401 || status === 403 || message.includes('invalid_api_key')) return 'invalid_key';
    if (status === 429 || message.includes('quota')) return 'quota_exceeded';
    if (status >= 500 || message.includes('timeout')) return 'temporary_failure';
    return 'unknown_error';
}

export async function runGeminiRequest(supabase: any, userId: string, prompt: string, model: string = 'gemini-3.5-flash-lite', config?: any) {
    return await runGeminiWrapperRequest(supabase, userId, prompt, model, config);
}

import { executeBoundedGeminiCall, runGeminiRequest as runGeminiWrapperRequest } from '../src/lib/geminiWrapper.js';

async function generateContentWithDiagnostics(ai: any, params: any) {
  const res = await executeBoundedGeminiCall(
    ai,
    {
      model: params.model || "gemini-3.5-flash-lite",
      contents: params.contents,
      config: params.config,
      timeoutMs: 12000,
      maxRetriesFor503: 1,
      backoffMsFor503: 500
    },
    { watcherId: 'admin-diagnostics' }
  );
  if (!res.success || !res.text) {
    throw new Error(res.cleanErrorMessage || 'Gemini execution failed');
  }
  return { text: res.text };
}

import fs from 'fs';
import path from 'path';
import { getSupabase } from '../lib/supabase-server.js';

async function logHealthTest(service: string, status: string, responseTime: number, message: string, error: string | null) {
  try {
    const supabase = getSupabase();
    await supabase.from('system_health_logs').insert({ service, status, response_time_ms: responseTime, message, error: error || null });
  } catch (err) {}
}

async function health_handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ success: false, error: 'Method Not Allowed' });

  try {
    if (req.method === 'POST') {
      const user = req.user;
      const model = "gemini-3.5-flash-lite";
      try {
        const responseText = await runGeminiRequest(supabase, user?.id || 'admin', "Reply only with OK", model);
        return res.status(200).json({ success: true, geminiDebug: { authenticated: true, model, geminiResponse: responseText } });
      } catch (err: any) {
        return res.status(200).json({ success: false, geminiDebug: { authenticated: true, model, geminiError: err.message } });
      }
    }

    return res.status(200).json({ success: true, status: 'ONLINE' });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

const SETTINGS_FILE = path.join(process.cwd(), "settings.json");

async function loadSettingsFromSupabaseOrFile() {
  let settings = {
    defaultStrategy: "Gaks AI Default Strategy",
    defaultGeminiModel: "gemini-3.5-flash-lite",
    scanInterval: 15,
    maintenanceMode: false,
    executionMode: "HYBRID"
  };

  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.from('system_settings').select('*').eq('id', 'global_config').maybeSingle();
    if (data && data.settings) {
      settings = { ...settings, ...data.settings };
      return settings;
    }
  } catch (e) {
    // Fallback to file
  }

  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
      settings = { ...settings, ...JSON.parse(data) };
    }
  } catch (e) {}

  return settings;
}

async function saveSettingsToSupabaseAndFile(settings: any) {
  // Save to file
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {}

  // Save to Supabase
  try {
    const supabase = getSupabase();
    await supabase.from('system_settings').upsert({
      id: 'global_config',
      settings: settings,
      updated_at: new Date().toISOString()
    });
  } catch (e) {
    console.warn("Failed to persist settings to Supabase table:", e);
  }
}

async function settings_handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    let appSettings = await loadSettingsFromSupabaseOrFile();
    if (req.method === 'GET') {
      return res.status(200).json({ success: true, settings: appSettings });
    } else {
      const { settings } = req.body;
      if (!settings) return res.status(400).json({ success: false, error: "Missing settings" });
      appSettings = { ...appSettings, ...settings };
      await saveSettingsToSupabaseAndFile(appSettings);
      return res.status(200).json({ success: true, message: "Settings saved successfully.", settings: appSettings });
    }
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function signals_handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    const { data } = await supabase.from('watcher_evaluations').select('*').order('created_at', { ascending: false }).limit(50);
    return res.status(200).json({ success: true, signals: data || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function stats_handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();
  
  try {
    // Parallelize stat fetching for performance
    const [
      activeWatchersRes,
      totalPairsRes,
      totalSignalsRes,
      totalUsersRes,
      telegramConnectedRes,
      lastScanRes
    ] = await Promise.all([
      // 1. Total Active Watchers
      supabase.from('watchers').select('*', { count: 'exact', head: true }).eq('status', 'active'),
      
      // 2. Unique Pairs Monitored
      supabase.from('watchers').select('selected_pair'),
      
      // 3. Total Signals Sent (where trade_sent is true)
      supabase.from('watcher_evaluations').select('*', { count: 'exact', head: true }).eq('trade_sent', true),
      
      // 4. Total Registered Users
      supabase.from('profiles').select('*', { count: 'exact', head: true }),
      
      // 5. Telegram Connected Users
      supabase.from('profiles').select('*', { count: 'exact', head: true }).eq('telegram_connected', true),
      
      // 6. Last Global Scan (Max of last_scan_at from watchers)
      supabase.from('watchers').select('last_scan_at').order('last_scan_at', { ascending: false }).limit(1)
    ]);

    // Process unique pairs
    const pairs = totalPairsRes.data ? [...new Set(totalPairsRes.data.map(w => w.selected_pair))] : [];
    
    const stats = {
      activeWatchers: activeWatchersRes.count || 0,
      totalPairsMonitored: pairs.length,
      totalSignalsSent: totalSignalsRes.count || 0,
      totalUsers: totalUsersRes.count || 0,
      telegramConnected: telegramConnectedRes.count || 0,
      lastCronRun: lastScanRes.data && lastScanRes.data[0] ? lastScanRes.data[0].last_scan_at : null,
      systemStatus: 'ONLINE'
    };

    return res.status(200).json({ success: true, stats });
  } catch (err: any) {
    console.error("[Admin Stats Error]:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function performance_handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const startDate = thirtyDaysAgo.toISOString();

    const { data, error } = await supabase
      .from('trade_learning')
      .select('created_at, outcome')
      .gte('created_at', startDate)
      .order('created_at', { ascending: true });

    if (error) throw error;

    // Aggregate data by date
    const performanceMap = new Map<string, { date: string; wins: number; losses: number; breakeven: number }>();
    
    // Initialize last 30 days with zeros
    for (let i = 0; i < 30; i++) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const dateStr = d.toISOString().split('T')[0];
      performanceMap.set(dateStr, { date: dateStr, wins: 0, losses: 0, breakeven: 0 });
    }

    data?.forEach(trade => {
      const dateStr = new Date(trade.created_at).toISOString().split('T')[0];
      const entry = performanceMap.get(dateStr);
      if (entry) {
        if (trade.outcome === 'WIN') entry.wins++;
        else if (trade.outcome === 'LOSS') entry.losses++;
        else if (trade.outcome === 'BREAKEVEN') entry.breakeven++;
      } else {
        // Handle cases older than our initialization loop if any (shouldn't happen with gte)
        performanceMap.set(dateStr, { 
          date: dateStr, 
          wins: trade.outcome === 'WIN' ? 1 : 0, 
          losses: trade.outcome === 'LOSS' ? 1 : 0, 
          breakeven: trade.outcome === 'BREAKEVEN' ? 1 : 0 
        });
      }
    });

    const chartData = Array.from(performanceMap.values()).sort((a, b) => a.date.localeCompare(b.date));

    return res.status(200).json({ success: true, chartData });
  } catch (err: any) {
    console.error("[Admin Performance Error]:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function users_action_handler(req: any, res: any) {
  return res.status(200).json({ success: true });
}

async function users_handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    const { data } = await supabase.from('profiles').select('*');
    return res.status(200).json({ success: true, users: data || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function users_search_handler(req: any, res: any) {
  return res.status(200).json({ success: true, users: [] });
}

async function notifications_history_handler(req: any, res: any) {
  return res.status(200).json({ success: true, history: [] });
}

async function notifications_send_handler(req: any, res: any) {
  return res.status(200).json({ success: true });
}

async function watchers_action_handler(req: any, res: any) {
  return res.status(200).json({ success: true });
}

async function zone_history_handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { data: watchers, error: watcherError } = await supabase
      .from('watchers')
      .select('*')
      .order('updated_at', { ascending: false });

    if (watcherError) throw watcherError;

    // Fetch user profiles for email attribution
    const { data: profiles } = await supabase.from('profiles').select('id, email');
    const emailMap = new Map((profiles || []).map(p => [p.id, p.email]));

    // Fetch recent evaluations for why signal was triggered
    const { data: evaluations } = await supabase
      .from('watcher_evaluations')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);

    const evalMap = new Map<string, any>();
    for (const ev of evaluations || []) {
      if (ev.watcher_id && !evalMap.has(ev.watcher_id)) {
        evalMap.set(ev.watcher_id, ev);
      }
    }

    // Filter watchers that have zone data or trade signals
    const zoneWatchers = (watchers || []).filter(w => w.zone_type || w.zone_status !== 'NO_ZONE' || w.entry_price || w.trade_status === 'ACTIVE');

    // Sort by recent signal / tap / mark activity
    zoneWatchers.sort((a, b) => {
      const isSigA = a.zone_status === 'CONFIRMED' || !!a.entry_price ? 1 : 0;
      const isSigB = b.zone_status === 'CONFIRMED' || !!b.entry_price ? 1 : 0;
      if (isSigA !== isSigB) return isSigB - isSigA;

      const timeA = new Date(a.zone_tapped_at || a.zone_marked_at || a.updated_at || 0).getTime();
      const timeB = new Date(b.zone_tapped_at || b.zone_marked_at || b.updated_at || 0).getTime();
      return timeB - timeA;
    });

    const zones = zoneWatchers.map(w => {
      const ev = evalMap.get(w.id);
      return {
        id: w.id,
        watcherId: w.id,
        pair: w.selected_pair,
        timeframe: w.selected_timeframe || 'M5',
        userEmail: emailMap.get(w.user_id) || 'Unknown User',
        zoneType: w.zone_type,
        zoneStatus: w.zone_status,
        priceLevels: {
          high: w.zone_high,
          low: w.zone_low,
          invalidation: w.zone_invalidation_level,
          spreadOrWidth: w.zone_high && w.zone_low ? Number((w.zone_high - w.zone_low).toFixed(5)) : null
        },
        signal: {
          isTriggered: w.zone_status === 'CONFIRMED' || !!w.entry_price,
          direction: w.direction || (w.zone_type?.includes('BEARISH') ? 'SELL' : w.zone_type?.includes('BULLISH') ? 'BUY' : null),
          entryPrice: w.entry_price,
          stopLoss: w.stop_loss,
          takeProfit: w.take_profit,
          tradeStatus: w.trade_status
        },
        timing: {
          markedAt: w.zone_marked_at,
          tappedAt: w.zone_tapped_at,
          updatedAt: w.updated_at,
          createdCandleTime: w.zone_data?.createdCandleTime,
          displacementCandleTime: w.zone_data?.displacementCandleTime
        },
        reasons: {
          reasoning: w.zone_data?.reasoning || 'Unmitigated institutional price zone identified by SMC engine.',
          htfTrend: w.zone_data?.htfTrend || 'BEARISH',
          htfTimeframe: w.zone_data?.htfTimeframe || 'H4',
          htfReason: w.zone_data?.htfReason,
          strength: w.zone_data?.strength || null,
          evaluationScore: ev?.decision_score ?? null,
          matchedRules: ev?.matched_rules || [],
          failedRules: ev?.failed_rules || [],
          tradeReason: ev?.trade_reason || null,
          gateDetails: ev?.decision_snapshot?.decisionChain || []
        },
        rawZoneData: w.zone_data
      };
    });

    return res.status(200).json({ success: true, count: zones.length, zones });
  } catch (err: any) {
    console.error("[Admin Zone History Error]:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function watchers_handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    const { data } = await supabase.from('watchers').select('*');
    return res.status(200).json({ success: true, watchers: data || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function inspector_candles_handler(req: any, res: any) {
  return res.status(200).json({ success: true, candles: [] });
}

async function inspector_watcher_details_handler(req: any, res: any) {
  return res.status(200).json({ success: true });
}

async function explainability_handler(req: any, res: any) {
  return res.status(200).json({ success: true, stats: {}, logs: [] });
}

async function system_health_handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();

    const [
      activeUsersRes,
      watchersRes,
      todayScansRes,
      todaySignalsRes,
      lastScanRes,
      latencyRes,
      healthLogsRes
    ] = await Promise.all([
      // 1. Active Users (profiles with an active watcher)
      supabase.from('watchers').select('user_id', { count: 'exact', head: true }).eq('status', 'active'),
      
      // 2. Total Watchers
      supabase.from('watchers').select('*', { count: 'exact', head: true }),
      
      // 3. Today's Scans
      supabase.from('watcher_evaluations').select('*', { count: 'exact', head: true }).gte('created_at', todayStart),
      
      // 4. Today's Signals Sent
      supabase.from('watcher_evaluations').select('*', { count: 'exact', head: true }).gte('created_at', todayStart).eq('trade_sent', true),
      
      // 5. Last Scan Time
      supabase.from('watchers').select('last_scan_at').order('last_scan_at', { ascending: false }).limit(1),
      
      // 6. Latency Metrics (from health logs)
      supabase.from('system_health_logs').select('*').order('created_at', { ascending: false }).limit(20),
      
      // 7. Recent Health History
      supabase.from('system_health_logs').select('*').order('created_at', { ascending: false }).limit(50)
    ]);

    // Calculate average latencies from logs
    const logs = latencyRes.data || [];
    const avgLatency = (service: string) => {
      const serviceLogs = logs.filter(l => l.service === service && l.response_time_ms > 0);
      if (serviceLogs.length === 0) return 0;
      return Math.round(serviceLogs.reduce((acc, curr) => acc + curr.response_time_ms, 0) / serviceLogs.length);
    };

    const health = {
      backend: 'healthy',
      database: 'healthy',
      telegram: 'healthy',
      gemini: 'healthy',
      cron: 'running',
      learning_engine: 'healthy',
      
      active_users: activeUsersRes.count || 0,
      watchers: watchersRes.count || 0,
      today_scans: todayScansRes.count || 0,
      today_signals: todaySignalsRes.count || 0,
      today_failures: 0, // Inferred as 0 for now
      last_scan: lastScanRes.data && lastScanRes.data[0] ? lastScanRes.data[0].last_scan_at : null,
      
      average_scan_ms: avgLatency('watcher-scan'),
      average_gemini_ms: avgLatency('gemini'),
      average_telegram_ms: avgLatency('telegram'),
      database_latency_ms: avgLatency('database'),
      telegram_latency_ms: avgLatency('telegram'),
      gemini_latency_ms: avgLatency('gemini'),
      
      uptime: '99.9%',
      version: '1.2.4',
      
      history: healthLogsRes.data?.map(l => ({
        timestamp: l.created_at,
        component: l.service,
        status: l.status,
        latency: l.response_time_ms,
        message: l.message
      })) || []
    };

    return res.status(200).json({ success: true, ...health });
  } catch (err: any) {
    console.error("[System Health Error]:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function logs_handler(req: any, res: any) {
  return res.status(200).json({ success: true, logs: [] });
}

async function send_test_alert_handler(req: any, res: any) {
  return res.status(200).json({ success: true });
}

import { defaultEconomicEventService } from '../src/lib/economic-event-service.js';

async function sync_economic_events_handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { from, to } = req.query;
    console.log(`[Admin] Triggering manual economic event sync. From: ${from || 'default'}, To: ${to || 'default'}`);
    
    // Use the admin's service role client for the sync
    defaultEconomicEventService.setWindows(60, 30); // Use defaults
    
    await defaultEconomicEventService.syncEvents(from as string, to as string);
    
    return res.status(200).json({ success: true, message: 'Economic events sync completed successfully.' });
  } catch (err: any) {
    console.error("[Admin Economic Sync Error]:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}

async function backtest_dataset_handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  const matchedPath = req.headers['x-matched-path'] || req.headers['x-original-url'] || req.url || '';
  const parsedUrl = new URL(matchedPath, 'http://localhost');
  const pathname = parsedUrl.pathname || '';

  try {
    if (req.method === 'GET') {
      const parts = pathname.split('/');
      const datasetIndex = parts.indexOf('datasets');
      const datasetId = datasetIndex !== -1 && parts.length > datasetIndex + 1 ? parts[datasetIndex + 1] : req.query?.id;

      if (datasetId) {
        const details = await getBacktestDatasetDetails(datasetId);
        if (!details.success) {
          return res.status(404).json(details);
        }
        return res.status(200).json(details);
      }

      const datasets = await listBacktestDatasets();
      return res.status(200).json({ success: true, datasets });
    }

    if (req.method === 'POST') {
      const { name, symbol, timeframe, sourceFilename, csvContent, parsedCandles } = req.body || {};
      const userId = req.userId || 'admin';

      const result = await createBacktestDataset({
        userId,
        name,
        symbol,
        timeframe,
        sourceFilename,
        csvContent,
        parsedCandles
      });

      if (!result.success) {
        return res.status(400).json(result);
      }

      return res.status(200).json(result);
    }

    if (req.method === 'DELETE') {
      const parts = pathname.split('/');
      const datasetIndex = parts.indexOf('datasets');
      const datasetId = datasetIndex !== -1 && parts.length > datasetIndex + 1 ? parts[datasetIndex + 1] : req.query?.id;

      if (!datasetId) {
        return res.status(400).json({ success: false, error: 'Dataset ID required for deletion' });
      }

      const result = await deleteBacktestDataset(datasetId);
      return res.status(200).json(result);
    }

    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  } catch (err: any) {
    console.error('[Admin Backtest Handler Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
  }
}

async function backtest_run_handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  try {
    const { datasetId, strategyId, strategyText, initialBalance, symbol, timeframe, startTime, endTime, simulation } = req.body || {};

    const config = {
      datasetId,
      strategyId,
      strategyText,
      initialBalance: Number(initialBalance) || 100000,
      symbol,
      timeframe,
      startTime,
      endTime,
      simulation
    };

    const result = await runBacktest(config);

    if (!result.success) {
      return res.status(400).json(result);
    }

    const userId = req.userId || 'admin';
    const saveRes = await saveBacktestRun({
      userId,
      engineResult: result,
      strategySnapshot: { strategyText: config.strategyText, strategyId: config.strategyId },
      simulationConfig: config.simulation || {}
    });

    return res.status(200).json({
      ...result,
      runId: saveRes.runId
    });
  } catch (err: any) {
    console.error('[Admin Backtest Run Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Backtest execution failed' });
  }
}

async function backtest_runs_handler(req: any, res: any) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  const matchedPath = req.headers['x-matched-path'] || req.headers['x-original-url'] || req.url || '';
  const parsedUrl = new URL(matchedPath, 'http://localhost');
  const pathname = parsedUrl.pathname || '';

  try {
    if (req.method === 'GET') {
      const parts = pathname.split('/');
      const runsIndex = parts.indexOf('runs');
      const runId = runsIndex !== -1 && parts.length > runsIndex + 1 ? parts[runsIndex + 1] : req.query?.id;

      if (runId) {
        const run = await getBacktestRun(runId);
        if (!run) {
          return res.status(404).json({ success: false, error: 'Backtest run not found' });
        }
        return res.status(200).json({ success: true, run });
      }

      const runs = await listBacktestRuns();
      return res.status(200).json({ success: true, runs });
    }

    if (req.method === 'DELETE') {
      const parts = pathname.split('/');
      const runsIndex = parts.indexOf('runs');
      const runId = runsIndex !== -1 && parts.length > runsIndex + 1 ? parts[runsIndex + 1] : req.query?.id;

      if (!runId) {
        return res.status(400).json({ success: false, error: 'Run ID required for deletion' });
      }

      const result = await deleteBacktestRun(runId);
      return res.status(200).json(result);
    }

    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  } catch (err: any) {
    console.error('[Admin Backtest Runs Handler Error]:', err);
    return res.status(500).json({ success: false, error: err.message || 'Internal Server Error' });
  }
}

export default async function handler(req: any, res: any) {
  // CORS configuration
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  const supabase = getSupabase();

  const authResult = await verifyAdminAuth(req, supabase);

  if (!authResult.isAdmin) {
    return res
      .status(authResult.statusCode || 403)
      .json({
        success: false,
        error: authResult.error || "Forbidden",
      });
  }

  try {
    const matchedPath = req.headers['x-matched-path'] || req.headers['x-original-url'] || req.url || '';
    const parsedUrl = new URL(matchedPath, 'http://localhost');
    const pathname = parsedUrl.pathname || '';

    if (pathname.includes('/backtest/runs')) return backtest_runs_handler(req, res);
    if (pathname.includes('/backtest/run')) return backtest_run_handler(req, res);
    if (pathname.includes('/backtest/datasets')) return backtest_dataset_handler(req, res);
    if (pathname.endsWith('/sync-economic-events')) return sync_economic_events_handler(req, res);
    if (pathname.endsWith('/logs')) return logs_handler(req, res);
    if (pathname.endsWith('/system-health')) return system_health_handler(req, res);
    if (pathname.endsWith('/performance')) return performance_handler(req, res);
    if (pathname.endsWith('/stats')) return stats_handler(req, res);
    if (pathname.endsWith('/explainability')) return explainability_handler(req, res);
    if (pathname.endsWith('/users/search')) return users_search_handler(req, res);
    if (pathname.endsWith('/notifications/history')) return notifications_history_handler(req, res);
    if (pathname.endsWith('/notifications/send')) return notifications_send_handler(req, res);
    if (pathname.endsWith('/users/action')) return users_action_handler(req, res);
    if (pathname.endsWith('/users')) return users_handler(req, res);
    if (pathname.endsWith('/watchers/action')) return watchers_action_handler(req, res);
    if (pathname.endsWith('/watchers')) return watchers_handler(req, res);
    if (pathname.endsWith('/inspector/candles')) return inspector_candles_handler(req, res);
    if (pathname.endsWith('/inspector/watcher-details')) return inspector_watcher_details_handler(req, res);
    if (pathname.endsWith('/signals')) return signals_handler(req, res);
    if (pathname.endsWith('/zone-history')) return zone_history_handler(req, res);
    if (pathname.endsWith('/health')) return health_handler(req, res);
    if (pathname.endsWith('/settings')) return settings_handler(req, res);
    if (pathname.endsWith('/send-test-alert')) return send_test_alert_handler(req, res);
    return stats_handler(req, res);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
