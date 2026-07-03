import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"
import { GoogleGenAI, Type } from "npm:@google/genai"

serve(async (req) => {
  // 1. Verify Authorization Header (Supabase recommended auth)
  const authHeader = req.headers.get('Authorization')
  const expectedAuth = `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY')}`
  
  if (authHeader !== expectedAuth) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 })
  }

  try {
    console.log("[Market Watcher Edge] Starting autonomous scan cycle...");

    // 2. Initialize Supabase Client with Service Role
    const supabaseUrl = Deno.env.get('SUPABASE_URL') || Deno.env.get('SUPABASE_DB_URL')
    const supabaseServiceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || Deno.env.get('SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceRoleKey) {
      throw new Error("Missing Supabase environment variables (URL or Service Role Key).");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })

    const twelveDataKey = Deno.env.get('TWELVE_DATA_API_KEY')
    if (!twelveDataKey) {
      throw new Error("TWELVE_DATA_API_KEY is missing in Edge Function secrets.");
    }

    const telegramBotToken = Deno.env.get('TELEGRAM_BOT_TOKEN')
    if (!telegramBotToken) {
      throw new Error("TELEGRAM_BOT_TOKEN is missing in Edge Function secrets.");
    }

    // Helper to send Telegram messages
    async function sendTelegramMessage(chatId: string, text: string) {
      const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage`
      try {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
        })
        if (!response.ok) {
          console.error(`Telegram send failed: HTTP ${response.status}`, await response.text())
        }
      } catch (err) {
        console.error("Error sending Telegram message:", err)
      }
    }

    // 3. Load active watchers from the database
    const { data: watchers, error: watchersError } = await supabase
      .from("watchers")
      .select("*")
      .eq("status", "active")

    if (watchersError) throw watchersError

    if (!watchers || watchers.length === 0) {
      console.log("[Market Watcher Edge] No active watchers found.")
      return new Response(JSON.stringify({ success: true, message: "No active watchers." }), {
        headers: { "Content-Type": "application/json" },
      })
    }

    const results = []

    // 4. Process each active watcher
    for (const watcher of watchers) {
      const userId = watcher.user_id
      const selectedPair = watcher.selected_pair
      const selectedTimeframe = watcher.selected_timeframe || 'H1'

      if (!selectedPair) continue;

      try {
        // Check Telegram connection
        const { data: telegramConn } = await supabase
          .from("telegram_connections")
          .select("telegram_chat_id, connected")
          .eq("user_id", userId)
          .maybeSingle()

        if (!telegramConn || !telegramConn.connected || !telegramConn.telegram_chat_id) {
          console.log(`[User ${userId}] Telegram not connected. Skipping.`);
          continue;
        }

        const telegramChatId = telegramConn.telegram_chat_id;

        // Fetch Trading Preferences & Gemini API Key in parallel
        const [{ data: prefsRecord }, { data: apiKeyRecord }] = await Promise.all([
          supabase.from("trading_preferences").select("*").eq("user_id", userId).maybeSingle(),
          supabase.from("user_api_keys").select("*").eq("user_id", userId).eq("provider", "gemini").maybeSingle()
        ]);

        const strategyText = watcher.strategy_id 
          ? `Active Custom Strategy ID: ${watcher.strategy_id}`
          : (prefsRecord?.strategy_text || "");

        if (!strategyText.trim()) {
          console.log(`[User ${userId}] Strategy text empty. Skipping.`);
          continue;
        }

        const accountSize = watcher.account_size || (prefsRecord?.capital ? parseFloat(prefsRecord.capital.replace(/[^0-9.]/g, "")) : null);
        const riskPercentage = watcher.risk_percentage || (prefsRecord?.preferred_risk ? parseFloat(prefsRecord.preferred_risk.replace(/[^0-9.]/g, "")) : null);

        if (!accountSize || !riskPercentage) {
          console.log(`[User ${userId}] Account size or risk percentage not defined. Skipping.`);
          continue;
        }

        if (!apiKeyRecord || !apiKeyRecord.api_key) {
          console.log(`[User ${userId}] Gemini API Key missing. Skipping.`);
          continue;
        }

        // Fetch live market data from Twelve Data
        const symbol = selectedPair;
        const url = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(symbol)}&apikey=${twelveDataKey}`
        const tdRes = await fetch(url)
        
        if (!tdRes.ok) throw new Error(`TwelveData HTTP Error: ${tdRes.status}`);
        
        const quoteData = await tdRes.json();
        if (quoteData.status === "error") throw new Error(`TwelveData Error: ${quoteData.message}`);

        const currentPrice = parseFloat(quoteData.close || quoteData.price || "0");
        const marketData = {
          current_price: currentPrice,
          open: parseFloat(quoteData.open || "0"),
          high: parseFloat(quoteData.high || "0"),
          low: parseFloat(quoteData.low || "0"),
          close: parseFloat(quoteData.close || "0"),
          bid: quoteData.bid ? parseFloat(quoteData.bid) : currentPrice * 0.9999,
          ask: quoteData.ask ? parseFloat(quoteData.ask) : currentPrice * 1.0001,
          volume: quoteData.volume ? parseFloat(quoteData.volume) : 0,
          timestamp: quoteData.timestamp || Math.floor(Date.now() / 1000),
          timeframe: selectedTimeframe
        };

        // Analyze market data with Gemini
        const ai = new GoogleGenAI({ apiKey: apiKeyRecord.api_key })
        
        const promptText = `
You are an expert AI trading assistant.
Analyze the following live market data against the user's trading strategy.
Return a structured JSON list of trading signals. Only generate a signal if the setup strongly matches the strategy.
If no valid setups are found, return an empty array for signals.

User's Trading Strategy:
${strategyText}

Account Size: $${accountSize}
Risk Percentage per trade: ${riskPercentage}%
Timeframe: ${selectedTimeframe}

Live Market Data (Twelve Data):
${JSON.stringify(marketData, null, 2)}
`;

        const aiResponse = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: promptText,
          config: {
            responseMimeType: "application/json",
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                signals: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    properties: {
                      pair: { type: Type.STRING },
                      direction: { type: Type.STRING },
                      entryPrice: { type: Type.NUMBER },
                      stopLoss: { type: Type.NUMBER },
                      takeProfit: { type: Type.NUMBER },
                      riskRewardRatio: { type: Type.STRING },
                      confidenceScore: { type: Type.NUMBER },
                      aiReasoning: { type: Type.STRING }
                    },
                    required: ["pair", "direction", "entryPrice", "stopLoss", "takeProfit", "riskRewardRatio", "confidenceScore", "aiReasoning"]
                  }
                }
              },
              required: ["signals"]
            }
          }
        });

        const parsedResult = JSON.parse(aiResponse.text || '{"signals": []}');
        const signals = parsedResult.signals || [];

        let signalsSent = 0;

        // Send Telegram Message if valid signals found
        if (signals.length > 0) {
          for (const signal of signals) {
            if (signal.confidenceScore >= 70) {
              
              // Duplicate Signal Prevention
              // Check if we already sent this exact signal recently
              const signalHash = `${signal.pair}_${signal.direction}_${signal.entryPrice}`;
              if (watcher.last_signal_data === signalHash) {
                console.log(`[User ${userId}] Duplicate signal detected for ${signal.pair}. Skipping alert.`);
                continue;
              }

              const alertMessage = `🚨 *Autonomous AI Trading Alert* 🚨\n\n` +
                `*Pair:* ${signal.pair} (${selectedTimeframe})\n` +
                `*Direction:* ${signal.direction === 'BUY' ? '🟢 BUY' : '🔴 SELL'}\n` +
                `*Entry Price:* ${signal.entryPrice}\n` +
                `*Stop Loss:* ${signal.stopLoss}\n` +
                `*Take Profit:* ${signal.takeProfit}\n` +
                `*Risk/Reward:* ${signal.riskRewardRatio}\n` +
                `*Confidence:* ${signal.confidenceScore}/100\n\n` +
                `*AI Reasoning:* ${signal.aiReasoning}\n\n` +
                `*Time:* ${new Date().toUTCString()}`;

              await sendTelegramMessage(telegramChatId, alertMessage);
              
              // Store this signal to prevent immediate duplicates
              await supabase
                .from("watchers")
                .update({ last_signal_data: signalHash })
                .eq("user_id", userId);
                
              signalsSent++;
            }
          }
        }

        // Update watcher last scan timestamp
        await supabase
          .from("watchers")
          .update({ 
            last_scan_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("user_id", userId);

        results.push({ userId, symbol, signalsFound: signals.length, signalsSent });
        console.log(`[User ${userId}] Scan complete. Signals found: ${signals.length}, Sent: ${signalsSent}`);

      } catch (err: any) {
        console.error(`[User ${userId}] Error processing watcher:`, err.message || err);
      }
    }

    console.log("[Market Watcher Edge] Cycle complete. Processed:", results.length);
    return new Response(JSON.stringify({ success: true, processed: results.length, results }), {
      headers: { "Content-Type": "application/json" },
    })

  } catch (err: any) {
    console.error("[Market Watcher Edge] Fatal Error:", err.message || err);
    return new Response(JSON.stringify({ error: err.message || "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    })
  }
})
