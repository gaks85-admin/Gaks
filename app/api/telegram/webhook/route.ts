import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://wkujrqmxivljnuvumfau.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";

// Initialize Supabase Client (prefers service role bypass if available)
const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || SUPABASE_PUBLIC_KEY;
const supabase = createClient(SUPABASE_URL, supabaseKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

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
 * Next.js POST Webhook Handler for Telegram updates
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    console.log("[Telegram Webhook] Received update payload:", JSON.stringify(body, null, 2));

    const message = body.message;
    if (!message) {
      // Return 200 for other update types (e.g., callback_query) to prevent Telegram from retrying
      return NextResponse.json({ success: true, reason: "No message payload" }, { status: 200 });
    }

    const chatId = message.chat?.id;
    const telegramUserId = message.from?.id;
    const telegramUsername = message.from?.username || null;
    const text = message.text || "";

    if (!chatId) {
      return NextResponse.json({ success: false, error: "Missing chat identifier" }, { status: 400 });
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
        return NextResponse.json({ success: true, reason: "Start command without token" }, { status: 200 });
      }

      console.log(`[Telegram Webhook] Looking up token: ${token} for Chat ID: ${chatId}`);

      // Query database for matching connection token
      const { data: connection, error: selectError } = await supabase
        .from("telegram_connections")
        .select("*")
        .eq("connection_token", token)
        .maybeSingle();

      if (selectError || !connection) {
        console.error(`[Telegram Webhook] Connection token invalid or lookup failed:`, selectError);
        await sendTelegramMessage(
          chatId,
          "❌ *Verification Failed*\n\nThe connection token is invalid or has expired. Please return to the Gaks AI Dashboard, regenerate your link, and try again."
        );
        return NextResponse.json({ success: true, reason: "Invalid token" }, { status: 200 });
      }

      console.log(`[Telegram Webhook] Matching record found for user: ${connection.user_id}. Updating connection status.`);

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
        console.error("[Telegram Webhook] Database update error:", updateError);
        await sendTelegramMessage(
          chatId,
          "❌ *Database Sync Error*\n\nWe encountered an error while saving your profile link. Please try again in a few moments."
        );
        return NextResponse.json({ success: false, error: "Database update failure" }, { status: 500 });
      }

      // Success reply to the user inside Telegram
      const successMessage = `🎉 *Welcome to Gaks AI!*\n\nYour Telegram account has been connected successfully.\n\nFuture AI trading signals and critical market alerts will be delivered directly here!`;
      await sendTelegramMessage(chatId, successMessage);

      console.log(`[Telegram Webhook] Account linked successfully for User ID: ${connection.user_id}`);
    }

    return NextResponse.json({ success: true }, { status: 200 });
  } catch (error: any) {
    console.error("[Telegram Webhook] Unhandled exception:", error);
    return NextResponse.json({ success: false, error: error.message || "Internal server error" }, { status: 500 });
  }
}
