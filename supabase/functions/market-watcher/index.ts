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
        return { isValid: false };
      } catch (err: any) {
        console.error(`[Symbol Search] Error validating symbol ${symbol}:`, err.message || err);
        return { isValid: true };
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
        const convertSymbol = (sym: string): string => {
          let mapped = sym.trim().toUpperCase();
          if (mapped === 'NAS100') return 'IXIC';
          if (mapped === 'US30') return 'DJI';
          if (mapped === 'SPX500' || mapped === 'US500') return 'SPX';
          
          if (mapped.includes('/')) return mapped;
          
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

        const symbol = selectedPair;
        const mappedSymbol = convertSymbol(selectedPair);
        const interval = mapTimeframeToInterval(selectedTimeframe);

        // Validate symbol before making /time_series or /quote requests
        console.log(`[Symbol Validation] Validating symbol: ${mappedSymbol} using Twelve Data Search...`);
        const validation = await validateSymbolWithTwelveData(mappedSymbol, twelveDataKey);
        if (!validation.isValid) {
          console.error(`[Twelve Data API] Symbol validation failed. Symbol ${mappedSymbol} is not recognized by Twelve Data.`);
          throw new Error(`TwelveData HTTP Error: 404 (Symbol not found or invalid on Twelve Data)`);
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
          
          const qRes = await fetchWithRetry(quoteUrl, {}, 3, 1000);
          if (!qRes.ok) {
            throw new Error(`TwelveData HTTP Error: ${qRes.status}`);
          }
          const qData = await qRes.json();
          if (qData.status === "error") {
            throw new Error(`TwelveData Error: ${qData.message}`);
          }
          quoteData = qData;
          console.log(`[Twelve Data API] Successfully fetched quote from /quote for ${finalSymbol}`);
        }

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
