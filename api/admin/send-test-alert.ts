import { createClient } from '@supabase/supabase-js';

/**
 * Self-contained Supabase client initialization.
 */
const getSupabase = () => {
  const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  
  if (!url || !key) {
    throw new Error('Supabase configuration missing (VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required)');
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
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
      const errText = await response.text();
      console.error(`Telegram API Error: ${response.status} - ${errText}`);
      return false;
    }
    return true;
  } catch (error) {
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

export default async function handler(req: any, res: any) {
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
      .maybeSingle();

    if (watcherError || !watcher || watcher.status !== 'active') {
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
    const telegramDelivered = await sendTelegramMessage(chatId, fakeSignalMessage);

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
