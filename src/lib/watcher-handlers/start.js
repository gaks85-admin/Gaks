import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "crypto";
import { generateStrategySummary } from "../strategy-summarizer.js";
import { resolveUserGeminiKey } from "../gemini-key-resolver.js";
import { timeframeToMinutes } from "../timeframe.js";
import { defaultMarketDataService } from "../market-data-service.js";
import { getMarketSchedule } from "../market-hours.js";
import { toCanonicalSymbol, toDisplaySymbol } from "../market-data-gateway.js";
import { compileStrategy } from "../strategy-compiler.js";
import { extractMarketStructure } from "../market-structure-engine.js";
import { resolveHigherTimeframeTrend } from "../htf-trend-engine.js";
import { identifyMarkedZone } from "../zone-engine.js";
const getSupabase = (token) => {
  const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase configuration missing (VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required)");
  }
  const headers = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    global: {
      headers
    }
  });
};
async function sendTelegramMessage(chatId, text) {
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
        text,
        parse_mode: "Markdown"
      })
    });
    if (!response.ok) {
      console.error(`Telegram sendMessage failed with status ${response.status}:`, await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Error sending Telegram message:", err);
    return false;
  }
}
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
function extractActiveStrategyDetails(strategyText) {
  const DEFAULT_STRATEGY_NAME = "Gaks AI Default Strategy";
  const DEFAULT_STRATEGY_UUID = "00000000-0000-0000-0000-000000000000";
  const LEGACY_CUSTOM_STRATEGY_UUID = "11111111-1111-1111-1111-111111111111";
  if (!strategyText || !strategyText.trim()) {
    return { id: DEFAULT_STRATEGY_UUID, name: DEFAULT_STRATEGY_NAME, text: DEFAULT_STRATEGY_TEXT, isDefault: true };
  }
  const defaultTemplate = `\u2022 Entry conditions
\u2022 Confirmation indicators
\u2022 Exit & stop-loss logic
\u2022 Risk management rules`;
  if (strategyText.trim() === defaultTemplate.trim()) {
    return { id: DEFAULT_STRATEGY_UUID, name: DEFAULT_STRATEGY_NAME, text: DEFAULT_STRATEGY_TEXT, isDefault: true };
  }
  try {
    const parsed = JSON.parse(strategyText);
    if (parsed && typeof parsed === "object" && Array.isArray(parsed.strategies)) {
      const active = parsed.strategies.find((s) => {
        if (parsed.activeId === "default" || parsed.activeId === DEFAULT_STRATEGY_UUID) {
          return s.id === "default" || s.id === DEFAULT_STRATEGY_UUID || s.isDefault;
        }
        return s.id === parsed.activeId;
      }) || parsed.strategies[0];
      let finalId = active ? active.id : DEFAULT_STRATEGY_UUID;
      if (finalId === "default") {
        finalId = DEFAULT_STRATEGY_UUID;
      } else if (finalId === "11111111-1111-1111-1111-111111111111") {
        finalId = LEGACY_CUSTOM_STRATEGY_UUID;
      }
      return {
        id: finalId,
        name: active ? active.name || DEFAULT_STRATEGY_NAME : DEFAULT_STRATEGY_NAME,
        text: active ? active.text || DEFAULT_STRATEGY_TEXT : DEFAULT_STRATEGY_TEXT,
        isDefault: active ? !!active.isDefault : true
      };
    }
  } catch (e) {
  }
  return { id: LEGACY_CUSTOM_STRATEGY_UUID, name: "Legacy Custom Strategy", text: strategyText, isDefault: false };
}
async function handler(req, res) {
  let supabase = getSupabase();
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  let userId = req.body?.userId;
  let selectedPair = req.body?.selectedPair;
  let selectedTimeframe = req.body?.selectedTimeframe;
  if (req.method !== "POST") {
    console.log("[Watcher Activation] FAILED at Step 0:", {
      step: 0,
      reason: "Method Not Allowed",
      user_id: userId,
      selected_pair: selectedPair,
      selected_timeframe: selectedTimeframe
    });
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }
  const authHeader = req.headers.authorization || "";
  const tokenHeader = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : authHeader;
  if (tokenHeader) {
    try {
      console.log("[Watcher Start] Validating auth token...");
      const { data: { user }, error: authError } = await supabase.auth.getUser(tokenHeader);
      if (authError || !user) {
        console.warn("[Watcher Start] Bearer token auth validation failed:", authError?.message);
      } else {
        console.log("[Watcher Start] Auth success. User ID:", user.id);
        userId = user.id;
        supabase = getSupabase(tokenHeader);
      }
    } catch (err) {
      console.warn("[Watcher Start] Bearer token verification error:", err.message);
    }
  }
  if (!userId) {
    console.log("[Watcher Activation] FAILED at Step 1:", {
      step: 1,
      reason: "Authentication failed. You must be authenticated to start the AI Market Watcher.",
      user_id: userId,
      selected_pair: selectedPair,
      selected_timeframe: selectedTimeframe
    });
    return res.status(401).json({
      success: false,
      error: "Authentication failed. You must be authenticated to start the AI Market Watcher."
    });
  }
  if (!selectedPair) {
    console.log("[Watcher Activation] FAILED at Step 2:", {
      step: 2,
      reason: "Please select a trading pair to monitor before activating the Market Watcher.",
      user_id: userId,
      selected_pair: selectedPair,
      selected_timeframe: selectedTimeframe
    });
    return res.status(400).json({
      success: false,
      error: "Please select a trading pair to monitor before activating the Market Watcher."
    });
  }
  const isSupportedSymbol = (sym) => {
    if (!sym) return false;
    const normalized = sym.toUpperCase().trim().replace(/[-_\s/]/g, "");
    return /^[A-Z0-9]{2,12}$/.test(normalized);
  };
  if (!isSupportedSymbol(selectedPair)) {
    console.log("[Watcher Activation] FAILED at Step 3:", {
      step: 3,
      reason: `Symbol "${selectedPair}" is invalid.`,
      user_id: userId,
      selected_pair: selectedPair,
      selected_timeframe: selectedTimeframe
    });
    return res.status(400).json({
      success: false,
      error: `Symbol "${selectedPair}" is invalid. Please enter a valid trading symbol (e.g., USDCAD, AUDUSD, AUDCAD, EURUSD, US30).`
    });
  }
  let telegramChatId = null;
  try {
    console.log(`[Watcher Start] Verifying requirements for authenticated user: ${userId}`);
    console.log("[Watcher Start] Fetching user profile...");
    const { data: profile, error: profileError } = await supabase.from("profiles").select("*").eq("id", userId).maybeSingle();
    if (profileError) {
      console.warn("[Watcher Start] Profile query warning:", profileError.message);
    }
    console.log("[Watcher Start] Profile result:", JSON.stringify(profile, null, 2));
    console.log("[Watcher Start] Checking telegram connection...");
    let { data: telegramConn, error: telegramError } = await supabase.from("telegram_connections").select("*").eq("user_id", userId).maybeSingle();
    if (!telegramConn) {
      console.log("[Watcher Start] No telegram connection found. Auto-creating row...");
      const { data: newConn, error: insertError } = await supabase.from("telegram_connections").insert({ user_id: userId, connected: false, connection_token: randomUUID(), created_at: (/* @__PURE__ */ new Date()).toISOString(), updated_at: (/* @__PURE__ */ new Date()).toISOString() }).select().single();
      if (insertError) {
        console.error("[Watcher Start] Failed to create telegram_connections row:", insertError.message);
      } else {
        console.log("[Watcher Start] Auto-created telegram connection row:", JSON.stringify(newConn, null, 2));
        telegramConn = newConn;
      }
    } else {
      console.log("[Watcher Start] Existing telegram connection found:", JSON.stringify(telegramConn, null, 2));
    }
    if (telegramError && !telegramConn) {
      console.warn("[Watcher Start] Telegram connection lookup error:", telegramError.message);
    }
    telegramChatId = telegramConn?.telegram_chat_id || null;
    if (!telegramConn || !telegramConn.connected || !telegramChatId) {
      console.log("[Watcher Start] Termination: Telegram not connected or missing chatId.");
      console.log("[Watcher Activation] FAILED at Step 4:", {
        step: 4,
        reason: "Telegram is not connected. Please connect your Telegram account first under Gaks AI Settings.",
        user_id: userId,
        selected_pair: selectedPair,
        selected_timeframe: selectedTimeframe
      });
      return res.status(400).json({
        success: false,
        error: "Telegram is not connected. Please connect your Telegram account first under Gaks AI Settings."
      });
    }
    console.log("[Watcher] Logged in user:", userId);
    console.log("[Watcher] userId:", userId);
    console.log("[Watcher] selectedPair:", selectedPair);
    console.log("[Watcher] selectedTimeframe:", selectedTimeframe);
    const keyRes = await resolveUserGeminiKey(supabase, userId, "watcher-start", { pair: selectedPair, timeframe: selectedTimeframe });
    if (!keyRes.keyPresent || !keyRes.apiKey) {
      const errReason = "Gemini API key is required to activate Market Watcher. Please configure your Gemini API key under Settings.";
      console.log("[Watcher Start] Termination: Gemini API key lookup failed or key missing.");
      const failedStepLog = {
        step: 5,
        reason: errReason,
        keyStatus: keyRes.status,
        user_id: userId,
        selected_pair: selectedPair,
        selected_timeframe: selectedTimeframe
      };
      console.log("[Watcher Activation] FAILED at Step 5:", failedStepLog);
      await sendTelegramMessage(
        telegramChatId,
        `\u274C *Market Watcher Activation Failed*

Step 5 Error: ${errReason}`
      );
      return res.status(400).json({
        success: false,
        error: errReason,
        step: 5,
        failedAtStep: "Step 5",
        user_id: userId,
        selected_pair: selectedPair,
        selected_timeframe: selectedTimeframe
      });
    }
    const resolvedGeminiApiKey = keyRes.apiKey;
    console.log("[Watcher Start] Fetching trading preferences...");
    const { data: prefsRecord, error: prefsError } = await supabase.from("trading_preferences").select("*").eq("user_id", userId).maybeSingle();
    if (prefsError) {
      console.warn("[Watcher Start] Trading preferences query error:", prefsError.message);
    }
    console.log("[Watcher Start] Trading preferences result:", JSON.stringify(prefsRecord, null, 2));
    const strategyDetails = extractActiveStrategyDetails(prefsRecord?.strategy_text || "");
    const activeStrategyText = strategyDetails.text;
    console.log("[Watcher Start] Strategy extracted:", strategyDetails.name, "ID:", strategyDetails.id);
    if (!activeStrategyText.trim()) {
      console.log("[Watcher Start] Termination: Strategy text is empty.");
      await sendTelegramMessage(telegramChatId, "\u274C *Market Watcher Activation Failed*\n\nReason: Active trading strategy is empty. Please configure your strategy first.");
      console.log("[Watcher Activation] FAILED at Step 6:", {
        step: 6,
        reason: "Active trading strategy is empty. Please configure your strategy first.",
        user_id: userId,
        selected_pair: selectedPair,
        selected_timeframe: selectedTimeframe
      });
      return res.status(400).json({
        success: false,
        error: "Active trading strategy is empty. Please configure your strategy first."
      });
    }
    if (!prefsRecord?.strategy_summary || !prefsRecord.strategy_summary.trim()) {
      try {
        const summary = await generateStrategySummary(activeStrategyText, {
          apiKey: resolvedGeminiApiKey,
          userId,
          supabase,
          keySource: keyRes.keySource,
          watcherId: "watcher-start"
        });
        const { error: sumErrUpdate } = await supabase.from("trading_preferences").update({ strategy_summary: summary, updated_at: (/* @__PURE__ */ new Date()).toISOString() }).eq("user_id", userId);
        if (sumErrUpdate) {
          console.warn("[Watcher Start] Notice: Could not write strategy_summary to DB (column may not exist yet):", sumErrUpdate.message);
        } else {
          console.log("[Watcher Start] Populated strategy_summary:", summary);
        }
      } catch (sumErr) {
        console.error("[Watcher Start] Failed to populate strategy_summary:", sumErr.message);
        if (sumErr.errorType === "INVALID_CREDENTIALS" || sumErr.errorType === "QUOTA_EXHAUSTED" || sumErr.errorType === "PERMISSION_ERROR") {
          return res.status(400).json({
            success: false,
            error: `Gemini API Error (${sumErr.errorType}): ${sumErr.message}`,
            errorType: sumErr.errorType,
            failedAtStep: "Strategy Summarizer"
          });
        }
      }
    }
    const preferredRisk = prefsRecord?.preferred_risk || "";
    const riskReward = prefsRecord?.risk_reward || "";
    if (!preferredRisk.trim() || !riskReward.trim()) {
      console.log("[Watcher Start] Termination: Risk settings incomplete.");
      await sendTelegramMessage(telegramChatId, "\u274C *Market Watcher Activation Failed*\n\nReason: Risk settings are incomplete. Please define and save your Preferred Risk and Risk:Reward Ratio under the Risk & Sizing section first.");
      console.log("[Watcher Activation] FAILED at Step 7:", {
        step: 7,
        reason: "Risk settings are incomplete. Please define and save your Preferred Risk and Risk:Reward Ratio under the Risk & Sizing section first.",
        user_id: userId,
        selected_pair: selectedPair,
        selected_timeframe: selectedTimeframe
      });
      return res.status(400).json({
        success: false,
        error: "Risk settings are incomplete. Please define and save your Preferred Risk and Risk:Reward Ratio under the Risk & Sizing section first."
      });
    }
    const userRole = profile?.role === "admin" || profile?.email?.trim().toLowerCase() === "gaks6535@gmail.com" ? "admin" : "user";
    console.log("[Watcher Start] Checking existing active watchers...");
    const { data: existingActiveWatchers, error: watchersFetchError } = await supabase.from("watchers").select("*").eq("user_id", userId).eq("status", "active");
    if (watchersFetchError) {
      console.error("[Watcher Start] Error fetching existing watchers:", watchersFetchError.message);
    }
    console.log("[Watcher Start] Active watchers found:", existingActiveWatchers?.length || 0);
    if (userRole === "user" && existingActiveWatchers && existingActiveWatchers.length > 0) {
      const hasDifferentActive = existingActiveWatchers.some((w) => w.selected_pair !== selectedPair);
      if (hasDifferentActive) {
        await sendTelegramMessage(telegramChatId, "\u274C *Market Watcher Activation Failed*\n\nReason: You can monitor only one trading pair at a time.");
        console.log("[Watcher Activation] FAILED at Step 8:", {
          step: 8,
          reason: "You can monitor only one trading pair at a time.",
          user_id: userId,
          selected_pair: selectedPair,
          selected_timeframe: selectedTimeframe
        });
        return res.status(400).json({
          success: false,
          error: "You can monitor only one trading pair at a time."
        });
      }
    }
    await supabase.from("watchers").update({
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
    }).eq("user_id", userId).neq("status", "active");
    const pairsMonitored = selectedPair;
    const convertSymbol = (sym) => {
      if (!sym) return sym;
      const mapped = sym.toUpperCase().trim().replace(/[-_\s/]/g, "");
      const mappings = {
        "EURUSD": "EUR/USD",
        "GBPUSD": "GBP/USD",
        "XAUUSD": "XAU/USD",
        "XAGUSD": "XAG/USD",
        "BTCUSD": "BTC/USD",
        "NAS100": "QQQ",
        "US30": "DIA",
        "SPX500": "SPY",
        "US500": "SPY"
      };
      if (mappings[mapped]) {
        return mappings[mapped];
      }
      const commonCryptoCoins = [
        "BTC",
        "ETH",
        "SOL",
        "XRP",
        "LTC",
        "ADA",
        "DOGE",
        "BNB",
        "AVAX",
        "DOT",
        "LINK",
        "MATIC",
        "POL",
        "UNI",
        "NEAR",
        "TRX",
        "ATOM",
        "BCH",
        "SHIB",
        "TON",
        "SUI",
        "PEPE",
        "ARB",
        "OP",
        "APT",
        "AAVE",
        "ALGO",
        "FIL",
        "ICP",
        "VET",
        "HBAR",
        "XLM",
        "FTM",
        "SAND",
        "MANA",
        "AXS",
        "INJ",
        "RUNE",
        "SEI",
        "TIA"
      ];
      const commonCryptoQuote = ["USD", "USDT", "BTC", "ETH", "EUR", "GBP", "FDUSD", "USDC", "BUSD"];
      for (const coin of commonCryptoCoins) {
        if (mapped.startsWith(coin)) {
          const suffix = mapped.slice(coin.length);
          if (commonCryptoQuote.includes(suffix)) {
            return `${coin}/${suffix}`;
          }
        }
      }
      if (mapped.length === 6 && /^[A-Z]{6}$/.test(mapped)) {
        return `${mapped.slice(0, 3)}/${mapped.slice(3)}`;
      }
      if (mapped.endsWith("USDT") && mapped.length > 4) return mapped.slice(0, -4) + "/USDT";
      if (mapped.endsWith("USDC") && mapped.length > 4) return mapped.slice(0, -4) + "/USDC";
      if (mapped.endsWith("BUSD") && mapped.length > 4) return mapped.slice(0, -4) + "/BUSD";
      if (mapped.endsWith("USD") && mapped.length > 3 && !/^(US|XAU|XAG)/.test(mapped) && !/\d/.test(mapped)) return mapped.slice(0, -3) + "/USD";
      if (mapped.endsWith("JPY") && mapped.length > 3) return mapped.slice(0, -3) + "/JPY";
      if (mapped.endsWith("EUR") && mapped.length > 3) return mapped.slice(0, -3) + "/EUR";
      if (mapped.endsWith("GBP") && mapped.length > 3) return mapped.slice(0, -3) + "/GBP";
      return mapped;
    };
    const mappedSymbol = convertSymbol(selectedPair);
    const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
    if (!twelveDataKey) {
      console.warn("[Watcher Start] Missing TWELVE_DATA_API_KEY. Skipping Twelve Data symbol validation.");
    } else {
      console.log(`[Watcher Start] Validating symbol "${mappedSymbol}" (converted from "${selectedPair}") against Twelve Data API...`);
      try {
        const valRes = await defaultMarketDataService.validateSymbol(mappedSymbol);
        if (!valRes.isValid && !valRes.reason?.includes("RATE_LIMITED") && !valRes.reason?.includes("429")) {
          console.log("[Watcher Activation] FAILED at Step 9:", {
            step: 9,
            reason: `TwelveData Error: The symbol "${selectedPair}" was not found or is invalid on Twelve Data. (${valRes.reason})`,
            user_id: userId,
            selected_pair: selectedPair,
            selected_timeframe: selectedTimeframe
          });
          return res.status(400).json({
            success: false,
            error: `TwelveData Error: Symbol "${selectedPair}" is not recognized or not supported. Please try another symbol.`
          });
        }
      } catch (validationErr) {
        console.warn("[Watcher Start] Warning during Twelve Data symbol validation check:", validationErr.message || validationErr);
      }
    }
    const nowString = (/* @__PURE__ */ new Date()).toISOString();
    let accountSize = null;
    if (prefsRecord) {
      const cap = prefsRecord.capital === "Custom" ? prefsRecord.custom_capital || prefsRecord.capital || "" : prefsRecord.capital || prefsRecord.custom_capital || "";
      const cleanedCap = String(cap).replace(/[^0-9.]/g, "");
      if (cleanedCap) {
        accountSize = parseFloat(cleanedCap);
      }
    }
    let riskPercentage = null;
    if (prefsRecord && prefsRecord.preferred_risk) {
      const cleanedRisk = String(prefsRecord.preferred_risk).replace(/[^0-9.]/g, "");
      if (cleanedRisk) {
        riskPercentage = parseFloat(cleanedRisk);
      }
    }
    const finalTimeframe = selectedTimeframe || "H1";
    const computedInterval = timeframeToMinutes(finalTimeframe);
    console.log(`Selected timeframe: ${finalTimeframe}`);
    console.log(`Computed interval: ${computedInterval}`);
    console.log(`Database interval: ${computedInterval}`);
    console.log("[Watcher Start] Upserting watcher record...");
    const watcherData = {
      user_id: userId,
      status: "active",
      strategy_id: strategyDetails.id,
      started_at: nowString,
      telegram_chat_id: telegramChatId,
      account_size: accountSize,
      risk_percentage: riskPercentage,
      selected_pair: toCanonicalSymbol(selectedPair),
      selected_timeframe: finalTimeframe,
      gemini_model: "gemini-3.5-flash-lite",
      scan_interval_minutes: computedInterval,
      trade_status: "WAITING",
      entry_price: null,
      stop_loss: null,
      take_profit: null,
      direction: null,
      opened_at: null,
      closed_at: null,
      cooldown_until: null,
      signal_message_id: null,
      last_scan_at: null,
      updated_at: nowString
    };
    console.log("[Watcher Start] Watcher data payload:", JSON.stringify(watcherData, null, 2));
    console.log("[Watcher Activation] Reached UPSERT");
    const { error: watchersError, data: insertData } = await supabase.from("watchers").upsert(watcherData, { onConflict: "user_id,selected_pair" }).select();
    if (watchersError) {
      console.error("[Watcher Start] Failed to write to watchers table:", watchersError.message);
      await sendTelegramMessage(telegramChatId, `\u274C *Market Watcher Activation Failed*

Reason: Failed to write watcher state to DB: ${watchersError.message}`);
      console.log("[Watcher Activation] FAILED at Step 12:", {
        step: 12,
        reason: "Failed to write watcher state to DB: " + watchersError.message,
        user_id: userId,
        selected_pair: selectedPair,
        selected_timeframe: finalTimeframe
      });
      return res.status(500).json({
        success: false,
        error: "Failed to write watcher state to DB: " + watchersError.message,
        details: watchersError
      });
    }
    console.log("[Watcher Start] Watcher upsert successful.");
    const { data: savedWatcherRow, error: fetchSavedErr } = await supabase.from("watchers").select("id, selected_timeframe, scan_interval_minutes").eq("user_id", userId).eq("selected_pair", toCanonicalSymbol(selectedPair)).maybeSingle();
    if (fetchSavedErr || !savedWatcherRow) {
      throw new Error(`Failed to verify saved watcher: ${fetchSavedErr?.message || "Not found"}`);
    }
    console.log(`Saved timeframe: ${savedWatcherRow.selected_timeframe}`);
    console.log(`Saved scan_interval_minutes: ${savedWatcherRow.scan_interval_minutes}`);
    if (savedWatcherRow.scan_interval_minutes !== computedInterval) {
      console.error(`[Watcher Start] Interval mismatch! Computed: ${computedInterval}, Saved: ${savedWatcherRow.scan_interval_minutes}`);
      throw new Error(`Saved interval (${savedWatcherRow.scan_interval_minutes}) differs from computed interval (${computedInterval})`);
    }
    console.log("[Watcher Activation] Watcher created successfully");
    let initialTrendNotice = "";
    let initialZoneData = null;
    try {
      const canonicalSym = toCanonicalSymbol(selectedPair);
      const candlesRes = await defaultMarketDataService.getMarketData({
        symbol: canonicalSym,
        timeframe: finalTimeframe,
        requiredCount: 150,
        purpose: "Watcher Activation Zone Markout"
      });
      if (candlesRes.isValid && candlesRes.candles && candlesRes.candles.length >= 10) {
        const compiledStrategy = compileStrategy(strategyDetails.text);
        const marketStructure = extractMarketStructure(candlesRes.candles);
        const htfTrendResult = await resolveHigherTimeframeTrend(
          canonicalSym,
          candlesRes.candles,
          finalTimeframe,
          { preferredHtf: compiledStrategy.compiled_rules?.preferred_htf || "H4" }
        );
        marketStructure.htfTrend = htfTrendResult.trend;
        marketStructure.htfTimeframe = htfTrendResult.timeframe;
        marketStructure.htfReason = htfTrendResult.reason;
        marketStructure.htfAllowedDirection = htfTrendResult.allowedDirection;
        marketStructure.htfCandles = htfTrendResult.htfCandles;
        marketStructure.htfMarketStructure = htfTrendResult.htfMarketStructure;
        const latestCandle = candlesRes.candles[candlesRes.candles.length - 1];
        const activePrice = latestCandle?.close || 0;
        const markedZone = identifyMarkedZone(candlesRes.candles, marketStructure, compiledStrategy, activePrice);
        if (markedZone) {
          markedZone.status = "WAITING_FOR_TAP";
          initialZoneData = markedZone;
          await supabase.from("watchers").update({
            zone_data: markedZone,
            zone_status: "WAITING_FOR_TAP",
            zone_high: markedZone.high,
            zone_low: markedZone.low,
            zone_type: markedZone.type,
            zone_invalidation_level: markedZone.invalidationLevel,
            zone_marked_at: (/* @__PURE__ */ new Date()).toISOString(),
            updated_at: nowString
          }).eq("id", savedWatcherRow.id);
          initialTrendNotice = `

*HTF Trend:* ${htfTrendResult.timeframe} ${htfTrendResult.trend}
*Marked Zone:* ${markedZone.type} [${markedZone.low} - ${markedZone.high}] (${markedZone.direction})
*Status:* WAITING FOR RETEST \u{1F3AF} (Price: ${activePrice})`;
          console.log(`[Watcher Activation Zone Markout] Watcher ID ${savedWatcherRow.id}: Immediately marked ${markedZone.type} [${markedZone.low} - ${markedZone.high}] (${markedZone.direction})`);
        } else {
          if (htfTrendResult.trend === "SIDEWAYS" || htfTrendResult.allowedDirection === "NONE") {
            initialTrendNotice = `

*HTF Trend:* ${htfTrendResult.timeframe} SIDEWAYS / Consolidation
*Status:* Active. Scanning for structural Supply & Demand POI/Zone formation.`;
          } else {
            initialTrendNotice = `

*HTF Trend:* ${htfTrendResult.timeframe} ${htfTrendResult.trend}
*Status:* Trend verified. Awaiting new structural POI/Zone formation.`;
          }
        }
      }
    } catch (initErr) {
      console.warn("[Watcher Activation] Initial zone markout notice:", initErr);
    }
    console.log(`[Watcher Start] AI Market Watcher activated successfully for user ${userId}.`);
    const displayPair = toDisplaySymbol(selectedPair);
    const marketSchedule = getMarketSchedule(displayPair);
    let marketNoticeTelegram = "";
    let activationMessage = initialZoneData ? `AI Market Watcher activated! Marked ${initialZoneData.type} [${initialZoneData.low} - ${initialZoneData.high}]. Waiting for price retest.` : "AI Market Watcher activated successfully.";
    if (!marketSchedule.isOpen && marketSchedule.closesOnWeekends) {
      marketNoticeTelegram = `

*Market Notice (Nigeria Time / WAT):*
\u26A0\uFE0F ${displayPair} is currently closed for the weekend (${marketSchedule.reasonWat}). Reopens *${marketSchedule.nextOpenWatFormatted || "Sunday 10:00 PM WAT"}*. Watcher is active and candle downloads will automatically begin once markets reopen.`;
      activationMessage = `AI Market Watcher activated! Note: ${displayPair} is closed for the weekend and reopens ${marketSchedule.nextOpenWatFormatted || "Sunday 10:00 PM WAT"} (Nigeria Time).`;
    } else if (!marketSchedule.closesOnWeekends) {
      marketNoticeTelegram = `

*Market Status:*
\u26A1 ${displayPair} trades 24/7 in Nigeria (WAT). Real-time monitoring and candle scanning are running.`;
    }
    const telegramSuccess = await sendTelegramMessage(
      telegramChatId,
      `\u2705 *Gaks AI Market Watcher Activated*

*Status:* Active \u{1F7E2}
*Pairs Monitored:* ${displayPair}
*Strategy:* ${strategyDetails.name} (${strategyDetails.isDefault ? "Default" : "Custom"})
*Account Size:* $${accountSize || "Not set"}
*Risk:* ${riskPercentage ? riskPercentage + "%" : "Not set"}
*Scan Interval:* Every ${computedInterval} minutes` + initialTrendNotice + marketNoticeTelegram + `

I will now monitor the markets and alert you when price retests your marked zone.`
    );
    return res.json({
      success: true,
      message: activationMessage,
      market_status: {
        is_open: marketSchedule.isOpen,
        closes_on_weekends: marketSchedule.closesOnWeekends,
        next_open_wat: marketSchedule.nextOpenWatFormatted,
        closure_schedule_wat: marketSchedule.closureScheduleWat
      },
      telegram_delivered: telegramSuccess
    });
  } catch (err) {
    console.error("[Watcher Start] Unhandled internal exception:", err);
    console.error("[Watcher Start] Stack Trace:", err.stack);
    if (telegramChatId) {
      try {
        await sendTelegramMessage(telegramChatId, `\u274C *Market Watcher Activation Failed*

Reason: Internal server error during activation: ${err.message || "Unknown error"}`);
      } catch (tgErr) {
        console.error("[Watcher Start] Failed to send error notification to Telegram:", tgErr);
      }
    }
    console.log("[Watcher Activation] FAILED at Catch Block:", {
      reason: err.message || "Internal server error during watcher activation",
      user_id: userId,
      selected_pair: selectedPair,
      selected_timeframe: selectedTimeframe
    });
    return res.status(500).json({
      success: false,
      error: "Internal server error during watcher activation: " + (err.message || "Unknown error"),
      stack: err.stack,
      details: err
    });
  }
}
export {
  handler as default
};
