import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from "@google/genai";


async function generateContentWithDiagnostics(ai: any, params: any) {
   const contents = params.contents;
   let promptText = "";
   if (typeof contents === "string") promptText = contents;
   else if (Array.isArray(contents)) promptText = JSON.stringify(contents);
   else promptText = contents?.toString() || "";

   if (!promptText || promptText.trim().length === 0) {
      throw new Error("Invalid prompt: prompt is empty or only whitespace.");
   }
   
   console.log(`\n=== GEMINI REQUEST DIAGNOSTIC ===`);
   const apiKeyPresent = !!process.env.GEMINI_API_KEY;
   console.log(`API key present: ${apiKeyPresent}`);
   console.log(`Model: ${params.model}`);
   console.log(`Request Payload: ${JSON.stringify(params).substring(0, 500)}`);
   console.log(`Prompt Length: ${promptText.length}`);
   
   try {
      const response = await ai.models.generateContent(params);
      console.log(`=== GEMINI RESPONSE ===\n${JSON.stringify(response)}\n=======================`);
      return response;
   } catch (error: any) {
      console.error(`=== GEMINI ERROR DIAGNOSTIC ===`);
      console.error(`Error Message: ${error.message}`);
      console.error(`Status: ${error.status}`);
      console.error(`Stack: ${error.stack}`);
      console.error(`Response Body:`, error.response || error.responseBody || 'None');
      console.error(`Full Error Object: ${JSON.stringify(error, Object.getOwnPropertyNames(error))}`);
      console.error(`===============================`);
      throw error;
   }
}


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
      console.error(`Telegram sendMessage failed with status ${response.status}:`, await response.text());
      return false;
    }
    return true;
  } catch (err) {
    console.error("Error sending Telegram message:", err);
    return false;
  }
}

async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 3, baseDelayMs = 1000): Promise<Response> {
  let attempt = 0;
  while (attempt < maxRetries) {
    attempt++;
    try {
      const response = await fetch(url, options);
      if (response.ok) {
        return response;
      }
      if (response.status === 404 || response.status === 400) {
        // Do not retry client errors (like 404 Not Found)
        return response;
      }
      console.warn(`[Fetch Retry] Attempt ${attempt} returned status ${response.status}. Retrying in ${baseDelayMs * Math.pow(2, attempt - 1)}ms...`);
    } catch (err: any) {
      if (attempt >= maxRetries) {
        throw err;
      }
      console.warn(`[Fetch Retry] Attempt ${attempt} threw network error: ${err.message || err}. Retrying in ${baseDelayMs * Math.pow(2, attempt - 1)}ms...`);
    }
    await new Promise(resolve => setTimeout(resolve, baseDelayMs * Math.pow(2, attempt - 1)));
  }
  throw new Error(`Fetch failed after ${maxRetries} attempts`);
}

async function validateSymbolWithTwelveData(symbol: string, apiKey: string): Promise<{ isValid: boolean; matchedSymbol?: string; instrumentType?: string }> {
  try {
    const searchUrl = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
    const response = await fetchWithRetry(searchUrl, {}, 2, 500);
    if (!response.ok) {
      console.warn(`[Symbol Search] API returned HTTP ${response.status} for search. Skipping search validation and proceeding.`);
      return { isValid: true };
    }
    const data = await response.json();
    if (data.status === "error") {
      console.warn(`[Symbol Search] API returned error status: ${data.message}`);
      return { isValid: true };
    }
    if (data.data && Array.isArray(data.data) && data.data.length > 0) {
      const symbolUpper = symbol.toUpperCase().replace('/', '');
      const exactMatch = data.data.find((item: any) => 
        item.symbol.toUpperCase().replace('/', '') === symbolUpper
      );
      if (exactMatch) {
        return { isValid: true, matchedSymbol: exactMatch.symbol, instrumentType: exactMatch.instrument_type };
      }
      return { isValid: true, matchedSymbol: data.data[0].symbol, instrumentType: data.data[0].instrument_type };
    }
    // No matching symbols found in Twelve Data database - warn and proceed with original symbol as fallback
    console.warn(`[Symbol Search] No matching symbols found in search results for "${symbol}". Proceeding with original symbol.`);
    return { isValid: true, matchedSymbol: symbol };
  } catch (err: any) {
    console.error(`[Symbol Search] Error validating symbol ${symbol}:`, err.message || err);
    return { isValid: true };
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

function extractStrategyTextById(strategyTextRaw: string, strategyId?: string): string {
  if (!strategyTextRaw || !strategyTextRaw.trim()) return DEFAULT_STRATEGY_TEXT;
  const defaultTemplate = `• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules`;
  if (strategyTextRaw.trim() === defaultTemplate.trim()) return DEFAULT_STRATEGY_TEXT;

  try {
    const parsed = JSON.parse(strategyTextRaw);
    if (parsed && typeof parsed === 'object' && Array.isArray(parsed.strategies)) {
      const targetId = strategyId || parsed.activeId;
      const active = parsed.strategies.find((s: any) => {
        if (targetId === '00000000-0000-0000-0000-000000000000' || targetId === 'default') {
          return s.id === '00000000-0000-0000-0000-000000000000' || s.id === 'default' || s.isDefault;
        }
        if (targetId === '11111111-1111-1111-1111-111111111111' || targetId === '11111111-1111-1111-1111-111111111111') {
          return s.id === '11111111-1111-1111-1111-111111111111' || s.id === '11111111-1111-1111-1111-111111111111';
        }
        return s.id === targetId;
      }) || parsed.strategies[0];
      return active ? (active.text || DEFAULT_STRATEGY_TEXT) : DEFAULT_STRATEGY_TEXT;
    }
  } catch (e) {
    // Not JSON, return as-is
  }
  return strategyTextRaw;
}

export default async function handler(req: any, res: any) {
  const supabase = getSupabase();
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

    const strategyText = extractStrategyTextById(prefsRecord?.strategy_text || '', watcher.strategy_id);

    if (!strategyText.trim()) {
      return res.status(400).json({
        success: false,
        error: "Active trading strategy is empty. Please configure your strategy playbook first."
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
      if (!sym) return "";
      let mapped = sym.trim().toUpperCase().replace(/[-_\s/]/g, '');
      
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
      
      // Forex standard 6 letters (e.g. EURUSD, GBPUSD, USDJPY, AUDCAD, etc.)
      const commonCurrencies = ["EUR", "USD", "GBP", "JPY", "AUD", "CAD", "CHF", "NZD", "SGD", "HKD", "SEK", "NOK", "MXN", "CNH", "CNY", "ZAR", "TRY"];
      if (mapped.length === 6 && /^[A-Z]{6}$/.test(mapped)) {
        const firstHalf = mapped.slice(0, 3);
        const secondHalf = mapped.slice(3);
        if (commonCurrencies.includes(firstHalf) && commonCurrencies.includes(secondHalf)) {
          return `${firstHalf}/${secondHalf}`;
        }
      }

      // Cryptocurrencies (e.g., BTCUSD, ETHUSDT, SOLBTC, ETHBTC, etc.)
      const commonCryptoCoins = ["BTC", "ETH", "SOL", "ADA", "XRP", "DOT", "DOGE", "LTC", "LINK", "AVAX", "XLM", "UNI", "BCH", "ATOM"];
      const commonCryptoQuote = ["USD", "USDT", "BTC", "ETH", "EUR", "GBP", "FDUSD", "USDC"];
      
      // Check for cryptos like BTCUSDT
      for (const coin of commonCryptoCoins) {
        if (mapped.startsWith(coin)) {
          const suffix = mapped.slice(coin.length);
          if (commonCryptoQuote.includes(suffix)) {
            return `${coin}/${suffix}`;
          }
        }
      }
      
      if (mapped.length === 6 && /^[A-Z]{6}$/.test(mapped)) {
        // General fallback split for any 6-letter alphabetic pairs
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

    // Validate symbol before making /time_series or /quote requests
    console.log(`[Symbol Validation] Validating symbol: ${mappedSymbol} using Twelve Data Search...`);
    const validation = await validateSymbolWithTwelveData(mappedSymbol, twelveDataKey);
    if (!validation.isValid) {
      console.error(`[Twelve Data API] Symbol validation failed. Symbol ${mappedSymbol} is not recognized by Twelve Data.`);
      return res.status(400).json({
        success: false,
        error: `Twelve Data API returned HTTP 404: Symbol ${mappedSymbol} is not recognized or available in Twelve Data.`
      });
    }
    
    const finalSymbol = validation.matchedSymbol || mappedSymbol;
    console.log(`[Symbol Validation] Symbol is valid. Resolved to: ${finalSymbol} (Type: ${validation.instrumentType || 'Unknown'})`);
    
    let quoteData: any = null;
    let finalEndpoint = "time_series";
    const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(finalSymbol)}&interval=${interval}&outputsize=1&apikey=${twelveDataKey}`;
    const maskedTimeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(finalSymbol)}&interval=${interval}&outputsize=1&apikey=HIDDEN`;

    console.log(`[Twelve Data Request Details]:`);
    console.log(`- Watcher ID: ${watcher.id}`);
    console.log(`- Selected Pair: ${selectedPair}`);
    console.log(`- Converted Symbol: ${finalSymbol}`);
    console.log(`- Timeframe: ${selectedTimeframe}`);
    console.log(`- Exact Endpoint: /time_series`);
    console.log(`- Exact Symbol: ${finalSymbol}`);
    console.log(`- Exact Interval: ${interval}`);
    console.log(`- Request URL: ${maskedTimeSeriesUrl}`);

    try {
      const tsRes = await fetchWithRetry(timeSeriesUrl, {}, 3, 1000);
      if (tsRes.ok) {
        const tsData = await tsRes.json();
        if (tsData.status === "ok" && tsData.values && tsData.values.length > 0) {
          quoteData = tsData.values[0];
          console.log(`[Twelve Data API] Successfully fetched candles from /time_series for ${finalSymbol}`);
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
      const quoteUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(finalSymbol)}&apikey=${twelveDataKey}`;
      const maskedQuoteUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(finalSymbol)}&apikey=HIDDEN`;
      
      console.log(`[Twelve Data Fallback Request Details]:`);
      console.log(`- Watcher ID: ${watcher.id}`);
      console.log(`- Selected Pair: ${selectedPair}`);
      console.log(`- Converted Symbol: ${finalSymbol}`);
      console.log(`- Timeframe: ${selectedTimeframe}`);
      console.log(`- Exact Endpoint: /quote`);
      console.log(`- Exact Symbol: ${finalSymbol}`);
      console.log(`- Exact Interval: N/A (Daily Quote)`);
      console.log(`- Request URL: ${maskedQuoteUrl}`);
      
      try {
        const qRes = await fetchWithRetry(quoteUrl, {}, 3, 1000);
        if (qRes.ok) {
          const qData = await qRes.json();
          if (qData.status !== "error") {
            quoteData = qData;
            console.log(`[Twelve Data API] Successfully fetched quote from /quote for ${finalSymbol}`);
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

    const aiResponse = await generateContentWithDiagnostics(ai, {
      model: "gemini-1.5-flash",
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
