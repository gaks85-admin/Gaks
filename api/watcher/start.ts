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
    const { data: watchlist, error: watchlistError } = await supabase
      .from("watchlist_items")
      .select("symbol")
      .eq("user_id", userId);
      
    if (watchlistError) {
      console.warn("[Watcher Start] Watchlist query error:", watchlistError.message);
    }
    const pairsMonitored = (watchlist && watchlist.length > 0) 
      ? watchlist.map(w => w.symbol).join(", ") 
      : "None";

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
