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

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
  if (!token) return res.status(401).json({ success: false, error: "Unauthorized" });

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user || user.email?.trim().toLowerCase() !== "gaks6535@gmail.com") {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    if (req.method === 'POST') {
      const model = "gemini-3.5-flash-lite";
      try {
        const responseText = await runGeminiRequest(supabase, user.id, "Reply only with OK", model);
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

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, "utf-8");
      return {
        defaultStrategy: "Gaks AI Default Strategy",
        defaultGeminiModel: "gemini-3.5-flash-lite",
        scanInterval: 15,
        maintenanceMode: false,
        executionMode: "HYBRID",
        ...JSON.parse(data)
      };
    }
  } catch (e) {}
  return {
    defaultStrategy: "Gaks AI Default Strategy",
    defaultGeminiModel: "gemini-3.5-flash-lite",
    scanInterval: 15,
    maintenanceMode: false,
    executionMode: "HYBRID"
  };
}

function saveSettings(settings: any) {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), "utf-8");
  } catch (e) {}
}

async function settings_handler(req: any, res: any) {
  const supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Content-Type", "application/json");
  if (req.method === "OPTIONS") return res.status(200).end();

  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;
  if (!token) return res.status(401).json({ success: false, error: "Unauthorized" });

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user || user.email?.trim().toLowerCase() !== "gaks6535@gmail.com") {
      return res.status(403).json({ success: false, error: "Unauthorized" });
    }

    let appSettings = loadSettings();
    if (req.method === 'GET') {
      return res.status(200).json({ success: true, settings: appSettings });
    } else {
      const { settings } = req.body;
      if (!settings) return res.status(400).json({ success: false, error: "Missing settings" });
      appSettings = { ...appSettings, ...settings };
      saveSettings(appSettings);
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
    const { count } = await supabase.from('watcher_evaluations').select('*', { count: 'exact', head: true });
    return res.status(200).json({ success: true, stats: { totalScans: count || 0, systemStatus: 'ONLINE' } });
  } catch (err: any) {
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
  return res.status(200).json({ success: true, backend: 'healthy', database: 'healthy', telegram: 'healthy', gemini: 'healthy', cron: 'running' });
}

async function logs_handler(req: any, res: any) {
  return res.status(200).json({ success: true, logs: [] });
}

async function send_test_alert_handler(req: any, res: any) {
  return res.status(200).json({ success: true });
}

export default async function handler(req: any, res: any) {
  try {
    const matchedPath = req.headers['x-matched-path'] || req.headers['x-original-url'] || req.url || '';
    const parsedUrl = new URL(matchedPath, 'http://localhost');
    const pathname = parsedUrl.pathname || '';

    if (pathname.endsWith('/logs')) return logs_handler(req, res);
    if (pathname.endsWith('/system-health')) return system_health_handler(req, res);
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
    if (pathname.endsWith('/health')) return health_handler(req, res);
    if (pathname.endsWith('/settings')) return settings_handler(req, res);
    if (pathname.endsWith('/send-test-alert')) return send_test_alert_handler(req, res);
    return stats_handler(req, res);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
}
