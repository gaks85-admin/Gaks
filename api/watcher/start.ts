import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

/**
 * Self-contained Supabase client initialization.
 * Uses environment variables for URL and Service Role Key (or Anon Key as fallback).
 */
const getSupabase = (token?: string) => {
  const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";
  
  if (!url || !key) {
    throw new Error('Supabase configuration missing (VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required)');
  }

  const headers: Record<string, string> = {};
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
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

async function sendTelegramMessage(chatId: string | number, text: string): Promise<boolean> {
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

function extractActiveStrategyDetails(strategyText: string) {
  const DEFAULT_STRATEGY_NAME = 'Gaks AI Default Strategy';
  const DEFAULT_STRATEGY_UUID = '00000000-0000-0000-0000-000000000000';
  const LEGACY_CUSTOM_STRATEGY_UUID = '11111111-1111-1111-1111-111111111111';

  if (!strategyText || !strategyText.trim()) {
    return { id: DEFAULT_STRATEGY_UUID, name: DEFAULT_STRATEGY_NAME, text: DEFAULT_STRATEGY_TEXT, isDefault: true };
  }
  const defaultTemplate = `• Entry conditions
• Confirmation indicators
• Exit & stop-loss logic
• Risk management rules`;
  if (strategyText.trim() === defaultTemplate.trim()) {
    return { id: DEFAULT_STRATEGY_UUID, name: DEFAULT_STRATEGY_NAME, text: DEFAULT_STRATEGY_TEXT, isDefault: true };
  }

  try {
    const parsed = JSON.parse(strategyText);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.strategies)) {
      const active = parsed.strategies.find((s: any) => {
        if (parsed.activeId === 'default' || parsed.activeId === DEFAULT_STRATEGY_UUID) {
          return s.id === 'default' || s.id === DEFAULT_STRATEGY_UUID || s.isDefault;
        }
        return s.id === parsed.activeId;
      }) || parsed.strategies[0];

      let finalId = active ? active.id : DEFAULT_STRATEGY_UUID;
      if (finalId === 'default') {
        finalId = DEFAULT_STRATEGY_UUID;
      } else if (finalId === '11111111-1111-1111-1111-111111111111') {
        finalId = LEGACY_CUSTOM_STRATEGY_UUID;
      }

      return {
        id: finalId,
        name: active ? (active.name || DEFAULT_STRATEGY_NAME) : DEFAULT_STRATEGY_NAME,
        text: active ? (active.text || DEFAULT_STRATEGY_TEXT) : DEFAULT_STRATEGY_TEXT,
        isDefault: active ? !!active.isDefault : true
      };
    }
  } catch (e) {
    // Not JSON, return legacy custom
  }
  return { id: LEGACY_CUSTOM_STRATEGY_UUID, name: 'Legacy Custom Strategy', text: strategyText, isDefault: false };
}

export default async function handler(req: any, res: any) {
  let supabase = getSupabase();
  // CORS configuration
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  let userId = req.body?.userId;
  let selectedPair = req.body?.selectedPair;
  let selectedTimeframe = req.body?.selectedTimeframe;

  if (req.method !== 'POST') {
    console.log("[Watcher Activation] FAILED at Step 0:", {
      step: 0,
      reason: 'Method Not Allowed',
      user_id: userId,
      selected_pair: selectedPair,
      selected_timeframe: selectedTimeframe
    });
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  // 1. Verify the user is authenticated (using authorization header)
  const authHeader = req.headers.authorization || '';
  const tokenHeader = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

  if (tokenHeader) {
    try {
      console.log("[Watcher Start] Validating auth token...");
      const { data: { user }, error: authError } = await supabase.auth.getUser(tokenHeader);
      if (authError || !user) {
        console.warn("[Watcher Start] Bearer token auth validation failed:", authError?.message);
      } else {
        console.log("[Watcher Start] Auth success. User ID:", user.id);
        userId = user.id;
        // Re-initialize supabase client with user's token to query context-appropriately and bypass RLS constraints
        supabase = getSupabase(tokenHeader);
      }
    } catch (err: any) {
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

  // Validate if symbol is supported before proceeding
  const isSupportedSymbol = (sym: string): boolean => {
    if (!sym) return false;
    const normalized = sym.toUpperCase().trim().replace(/[-_\s/]/g, "");
    const supported = [
      'EURUSD', 'GBPUSD', 'XAUUSD', 'BTCUSD', 'NAS100', 'US30', 'SPX500', 'US500',
      'EUR/USD', 'GBP/USD', 'XAU/USD', 'BTC/USD', 'QQQ', 'DIA', 'SPY'
    ].map(s => s.toUpperCase().trim().replace(/[-_\s/]/g, ""));
    return supported.includes(normalized);
  };

  if (!isSupportedSymbol(selectedPair)) {
    console.log("[Watcher Activation] FAILED at Step 3:", {
      step: 3,
      reason: `Symbol "${selectedPair}" is not supported.`,
      user_id: userId,
      selected_pair: selectedPair,
      selected_timeframe: selectedTimeframe
    });
    return res.status(400).json({
      success: false,
      error: `Symbol "${selectedPair}" is not supported. Please choose one of our supported pairs: EURUSD, GBPUSD, XAUUSD, BTCUSD, NAS100, US30.`
    });
  }

  let telegramChatId: string | null = null;

  try {
    console.log(`[Watcher Start] Verifying requirements for authenticated user: ${userId}`);

    // 2. Retrieve the authenticated user's profile
    console.log("[Watcher Start] Fetching user profile...");
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.warn("[Watcher Start] Profile query warning:", profileError.message);
    }
    console.log("[Watcher Start] Profile result:", JSON.stringify(profile, null, 2));

    // 3. Verify Telegram is connected by checking the telegram_connections table
    console.log("[Watcher Start] Checking telegram connection...");
    let { data: telegramConn, error: telegramError } = await supabase
      .from("telegram_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (!telegramConn) {
      console.log("[Watcher Start] No telegram connection found. Auto-creating row...");
      const { data: newConn, error: insertError } = await supabase
        .from("telegram_connections")
        .insert({ user_id: userId, connected: false, connection_token: randomUUID(), created_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .select()
        .single();
      
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

    // 4. Verify the user has saved a Gemini API key
    const tableName = 'user_api_keys';
    const providerFilter = 'gemini';

    console.log(`[Gemini API Key Lookup Audit] Executing lookup in watcher start:`);
    console.log(`- Table Name: ${tableName}`);
    console.log(`- user_id: ${userId}`);
    console.log(`- provider: ${providerFilter}`);
    console.log(`- Supabase JS Query: supabase.from('${tableName}').select('api_key, id').eq('user_id', '${userId}').eq('provider', '${providerFilter}').maybeSingle()`);

    // 1. Attempt the query for Gemini API key
    console.log("[Watcher] Logged in user:", userId);
    console.log("[Watcher] userId:", userId);
    console.log("[Watcher] selectedPair:", selectedPair);
    console.log("[Watcher] selectedTimeframe:", selectedTimeframe);

    const { data: apiKeyRecord, error: apiKeyError } = await supabase
      .from(tableName)
      .select("api_key, id")
      .eq("user_id", userId)
      .eq("provider", providerFilter)
      .maybeSingle();

    console.log("[Watcher] apiKeyError:", apiKeyError);
    console.log("[Watcher] apiKeyRecord:", apiKeyRecord);

    const { data: allKeys } = await supabase
      .from("user_api_keys")
      .select("*");
    console.log("[ALL USER API KEYS]", allKeys);

    if (apiKeyError || !apiKeyRecord || !apiKeyRecord.api_key) {
      const errReason = apiKeyError 
        ? `Supabase query error: ${apiKeyError.message}` 
        : `No row exists or api_key is missing in '${tableName}' for user_id='${userId}' and provider='${providerFilter}'.`;

      console.log(`[Gemini API Key Lookup Audit] LOG EXACT WHY: ${errReason}`);
      console.log("[Watcher Start] Termination: Gemini API key lookup failed or key missing.");

      const failedStepLog = {
        step: 5,
        reason: errReason,
        apiKeyError: apiKeyError || null,
        apiKeyRecord: apiKeyRecord || null,
        user_id: userId,
        selected_pair: selectedPair,
        selected_timeframe: selectedTimeframe
      };

      console.log("[Watcher Activation] FAILED at Step 5:", failedStepLog);

      await sendTelegramMessage(
        telegramChatId, 
        `❌ *Market Watcher Activation Failed*\n\nStep 5 Error: ${errReason}\napiKeyError: ${JSON.stringify(apiKeyError)}\napiKeyRecord: ${JSON.stringify(apiKeyRecord)}`
      );

      return res.status(400).json({
        success: false,
        error: errReason,
        step: 5,
        failedAtStep: "Step 5",
        apiKeyError: apiKeyError || null,
        apiKeyRecord: apiKeyRecord || null,
        user_id: userId,
        selected_pair: selectedPair,
        selected_timeframe: selectedTimeframe
      });
    }

    console.log(`[Gemini API Key Lookup Audit] Success: API key successfully retrieved for user_id='${userId}'.`);

    // 5 & 6. Verify Strategy Playbook and Risk settings exist
    console.log("[Watcher Start] Fetching trading preferences...");
    const { data: prefsRecord, error: prefsError } = await supabase
      .from("trading_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (prefsError) {
      console.warn("[Watcher Start] Trading preferences query error:", prefsError.message);
    }
    console.log("[Watcher Start] Trading preferences result:", JSON.stringify(prefsRecord, null, 2));

    const strategyDetails = extractActiveStrategyDetails(prefsRecord?.strategy_text || '');
    const activeStrategyText = strategyDetails.text;
    console.log("[Watcher Start] Strategy extracted:", strategyDetails.name, "ID:", strategyDetails.id);

    if (!activeStrategyText.trim()) {
      console.log("[Watcher Start] Termination: Strategy text is empty.");
      await sendTelegramMessage(telegramChatId, "❌ *Market Watcher Activation Failed*\n\nReason: Active trading strategy is empty. Please configure your strategy first.");
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

    const preferredRisk = prefsRecord?.preferred_risk || '';
    const riskReward = prefsRecord?.risk_reward || '';

    if (!preferredRisk.trim() || !riskReward.trim()) {
      console.log("[Watcher Start] Termination: Risk settings incomplete.");
      await sendTelegramMessage(telegramChatId, "❌ *Market Watcher Activation Failed*\n\nReason: Risk settings are incomplete. Please define and save your Preferred Risk and Risk:Reward Ratio under the Risk & Sizing section first.");
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

    // Limit standard users to only one active watcher, while allowing unlimited active watchers for admins.
    const userRole = (profile?.role === 'admin' || profile?.email?.trim().toLowerCase() === 'gaks6535@gmail.com') ? 'admin' : 'user';

    console.log("[Watcher Start] Checking existing active watchers...");
    const { data: existingActiveWatchers, error: watchersFetchError } = await supabase
      .from("watchers")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active");

    if (watchersFetchError) {
      console.error("[Watcher Start] Error fetching existing watchers:", watchersFetchError.message);
    }
    console.log("[Watcher Start] Active watchers found:", existingActiveWatchers?.length || 0);

    if (userRole === 'user' && existingActiveWatchers && existingActiveWatchers.length > 0) {
      const hasDifferentActive = existingActiveWatchers.some(w => w.selected_pair !== selectedPair);
      if (hasDifferentActive) {
        await sendTelegramMessage(telegramChatId, "❌ *Market Watcher Activation Failed*\n\nReason: You can monitor only one trading pair at a time.");
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
    
    // Fetch user's watchlist to include in the Telegram message
    // (Deprecated: Now we just use selectedPair)
    const pairsMonitored = selectedPair;

    // Validate Symbol with Twelve Data before activating
    const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
    if (!twelveDataKey) {
      console.warn("[Watcher Start] Missing TWELVE_DATA_API_KEY. Skipping Twelve Data symbol validation.");
    } else {
      const convertSymbol = (sym: string): string => {
        if (!sym) return sym;
        const mapped = sym.toUpperCase().trim().replace(/[-_\s/]/g, '');
        
        // Symbol mapping layer for Twelve Data compatibility on free plans
        const mappings: Record<string, string> = {
          'EURUSD': 'EUR/USD',
          'GBPUSD': 'GBP/USD',
          'XAUUSD': 'XAU/USD',
          'BTCUSD': 'BTC/USD',
          'NAS100': 'QQQ',
          'US30': 'DIA',
          'SPX500': 'SPY',
          'US500': 'SPY'
        };

        if (mappings[mapped]) {
          return mappings[mapped];
        }

        const commonCryptoCoins = ["BTC", "ETH", "SOL", "XRP", "ADA", "DOGE", "AVAX", "DOT", "LINK", "MATIC"];
        const commonCryptoQuote = ["USD", "USDT", "BTC", "ETH", "EUR", "GBP", "FDUSD", "USDC"];
        
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
        
        if (mapped.endsWith('USD') && mapped.length > 3) return mapped.slice(0, -3) + '/USD';
        if (mapped.endsWith('JPY') && mapped.length > 3) return mapped.slice(0, -3) + '/JPY';
        if (mapped.endsWith('EUR') && mapped.length > 3) return mapped.slice(0, -3) + '/EUR';
        if (mapped.endsWith('GBP') && mapped.length > 3) return mapped.slice(0, -3) + '/GBP';
        return mapped;
      };

      const mappedSymbol = convertSymbol(selectedPair);
      console.log(`[Watcher Start] Validating symbol "${mappedSymbol}" (converted from "${selectedPair}") against Twelve Data API...`);
      
      try {
        const searchUrl = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(mappedSymbol)}&apikey=${twelveDataKey}`;
        const searchRes = await fetch(searchUrl);
        if (searchRes.ok) {
          const searchData = await searchRes.json();
          if (searchData.status === "error") {
            console.warn(`[Watcher Start] Symbol search API returned error: ${searchData.message}`);
          } else if (searchData.data && Array.isArray(searchData.data)) {
            const symbolUpper = mappedSymbol.toUpperCase().replace('/', '');
            const hasMatch = searchData.data.some((item: any) => 
              item.symbol.toUpperCase().replace('/', '') === symbolUpper
            );
            if (!hasMatch && searchData.data.length === 0) {
              console.log("[Watcher Activation] FAILED at Step 9:", {
                step: 9,
                reason: `TwelveData HTTP Error: 404. The symbol "${selectedPair}" was not found or is invalid on Twelve Data.`,
                user_id: userId,
                selected_pair: selectedPair,
                selected_timeframe: selectedTimeframe
              });
              return res.status(400).json({
                success: false,
                error: `TwelveData HTTP Error: 404. The symbol "${selectedPair}" was not found or is invalid on Twelve Data. Please use standard tickers like EURUSD, BTCUSD, AAPL.`
              });
            }
          }
        }
        
        // Also perform a lightweight quote validation to be absolutely sure the symbol works
        const quoteUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(mappedSymbol)}&apikey=${twelveDataKey}`;
        const quoteRes = await fetch(quoteUrl);
        if (quoteRes.status === 404) {
          console.log("[Watcher Activation] FAILED at Step 10:", {
            step: 10,
            reason: `TwelveData HTTP Error: 404. Symbol "${selectedPair}" is not recognized or not supported by Twelve Data.`,
            user_id: userId,
            selected_pair: selectedPair,
            selected_timeframe: selectedTimeframe
          });
          return res.status(400).json({
            success: false,
            error: `TwelveData HTTP Error: 404. Symbol "${selectedPair}" is not recognized or not supported by Twelve Data. Please try another symbol.`
          });
        } else if (quoteRes.ok) {
          const quoteData = await quoteRes.json();
          if (quoteData.status === "error") {
            console.log("[Watcher Activation] FAILED at Step 11:", {
              step: 11,
              reason: `TwelveData Error: ${quoteData.message || "Invalid symbol on Twelve Data."}`,
              user_id: userId,
              selected_pair: selectedPair,
              selected_timeframe: selectedTimeframe
            });
            return res.status(400).json({
              success: false,
              error: `TwelveData Error: ${quoteData.message || "Invalid symbol on Twelve Data."}`
            });
          }
        }
      } catch (validationErr: any) {
        console.warn("[Watcher Start] Warning during Twelve Data symbol validation check:", validationErr.message || validationErr);
        // Continue anyway if it's a transient network/fetch error to avoid blocking the user
      }
    }

    // 8. Requirements met! Create or update the user's watcher record
    const nowString = new Date().toISOString();
    
    // Parse capital size and risk percentage for structured watchers columns
    let accountSize: number | null = null;
    if (prefsRecord) {
      const cap = prefsRecord.custom_capital || prefsRecord.capital || "";
      const cleanedCap = cap.replace(/[^0-9.]/g, "");
      if (cleanedCap) {
        accountSize = parseFloat(cleanedCap);
      }
    }

    let riskPercentage: number | null = null;
    if (prefsRecord && prefsRecord.preferred_risk) {
      const cleanedRisk = prefsRecord.preferred_risk.replace(/[^0-9.]/g, "");
      if (cleanedRisk) {
        riskPercentage = parseFloat(cleanedRisk);
      }
    }

    const scanInterval = 5;

    // Ensure the strategy exists in public.strategies table to satisfy foreign key constraint
    console.log("[Watcher Start] Upserting strategy...");
    const { error: stratError } = await supabase
      .from("strategies")
      .upsert({
        id: strategyDetails.id,
        user_id: strategyDetails.isDefault ? null : userId,
        name: strategyDetails.name,
        text: strategyDetails.text,
        is_default: strategyDetails.isDefault,
        updated_at: nowString
      });

    if (stratError) {
      console.warn("[Watcher Start] Warning upserting into strategies table:", stratError.message);
    } else {
      console.log("[Watcher Start] Strategy upsert successful.");
    }

    // Upsert the watcher record for this pair
    console.log("[Watcher Start] Upserting watcher record...");
    const watcherData = {
      user_id: userId,
      status: "active",
      strategy_id: strategyDetails.id,
      started_at: nowString,
      telegram_chat_id: telegramChatId,
      account_size: accountSize,
      risk_percentage: riskPercentage,
      selected_pair: selectedPair,
      selected_timeframe: selectedTimeframe || 'H1',
      gemini_model: "gemini-1.5-flash",
      scan_interval_minutes: scanInterval,
      updated_at: nowString
    };
    console.log("[Watcher Start] Watcher data payload:", JSON.stringify(watcherData, null, 2));

    console.log("[Watcher Activation] Reached UPSERT");
    const { error: watchersError } = await supabase
      .from("watchers")
      .upsert(watcherData, { onConflict: "user_id,selected_pair" });

    if (watchersError) {
      console.error("[Watcher Start] Failed to write to watchers table:", watchersError.message);
      await sendTelegramMessage(telegramChatId, `❌ *Market Watcher Activation Failed*\n\nReason: Failed to write watcher state to DB: ${watchersError.message}`);
      console.log("[Watcher Activation] FAILED at Step 12:", {
        step: 12,
        reason: "Failed to write watcher state to DB: " + watchersError.message,
        user_id: userId,
        selected_pair: selectedPair,
        selected_timeframe: selectedTimeframe
      });
      return res.status(500).json({
        success: false,
        error: "Failed to write watcher state to DB: " + watchersError.message,
        details: watchersError
      });
    }
    console.log("[Watcher Start] Watcher upsert successful.");
    console.log("[Watcher Activation] Watcher created successfully");

    // Upsert into legacy market_watchers table for interface backwards-compatibility
    try {
      console.log("[Watcher Start] Upserting legacy market_watcher...");
      const { error: legacyError } = await supabase
        .from("market_watchers")
        .upsert({
          user_id: userId,
          status: "active",
          activated_at: nowString,
          updated_at: nowString
        }, { onConflict: "user_id" });
      
      if (legacyError) {
        console.warn("[Watcher Start] Legacy market_watchers table sync error:", legacyError.message);
      } else {
        console.log("[Watcher Start] Legacy market_watcher upsert successful.");
      }
    } catch (err: any) {
      console.warn("[Watcher Start] Legacy market_watchers table sync exception:", err.message);
    }

    console.log(`[Watcher Start] AI Market Watcher activated successfully for user ${userId}.`);

    const telegramSuccess = await sendTelegramMessage(telegramChatId, `✅ *Gaks AI Market Watcher Activated*\n\n` +
      `*Status:* Active 🟢\n` +
      `*Pairs Monitored:* ${pairsMonitored}\n` +
      `*Strategy:* ${strategyDetails.name} (${strategyDetails.isDefault ? 'Default' : 'Custom'})\n` +
      `*Account Size:* $${accountSize || 'Not set'}\n` +
      `*Risk:* ${riskPercentage ? riskPercentage + '%' : 'Not set'}\n` +
      `*Scan Interval:* Every ${scanInterval} minutes\n\n` +
      `I will now monitor the markets and alert you of any high-probability setups matching your strategy.`
    );

    return res.json({
      success: true,
      message: "AI Market Watcher activated successfully.",
      telegram_delivered: telegramSuccess
    });

  } catch (err: any) {
    console.error("[Watcher Start] Unhandled internal exception:", err);
    console.error("[Watcher Start] Stack Trace:", err.stack);
    if (telegramChatId) {
      try {
        await sendTelegramMessage(telegramChatId, `❌ *Market Watcher Activation Failed*\n\nReason: Internal server error during activation: ${err.message || "Unknown error"}`);
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
