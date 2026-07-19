import type { VercelRequest, VercelResponse } from '@vercel/node';
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

/**
 * Sends a Markdown message back to the user via Telegram Bot API
 */
async function sendTelegramMessage(chatId: string | number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    console.warn("TELEGRAM_BOT_TOKEN is not defined in environment variables.");
    return;
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
    }
  } catch (err) {
    console.error("Error sending Telegram message:", err);
  }
}

/**
 * Vercel Serverless Function Handler for /api/telegram/webhook
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  const supabase = getSupabase();
  // CORS Configuration
  const origin = req.headers.origin;
  const allowedOrigins = [
    "https://gaks-ai.vercel.app",
    "http://localhost:5173",
    "http://localhost:3000"
  ];

  if (origin && (allowedOrigins.includes(origin) || origin.endsWith(".vercel.app") || origin.endsWith(".run.app"))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
  } else {
    res.setHeader("Access-Control-Allow-Origin", "https://gaks-ai.vercel.app");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
  res.setHeader("Access-Control-Allow-Credentials", "true");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  // GET Handler: Health / Verification checks
  if (req.method === "GET") {
    return res.status(200).json({
      status: "operational",
      service: "Gaks AI Telegram Webhook Vercel API",
      message: "Telegram Webhook endpoint is active and listening for POST requests.",
      timestamp: new Date().toISOString()
    });
  }

  // POST Handler: Webhook core messaging update logic
  if (req.method === "POST") {
    try {
      const body = req.body;
      console.log("[Telegram Webhook Vercel] Received update payload:", JSON.stringify(body, null, 2));

      const message = body.message;
      if (!message) {
        // Return 200 for other update types (e.g., callback_query) to prevent Telegram from retrying
        return res.status(200).json({ success: true, reason: "No message payload" });
      }

      const chatId = message.chat?.id;
      const telegramUserId = message.from?.id;
      const telegramUsername = message.from?.username || null;
      const text = message.text || "";

      if (!chatId) {
        return res.status(400).json({ success: false, error: "Missing chat identifier" });
      }

      // Process deep linking parameter: /start <connection_token>
      if (text.startsWith("/start")) {
        const parts = text.split(" ");
        const token = parts[1]?.trim();

        if (!token) {
          await sendTelegramMessage(
            chatId,
            "❌ *Gaks AI Verification Required*\n\nPlease use the *Connect Telegram* button from your Gaks AI Settings dashboard to link this account."
          );
          return res.status(200).json({ success: true, reason: "Start command without token" });
        }

        console.log(`[Telegram Webhook Vercel] Looking up token: ${token} for Chat ID: ${chatId}`);

        // Query database for matching connection token
        const { data: connection, error: selectError } = await supabase
          .from("telegram_connections")
          .select("*")
          .eq("connection_token", token)
          .maybeSingle();

        if (selectError || !connection) {
          console.error(`[Telegram Webhook Vercel] Connection token invalid or lookup failed:`, selectError);
          await sendTelegramMessage(
            chatId,
            "❌ *Verification Failed*\n\nThe connection token is invalid or has expired. Please return to the Gaks AI Dashboard, regenerate your link, and try again."
          );
          return res.status(200).json({ success: true, reason: "Invalid token" });
        }

        console.log(`[Telegram Webhook Vercel] Matching record found for user: ${connection.user_id}. Checking connection status.`);

        // Idempotency: check if already connected
        if (connection.connected && connection.telegram_chat_id === String(chatId)) {
          const alreadyConnectedMessage = `🎉 *Welcome to Gaks AI!*\n\nYour Telegram account has been connected successfully.\n\nFuture AI trading signals will be delivered here.\n\nYou can now activate the AI Market Watcher from your dashboard.`;
          await sendTelegramMessage(chatId, alreadyConnectedMessage);
          return res.status(200).json({ success: true, reason: "Already connected" });
        }

        // Update the database record as connected
        const { error: updateError } = await supabase
          .from("telegram_connections")
          .update({
            telegram_chat_id: String(chatId),
            telegram_user_id: String(telegramUserId),
            telegram_username: telegramUsername,
            connected: true,
            connected_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("connection_token", token);

        if (updateError) {
          console.error("[Telegram Webhook Vercel] Database update error:", updateError);
          await sendTelegramMessage(
            chatId,
            "❌ *Database Sync Error*\n\nWe encountered an error while saving your profile link. Please try again in a few moments."
          );
          return res.status(500).json({ success: false, error: "Database update failure" });
        }

        // Success reply to the user inside Telegram (exact format requested)
        const successMessage = `🎉 *Welcome to Gaks AI!*\n\nYour Telegram account has been connected successfully.\n\nFuture AI trading signals will be delivered here.\n\nYou can now activate the AI Market Watcher from your dashboard.`;
        await sendTelegramMessage(chatId, successMessage);

        console.log(`[Telegram Webhook Vercel] Account linked successfully for User ID: ${connection.user_id}`);
      }

      return res.status(200).json({ success: true });
    } catch (error: any) {
      console.error("[Telegram Webhook Vercel] Unhandled exception:", error);
      return res.status(500).json({ success: false, error: error.message || "Internal server error" });
    }
  }

  return res.status(405).json({ error: "Method not allowed" });
}
