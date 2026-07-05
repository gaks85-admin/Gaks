import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

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

export default async function handler(req: any, res: any) {
  // CORS configuration
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS, PUT, PATCH, DELETE");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'Method Not Allowed' });
  }

  let userId = req.body.userId;
  let selectedPair = req.body.selectedPair;
  let selectedTimeframe = req.body.selectedTimeframe;

  // 1. Verify the user is authenticated (using authorization header)
  const authHeader = req.headers.authorization || '';
  const tokenHeader = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

  if (tokenHeader) {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser(tokenHeader);
      if (authError || !user) {
        console.warn("[Watcher Start] Bearer token auth validation failed:", authError?.message);
      } else {
        userId = user.id;
      }
    } catch (err: any) {
      console.warn("[Watcher Start] Bearer token verification error:", err.message);
    }
  }

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication failed. You must be authenticated to start the AI Market Watcher."
    });
  }
  
  if (!selectedPair) {
    // If it wasn't passed in the request body, try fetching from watchlist
    const { data: watchlist } = await supabase
      .from("watchlist_items")
      .select("symbol")
      .eq("user_id", userId);
    
    if (watchlist && watchlist.length === 1) {
      selectedPair = watchlist[0].symbol;
    } else if (watchlist && watchlist.length > 1) {
      return res.status(400).json({
        success: false,
        error: "Free plan only supports monitoring a single trading pair. Please remove extra pairs from your watchlist."
      });
    } else {
      return res.status(400).json({
        success: false,
        error: "Please select a trading pair to monitor before activating the Market Watcher."
      });
    }
  }

  let telegramChatId: string | null = null;

  try {
    console.log(`[Watcher Start] Verifying requirements for authenticated user: ${userId}`);

    // 2. Retrieve the authenticated user's profile
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .maybeSingle();

    if (profileError) {
      console.warn("[Watcher Start] Profile query warning:", profileError.message);
    }

    // 3. Verify Telegram is connected by checking the telegram_connections table
    const { data: telegramConn, error: telegramError } = await supabase
      .from("telegram_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (telegramError) {
      console.warn("[Watcher Start] Telegram connection lookup error:", telegramError.message);
    }

    telegramChatId = telegramConn?.telegram_chat_id || null;

    if (!telegramConn || !telegramConn.connected || !telegramChatId) {
      return res.status(400).json({
        success: false,
        error: "Telegram is not connected. Please connect your Telegram account first under Gaks AI Settings."
      });
    }

    // 4. Verify the user has saved a Gemini API key
    const { data: apiKeyRecord, error: apiKeyError } = await supabase
      .from("user_api_keys")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "gemini")
      .maybeSingle();

    if (apiKeyError) {
      console.warn("[Watcher Start] API Key query error:", apiKeyError.message);
    }

    if (!apiKeyRecord || !apiKeyRecord.api_key) {
      await sendTelegramMessage(telegramChatId, "❌ *Market Watcher Activation Failed*\n\nReason: Gemini API key is missing. Please save a valid Gemini API key under AI Settings before activating.");
      return res.status(400).json({
        success: false,
        error: "Gemini API key is missing. Please save a valid Gemini API key under AI Settings before activating."
      });
    }

    // 5 & 6. Verify Strategy Playbook and Risk settings exist
    const { data: prefsRecord, error: prefsError } = await supabase
      .from("trading_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (prefsError) {
      console.warn("[Watcher Start] Trading preferences query error:", prefsError.message);
    }

    const defaultTemplate = `• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules`;
    const strategyText = prefsRecord?.strategy_text || '';

    if (!strategyText.trim() || strategyText.trim() === defaultTemplate.trim()) {
      await sendTelegramMessage(telegramChatId, "❌ *Market Watcher Activation Failed*\n\nReason: Trading Strategy playbook is empty or not configured. Please write your custom strategy details under the Strategy Playbook section first.");
      return res.status(400).json({
        success: false,
        error: "Trading Strategy playbook is empty or not configured. Please write your custom strategy details under the Strategy Playbook section first."
      });
    }

    const preferredRisk = prefsRecord?.preferred_risk || '';
    const riskReward = prefsRecord?.risk_reward || '';

    if (!preferredRisk.trim() || !riskReward.trim()) {
      await sendTelegramMessage(telegramChatId, "❌ *Market Watcher Activation Failed*\n\nReason: Risk settings are incomplete. Please define and save your Preferred Risk and Risk:Reward Ratio under the Risk & Sizing section first.");
      return res.status(400).json({
        success: false,
        error: "Risk settings are incomplete. Please define and save your Preferred Risk and Risk:Reward Ratio under the Risk & Sizing section first."
      });
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
        const mapped = sym.toUpperCase().trim().replace('/', '');
        
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
          return res.status(400).json({
            success: false,
            error: `TwelveData HTTP Error: 404. Symbol "${selectedPair}" is not recognized or not supported by Twelve Data. Please try another symbol.`
          });
        } else if (quoteRes.ok) {
          const quoteData = await quoteRes.json();
          if (quoteData.status === "error") {
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

    // Upsert into watchers table
    const { error: watchersError } = await supabase
      .from("watchers")
      .upsert({
        user_id: userId,
        status: "active",
        started_at: nowString,
        telegram_chat_id: telegramChatId,
        account_size: accountSize,
        risk_percentage: riskPercentage,
        selected_pair: selectedPair,
        selected_timeframe: selectedTimeframe || 'H1',
        gemini_model: "gemini-2.5-flash",
        scan_interval_minutes: scanInterval,
        updated_at: nowString
      }, { onConflict: "user_id" });

    if (watchersError) {
      console.error("[Watcher Start] Failed to write to watchers table:", watchersError.message);
      await sendTelegramMessage(telegramChatId, `❌ *Market Watcher Activation Failed*\n\nReason: Failed to write watcher state to DB: ${watchersError.message}`);
      return res.status(500).json({
        success: false,
        error: "Failed to write watcher state to DB: " + watchersError.message
      });
    }

    // Upsert into legacy market_watchers table for interface backwards-compatibility
    try {
      await supabase
        .from("market_watchers")
        .upsert({
          user_id: userId,
          status: "active",
          activated_at: nowString,
          updated_at: nowString
        }, { onConflict: "user_id" });
    } catch (err: any) {
      console.warn("[Watcher Start] Legacy market_watchers table sync error:", err.message);
    }

    console.log(`[Watcher Start] AI Market Watcher activated successfully for user ${userId}.`);

    const telegramSuccess = await sendTelegramMessage(telegramChatId, `✅ *Gaks AI Market Watcher Activated*\n\n` +
      `*Status:* Active 🟢\n` +
      `*Pairs Monitored:* ${pairsMonitored}\n` +
      `*Strategy:* Custom Playbook\n` +
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
    if (telegramChatId) {
      await sendTelegramMessage(telegramChatId, `❌ *Market Watcher Activation Failed*\n\nReason: Internal server error during activation.`);
    }
    return res.status(500).json({
      success: false,
      error: "Internal server error during watcher activation: " + (err.message || "Unknown error")
    });
  }
}
