import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from "@google/genai";

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

  // 1. Verify the user is authenticated
  const authHeader = req.headers.authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

  if (token) {
    try {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (authError || !user) {
        console.warn("[Watcher Scan] Bearer token auth validation failed:", authError?.message);
      } else {
        userId = user.id;
      }
    } catch (err: any) {
      console.warn("[Watcher Scan] Bearer token verification error:", err.message);
    }
  }

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication failed. You must be authenticated to trigger a market watcher scan."
    });
  }

  try {
    console.log(`[Watcher Scan] Loading active watcher and settings for user: ${userId}`);

    // 2. Load the user's active watcher
    const { data: watcher, error: watcherError } = await supabase
      .from("watchers")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (watcherError) {
      console.error("[Watcher Scan] Watcher query error:", watcherError.message);
      return res.status(500).json({ success: false, error: "Database error fetching watcher: " + watcherError.message });
    }

    if (!watcher) {
      return res.status(404).json({
        success: false,
        error: "No AI Market Watcher found for this user. Please set up and start your watcher first."
      });
    }

    // 3. Ensure the watcher's status is "active"
    if (watcher.status !== "active") {
      return res.status(400).json({
        success: false,
        error: `AI Market Watcher is not active. Current status: ${watcher.status}. Please start the watcher first.`
      });
    }

    // 4. Verify Telegram is connected by checking the telegram_connections table
    const { data: telegramConn, error: telegramError } = await supabase
      .from("telegram_connections")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (telegramError) {
      console.warn("[Watcher Scan] Telegram connection query error:", telegramError.message);
    }

    const telegramChatId = telegramConn?.telegram_chat_id;

    if (!telegramConn || !telegramConn.connected || !telegramChatId) {
      return res.status(400).json({
        success: false,
        error: "Telegram is not connected. Please connect your Telegram account first under Gaks AI Settings."
      });
    }

    // 5. Load User's trading strategy, account size, risk settings, Gemini API key, and Watchlist
    const { data: prefsRecord, error: prefsError } = await supabase
      .from("trading_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    if (prefsError) {
      console.warn("[Watcher Scan] Trading preferences query error:", prefsError.message);
    }

    const strategyText = watcher.strategy_id 
      ? "Active Custom Strategy ID: " + watcher.strategy_id 
      : (prefsRecord?.strategy_text || "");

    if (!strategyText.trim()) {
      return res.status(400).json({
        success: false,
        error: "Trading Strategy playbook is empty or not configured. Please write your custom strategy details first."
      });
    }

    const accountSize = watcher.account_size || (prefsRecord?.capital ? parseFloat(prefsRecord.capital.replace(/[^0-9.]/g, "")) : null);
    const riskPercentage = watcher.risk_percentage || (prefsRecord?.preferred_risk ? parseFloat(prefsRecord.preferred_risk.replace(/[^0-9.]/g, "")) : null);

    if (!accountSize || !riskPercentage) {
      return res.status(400).json({
        success: false,
        error: "Account size and risk percentage must be defined in your trading preferences or watcher configuration."
      });
    }

    // Load Gemini API Key
    const { data: apiKeyRecord, error: apiKeyError } = await supabase
      .from("user_api_keys")
      .select("*")
      .eq("user_id", userId)
      .eq("provider", "gemini")
      .maybeSingle();

    if (apiKeyError) {
      console.warn("[Watcher Scan] Gemini API key query error:", apiKeyError.message);
    }

    if (!apiKeyRecord || !apiKeyRecord.api_key) {
      return res.status(400).json({
        success: false,
        error: "Gemini API key is missing. Please save a valid Gemini API key under AI Settings first."
      });
    }

    // Check for selected pair
    const selectedPair = watcher.selected_pair;
    if (!selectedPair) {
      return res.status(400).json({
        success: false,
        error: "No trading pair is selected for monitoring. Please select a pair in the AI Market Watcher settings."
      });
    }

    // 6. Use the application's TWELVE_DATA_API_KEY from environment variables
    const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
    if (!twelveDataKey) {
      return res.status(500).json({
        success: false,
        error: "Application TWELVE_DATA_API_KEY is not defined in the server environment variables."
      });
    }

    // 7. Fetch live market data from Twelve Data for the selected pair
    const collectedData: Record<string, any> = {};

    const convertSymbol = (sym: string): string => {
      let mapped = sym.trim().toUpperCase();
      if (mapped === 'NAS100') return 'IXIC';
      if (mapped === 'US30') return 'DJI';
      if (mapped === 'SPX500' || mapped === 'US500') return 'SPX';
      
      if (mapped.includes('/')) return mapped;
      
      if (mapped.length === 6 && /^[A-Z]{6}$/.test(mapped)) {
        return `${mapped.slice(0, 3)}/${mapped.slice(3)}`;
      }
      if (mapped.endsWith('USD') && mapped.length > 3) return mapped.slice(0, -3) + '/USD';
      if (mapped.endsWith('JPY') && mapped.length > 3) return mapped.slice(0, -3) + '/JPY';
      if (mapped.endsWith('EUR') && mapped.length > 3) return mapped.slice(0, -3) + '/EUR';
      if (mapped.endsWith('GBP') && mapped.length > 3) return mapped.slice(0, -3) + '/GBP';
      return mapped;
    };

    const symbol = selectedPair;
    const mappedSymbol = convertSymbol(selectedPair);
    const selectedTimeframe = watcher.selected_timeframe || 'H1';

    const mapTimeframeToInterval = (tf: string): string => {
      const u = tf.toUpperCase();
      if (u === 'M1' || u === '1M') return '1min';
      if (u === 'M5' || u === '5M') return '5min';
      if (u === 'M15' || u === '15M') return '15min';
      if (u === 'M30' || u === '30M') return '30min';
      if (u === 'H1' || u === '1H') return '1h';
      if (u === 'H2' || u === '2H') return '2h';
      if (u === 'H4' || u === '4H') return '4h';
      if (u === 'D1' || u === 'D' || u === 'DAILY') return '1day';
      if (u === 'W1' || u === 'W' || u === 'WEEKLY') return '1week';
      return '1h';
    };

    const interval = mapTimeframeToInterval(selectedTimeframe);
    
    let quoteData: any = null;
    let finalEndpoint = "time_series";
    const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(mappedSymbol)}&interval=${interval}&outputsize=1&apikey=${twelveDataKey}`;
    const maskedTimeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(mappedSymbol)}&interval=${interval}&outputsize=1&apikey=HIDDEN`;

    console.log(`[Twelve Data Request Details]:`);
    console.log(`- Watcher ID: ${watcher.id}`);
    console.log(`- Selected Pair: ${selectedPair}`);
    console.log(`- Converted Symbol: ${mappedSymbol}`);
    console.log(`- Timeframe: ${selectedTimeframe}`);
    console.log(`- Exact Endpoint: /time_series`);
    console.log(`- Exact Symbol: ${mappedSymbol}`);
    console.log(`- Exact Interval: ${interval}`);
    console.log(`- Request URL: ${maskedTimeSeriesUrl}`);

    try {
      const tsRes = await fetch(timeSeriesUrl);
      if (tsRes.ok) {
        const tsData = await tsRes.json();
        if (tsData.status === "ok" && tsData.values && tsData.values.length > 0) {
          quoteData = tsData.values[0];
          console.log(`[Twelve Data API] Successfully fetched candles from /time_series for ${mappedSymbol}`);
        } else {
          console.warn(`[Twelve Data API] /time_series returned status: ${tsData.status || "error"}, message: ${tsData.message || "Unknown error"}. Falling back to /quote.`);
        }
      } else {
        console.warn(`[Twelve Data API] /time_series failed with HTTP ${tsRes.status}. Falling back to /quote.`);
      }
    } catch (tsErr: any) {
      console.warn(`[Twelve Data API] /time_series error: ${tsErr.message || tsErr}. Falling back to /quote.`);
    }

    // Fallback to /quote if /time_series did not work
    if (!quoteData) {
      finalEndpoint = "quote";
      const quoteUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(mappedSymbol)}&apikey=${twelveDataKey}`;
      const maskedQuoteUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(mappedSymbol)}&apikey=HIDDEN`;
      
      console.log(`[Twelve Data Fallback Request Details]:`);
      console.log(`- Watcher ID: ${watcher.id}`);
      console.log(`- Selected Pair: ${selectedPair}`);
      console.log(`- Converted Symbol: ${mappedSymbol}`);
      console.log(`- Timeframe: ${selectedTimeframe}`);
      console.log(`- Exact Endpoint: /quote`);
      console.log(`- Exact Symbol: ${mappedSymbol}`);
      console.log(`- Exact Interval: N/A (Daily Quote)`);
      console.log(`- Request URL: ${maskedQuoteUrl}`);
      
      try {
        const qRes = await fetch(quoteUrl);
        if (qRes.ok) {
          const qData = await qRes.json();
          if (qData.status !== "error") {
            quoteData = qData;
            console.log(`[Twelve Data API] Successfully fetched quote from /quote for ${mappedSymbol}`);
          } else {
            return res.status(400).json({
              success: false,
              error: `Twelve Data API error for symbol ${symbol}: ${qData.message || "Unknown error"}`
            });
          }
        } else {
          return res.status(400).json({
            success: false,
            error: `Twelve Data API returned HTTP ${qRes.status} for symbol ${symbol}.`
          });
        }
      } catch (qErr: any) {
        return res.status(500).json({
          success: false,
          error: `Failed to fetch live market data for ${symbol}: ${qErr.message || "Network error"}`
        });
      }
    }

    try {

      if (quoteData.status === "error" || quoteData.code >= 400) {
        return res.status(400).json({
          success: false,
          error: `Twelve Data API error for symbol ${symbol}: ${quoteData.message || "Unknown error"}`
        });
      }

      // 8. Return structured JSON containing the specified fields
      const currentPrice = parseFloat(quoteData.close || quoteData.price || "0");
      const openPrice = parseFloat(quoteData.open || "0");
      const highPrice = parseFloat(quoteData.high || "0");
      const lowPrice = parseFloat(quoteData.low || "0");
      const closePrice = parseFloat(quoteData.close || "0");
      
      const bidPrice = quoteData.bid ? parseFloat(quoteData.bid) : currentPrice * 0.9999;
      const askPrice = quoteData.ask ? parseFloat(quoteData.ask) : currentPrice * 1.0001;
      const volumeVal = quoteData.volume ? parseFloat(quoteData.volume) : 0;
      const timestampVal = quoteData.timestamp || Math.floor(Date.now() / 1000);

      collectedData[symbol] = {
        current_price: currentPrice,
        open: openPrice,
        high: highPrice,
        low: lowPrice,
        close: closePrice,
        bid: bidPrice,
        ask: askPrice,
        volume: volumeVal,
        timestamp: timestampVal
      };

    } catch (fetchErr: any) {
      console.error(`[Watcher Scan] Failed to fetch market data for ${symbol}:`, fetchErr);
      return res.status(500).json({
        success: false,
        error: `Failed to fetch live market data for ${symbol}: ${fetchErr.message || "Network error"}`
      });
    }

    // 10 & 11. Perform AI analysis with Gemini
    const ai = new GoogleGenAI({ apiKey: apiKeyRecord.api_key });

    const promptText = `
You are an expert AI trading assistant.
Analyze the following live market data against the user's trading strategy.
Return a structured JSON list of trading signals. Only generate a signal if the setup strongly matches the strategy.
If no valid setups are found, return an empty array for signals.

User's Trading Strategy:
${strategyText}

Account Size: $${accountSize}
Risk Percentage per trade: ${riskPercentage}%

Live Market Data (Twelve Data):
${JSON.stringify(collectedData, null, 2)}
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
                  pair: { type: Type.STRING, description: "The trading pair symbol (e.g., EUR/USD)" },
                  direction: { type: Type.STRING, description: "BUY or SELL" },
                  entryPrice: { type: Type.NUMBER, description: "Suggested entry price" },
                  stopLoss: { type: Type.NUMBER, description: "Suggested stop loss price" },
                  takeProfit: { type: Type.NUMBER, description: "Suggested take profit price" },
                  riskRewardRatio: { type: Type.STRING, description: "Risk/Reward ratio (e.g., '1:2.5')" },
                  confidenceScore: { type: Type.NUMBER, description: "Confidence score from 0 to 100" },
                  aiReasoning: { type: Type.STRING, description: "Brief explanation of why this setup matches the strategy" },
                },
                required: ["pair", "direction", "entryPrice", "stopLoss", "takeProfit", "riskRewardRatio", "confidenceScore", "aiReasoning"]
              }
            }
          },
          required: ["signals"]
        }
      }
    });

    const resultText = aiResponse.text;
    if (!resultText) {
      throw new Error("Gemini returned an empty response.");
    }

    const parsedResult = JSON.parse(resultText);
    const signals = parsedResult.signals || [];
    let telegramDelivered = false;

    // Send Telegram notifications for any valid signals
    if (signals.length > 0) {
      for (const signal of signals) {
        if (signal.confidenceScore >= 70) {
          const alertMessage = `🚨 *Gaks AI Trading Alert* 🚨\n\n` +
            `*Pair:* ${signal.pair}\n` +
            `*Direction:* ${signal.direction === 'BUY' ? '🟢 BUY' : '🔴 SELL'}\n` +
            `*Entry Price:* ${signal.entryPrice}\n` +
            `*Stop Loss:* ${signal.stopLoss}\n` +
            `*Take Profit:* ${signal.takeProfit}\n` +
            `*Risk/Reward:* ${signal.riskRewardRatio}\n` +
            `*Confidence:* ${signal.confidenceScore}/100\n\n` +
            `*AI Reasoning:* ${signal.aiReasoning}\n\n` +
            `*Time:* ${new Date().toUTCString()}`;

          const success = await sendTelegramMessage(telegramChatId, alertMessage);
          if (success) telegramDelivered = true;
        }
      }
    }

    return res.json({
      success: true,
      data: collectedData,
      signals: signals,
      telegram_delivered: telegramDelivered
    });

  } catch (err: any) {
    console.error("[Watcher Scan] Unhandled internal exception:", err);
    return res.status(500).json({
      success: false,
      error: "Internal server error during watcher scan: " + (err.message || "Unknown error")
    });
  }
}
