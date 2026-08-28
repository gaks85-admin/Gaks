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
    const WATCHER_CONCURRENCY = parseInt(Deno.env.get('WATCHER_CONCURRENCY') || '5', 10) || 5;
    const GEMINI_TIMEOUT_MS = parseInt(Deno.env.get('GEMINI_TIMEOUT_MS') || '8000', 10) || 8000;
    const GEMINI_MAX_RETRIES = parseInt(Deno.env.get('GEMINI_MAX_RETRIES') || '1', 10) ?? 1;

    console.log(`[Market Watcher Edge] Starting scan cycle (Concurrency: ${WATCHER_CONCURRENCY}, Gemini Timeout: ${GEMINI_TIMEOUT_MS}ms, Max Retries: ${GEMINI_MAX_RETRIES})...`);

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

    async function fetchWithRetry(url: string, options: RequestInit = {}, maxRetries = 2, baseDelayMs = 1000): Promise<Response> {
      let attempt = 0;
      while (attempt < maxRetries) {
        attempt++;
        try {
          const response = await fetch(url, options);
          if (response.ok) return response;
          if (response.status === 429) {
            console.warn(`[Twelve Data Rate Limit] HTTP 429 rate limit received. Never retrying 429.`);
            return response;
          }
          if (response.status === 404 || response.status === 400) return response;
          console.warn(`[Fetch Retry] Attempt ${attempt} returned HTTP ${response.status}. Retrying...`);
        } catch (err: any) {
          if (attempt >= maxRetries) throw err;
          console.warn(`[Fetch Retry] Attempt ${attempt} network error: ${err.message || err}. Retrying...`);
        }
        await new Promise(resolve => setTimeout(resolve, baseDelayMs * attempt));
      }
      throw new Error(`Fetch failed after ${maxRetries} attempts`);
    }

    async function validateSymbolWithTwelveData(symbol: string, apiKey: string): Promise<{ isValid: boolean; matchedSymbol?: string; instrumentType?: string }> {
      try {
        const searchUrl = `https://api.twelvedata.com/symbol_search?symbol=${encodeURIComponent(symbol)}&apikey=${apiKey}`;
        const response = await fetchWithRetry(searchUrl, {}, 2, 500);
        if (!response.ok) return { isValid: true };
        const data = await response.json();
        if (data.status === "error") return { isValid: true };
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
        return { isValid: true, matchedSymbol: symbol };
      } catch (err: any) {
        console.error(`[Symbol Search] Error validating symbol ${symbol}:`, err.message || err);
        return { isValid: true };
      }
    }

    const GEMINI_MARKET_WATCHER_MODEL = "gemini-3.6-flash";

    // Bounded Gemini API Call helper with timeout & retry
    async function callGeminiWithTimeoutAndRetry(
      apiKey: string,
      promptText: string,
      modelName: string = GEMINI_MARKET_WATCHER_MODEL,
      timeoutMs: number = 30000,
      maxRetries: number = 1
    ): Promise<{ success: boolean; text?: string; errorType?: string; attempts: number; durationMs: number }> {
      const startTime = Date.now();
      const ai = new GoogleGenAI({ apiKey });
      let attempt = 0;

      while (attempt <= maxRetries) {
        attempt++;
        const attemptStart = Date.now();
        let timer: any = null;

        try {
          const geminiPromise = ai.models.generateContent({
            model: modelName,
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

          const timeoutPromise = new Promise<never>((_, reject) => {
            timer = setTimeout(() => {
              const err: any = new Error(`Gemini request timed out after ${timeoutMs}ms`);
              err.name = 'TimeoutError';
              reject(err);
            }, timeoutMs);
          });

          const response = await Promise.race([geminiPromise, timeoutPromise]);
          if (timer) clearTimeout(timer);

          const duration = Date.now() - attemptStart;
          console.log(`[GEMINI SUCCESS] Attempt: ${attempt}, Duration: ${duration}ms`);

          return {
            success: true,
            text: (response as any).text || '{"signals": []}',
            attempts: attempt,
            durationMs: Date.now() - startTime
          };

        } catch (err: any) {
          if (timer) clearTimeout(timer);
          const errMsg = err?.message || String(err);
          const isTimeout = err?.name === 'TimeoutError' || errMsg.includes('timed out');
          const isRateLimit = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota');
          const isServerError = errMsg.includes('503') || errMsg.includes('UNAVAILABLE') || errMsg.includes('high demand');
          const shouldRetry = isServerError && !isTimeout && !isRateLimit && attempt <= maxRetries;

          console.warn(`[GEMINI ERROR] Attempt ${attempt}/${maxRetries + 1} failed (${isTimeout ? 'TIMEOUT' : isRateLimit ? 'QUOTA' : isServerError ? '503_UNAVAILABLE' : 'ERROR'}): ${errMsg}`);

          if (shouldRetry) {
            console.log(`[GEMINI RETRY] Retrying 503 UNAVAILABLE in 500ms...`);
            await new Promise(r => setTimeout(r, 500));
            continue;
          }

          return {
            success: false,
            errorType: isTimeout ? 'TIMEOUT' : isRateLimit ? 'QUOTA_EXHAUSTED' : isServerError ? 'TEMPORARY_ERROR' : 'UNKNOWN',
            attempts: attempt,
            durationMs: Date.now() - startTime
          };
        }
      }

      return {
        success: false,
        errorType: 'MAX_RETRIES_EXCEEDED',
        attempts: attempt,
        durationMs: Date.now() - startTime
      };
    }

    const DEFAULT_STRATEGY_TEXT = `# Gaks AI Default Strategy

## 1. Overview
Institutional-grade multi-timeframe strategy for intraday trend capture.

## 2. Rules
- Timeframe Alignment: H1 trend, M15 entry.
- S&R / Liquidity: Major daily/weekly highs/lows.
- Momentum & Volume: Engulfing / pinbar + volume breakout.
- Risk Rule: Max 1% account risk per trade, min 1:2 R:R.`;

    function extractStrategyTextById(strategyTextRaw: string, strategyId?: string): string {
      if (!strategyTextRaw || !strategyTextRaw.trim()) return DEFAULT_STRATEGY_TEXT;
      try {
        const parsed = JSON.parse(strategyTextRaw);
        if (parsed && typeof parsed === 'object' && Array.isArray(parsed.strategies)) {
          const targetId = strategyId || parsed.activeId;
          const active = parsed.strategies.find((s: any) => s.id === targetId || s.isDefault) || parsed.strategies[0];
          return active?.text || DEFAULT_STRATEGY_TEXT;
        }
      } catch (e) {
        // Not JSON
      }
      return strategyTextRaw;
    }

    // 3. Load active watchers from the database
    const { data: watchers, error: watchersError } = await supabase
      .from("watchers")
      .select("*")
      .eq("status", "active");

    if (watchersError) throw watchersError;

    if (!watchers || watchers.length === 0) {
      console.log("[Market Watcher Edge] No active watchers found.");
      return new Response(JSON.stringify({ success: true, processed: 0, message: "No active watchers." }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    console.log(`[Market Watcher Edge] Found ${watchers.length} active watchers. Dispatching concurrency pool (Limit: ${WATCHER_CONCURRENCY})...`);

    // Worker pool for concurrency control & fault isolation
    async function processWithConcurrency<T, R>(
      items: T[],
      concurrencyLimit: number,
      workerFn: (item: T, index: number) => Promise<R>
    ): Promise<R[]> {
      const limit = Math.max(1, concurrencyLimit);
      const results: R[] = new Array(items.length);
      let currentIndex = 0;

      async function worker() {
        while (currentIndex < items.length) {
          const index = currentIndex++;
          try {
            results[index] = await workerFn(items[index], index);
          } catch (err: any) {
            results[index] = {
              watcherId: items[index]?.id || 'unknown',
              status: 'FAILED',
              errorCategory: 'UNHANDLED_EXCEPTION',
              error: err?.message || String(err)
            } as unknown as R;
          }
        }
      }

      const workers = Array.from({ length: Math.min(limit, items.length) }, () => worker());
      await Promise.all(workers);
      return results;
    }

    // Process all active watchers concurrently
    const processedResults = await processWithConcurrency(watchers, WATCHER_CONCURRENCY, async (watcher) => {
      const watcherStartTime = Date.now();
      const userId = watcher.user_id;
      const selectedPair = watcher.selected_pair;
      const selectedTimeframe = watcher.selected_timeframe || 'H1';

      console.log(`[WATCHER START] Watcher ID: ${watcher.id}, User: ${userId}, Pair: ${selectedPair}, Timeframe: ${selectedTimeframe}`);

      if (!selectedPair) {
        return { watcherId: watcher.id, status: 'SKIPPED', reason: 'NO_PAIR' };
      }

      // CRON OVERLAP PROTECTION: Atomic CAS lock on watchers.last_scan_at
      const lockTime = new Date().toISOString();
      let lockQuery = supabase.from("watchers").update({ last_scan_at: lockTime }).eq("id", watcher.id);
      if (watcher.last_scan_at) {
        lockQuery = lockQuery.eq("last_scan_at", watcher.last_scan_at);
      } else {
        lockQuery = lockQuery.is("last_scan_at", null);
      }

      const { data: locked, error: lockErr } = await lockQuery.select();
      if (lockErr || !locked || locked.length === 0) {
        console.log(`[CRON OVERLAP PREVENTED] Watcher ${watcher.id} already locked or processed by another run. Skipping.`);
        return { watcherId: watcher.id, status: 'SKIPPED', reason: 'CRON_OVERLAP' };
      }

      try {
        // Check Telegram connection
        const { data: telegramConn } = await supabase
          .from("telegram_connections")
          .select("telegram_chat_id, connected")
          .eq("user_id", userId)
          .maybeSingle();

        if (!telegramConn || !telegramConn.connected || !telegramConn.telegram_chat_id) {
          console.log(`[WATCHER SKIPPED] Watcher: ${watcher.id}, User: ${userId} - Telegram not connected.`);
          return { watcherId: watcher.id, status: 'SKIPPED', reason: 'TELEGRAM_NOT_CONNECTED' };
        }

        const telegramChatId = telegramConn.telegram_chat_id;

        // Fetch Trading Preferences & Gemini API Key in parallel
        const [{ data: prefsRecord }, { data: apiKeyRecord }] = await Promise.all([
          supabase.from("trading_preferences").select("*").eq("user_id", userId).maybeSingle(),
          supabase.from("user_api_keys").select("*").eq("user_id", userId).eq("provider", "gemini").maybeSingle()
        ]);

        const strategyText = extractStrategyTextById(prefsRecord?.strategy_text || '', watcher.strategy_id);

        const rawCap = prefsRecord?.capital === 'Custom'
          ? (prefsRecord?.custom_capital || prefsRecord?.capital || "")
          : (prefsRecord?.capital || prefsRecord?.custom_capital || "");
        const cleanedCap = rawCap ? String(rawCap).replace(/[^0-9.]/g, "") : "";
        const accountSize = cleanedCap ? parseFloat(cleanedCap) : (watcher.account_size || 1000);

        const rawRisk = prefsRecord?.preferred_risk || "";
        const cleanedRisk = rawRisk ? String(rawRisk).replace(/[^0-9.]/g, "") : "";
        const riskPercentage = cleanedRisk ? parseFloat(cleanedRisk) : (watcher.risk_percentage || 1.0);

        const riskRewardStr = prefsRecord?.risk_reward || '1:2';
        const maxDailyRiskStr = (prefsRecord as any)?.max_daily_risk || '3 consecutive losses in 24h';

        if (!apiKeyRecord || !apiKeyRecord.api_key) {
          console.log(`[WATCHER SKIPPED] Watcher: ${watcher.id}, User: ${userId} - Gemini API Key missing.`);
          return { watcherId: watcher.id, status: 'SKIPPED', reason: 'MISSING_GEMINI_KEY' };
        }

        // Fetch live market data from Twelve Data
        const convertSymbol = (sym: string): string => {
          if (!sym) return "";
          let mapped = sym.trim().toUpperCase().replace(/[-_\s/]/g, '');
          const mappings: Record<string, string> = {
            'EURUSD': 'EUR/USD', 'GBPUSD': 'GBP/USD', 'XAUUSD': 'XAU/USD', 'BTCUSD': 'BTC/USD',
            'NAS100': 'QQQ', 'US30': 'DIA', 'SPX500': 'SPY', 'US500': 'SPY'
          };
          if (mappings[mapped]) return mappings[mapped];
          if (mapped.length === 6 && /^[A-Z]{6}$/.test(mapped)) return `${mapped.slice(0, 3)}/${mapped.slice(3)}`;
          return mapped;
        };

        const mapTimeframeToInterval = (tf: string): string => {
          const u = tf.toUpperCase();
          if (u === 'M1' || u === '1M') return '1min';
          if (u === 'M5' || u === '5M') return '5min';
          if (u === 'M15' || u === '15M') return '15min';
          if (u === 'M30' || u === '30M') return '30min';
          if (u === 'H1' || u === '1H') return '1h';
          if (u === 'H4' || u === '4H') return '4h';
          if (u === 'D1' || u === 'DAILY') return '1day';
          return '1h';
        };

        const mappedSymbol = convertSymbol(selectedPair);
        const interval = mapTimeframeToInterval(selectedTimeframe);

        const validation = await validateSymbolWithTwelveData(mappedSymbol, twelveDataKey);
        const finalSymbol = validation.matchedSymbol || mappedSymbol;

        let quoteData: any = null;
        let twelveDataStatus = 'SUCCESS';

        const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(finalSymbol)}&interval=${interval}&outputsize=1&apikey=${twelveDataKey}`;

        try {
          const tsRes = await fetchWithRetry(timeSeriesUrl, {}, 2, 1000);
          if (tsRes.ok) {
            const tsData = await tsRes.json();
            if (tsData.status === "ok" && tsData.values && tsData.values.length > 0) {
              quoteData = tsData.values[0];
            }
          }
        } catch (tsErr: any) {
          console.warn(`[TWELVE DATA] Watcher: ${watcher.id} time_series error: ${tsErr.message || tsErr}`);
        }

        if (!quoteData) {
          const quoteUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(finalSymbol)}&apikey=${twelveDataKey}`;
          const qRes = await fetchWithRetry(quoteUrl, {}, 2, 1000);
          if (qRes.ok) {
            const qData = await qRes.json();
            if (qData.status !== "error") {
              quoteData = qData;
            } else if (qData.code === 429) {
              twelveDataStatus = 'RATE_LIMITED';
            }
          }
        }

        if (!quoteData) {
          console.error(`[TWELVE DATA FAILED] Watcher: ${watcher.id}, Pair: ${finalSymbol}, Status: ${twelveDataStatus}`);
          return {
            watcherId: watcher.id,
            userId,
            pair: selectedPair,
            timeframe: selectedTimeframe,
            status: 'FAILED',
            errorCategory: 'TWELVE_DATA_FETCH_ERROR',
            durationMs: Date.now() - watcherStartTime
          };
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

        const promptText = `Analyze market data for ${selectedPair}:
Strategy: ${strategyText}
Account Size: $${accountSize}, Risk %: ${riskPercentage}%, R:R: ${riskRewardStr}
Market Data: ${JSON.stringify(marketData)}`;

        // Call Gemini with bounded timeout (30s) and retry logic
        const geminiRes = await callGeminiWithTimeoutAndRetry(
          apiKeyRecord.api_key,
          promptText,
          GEMINI_MARKET_WATCHER_MODEL,
          GEMINI_TIMEOUT_MS,
          GEMINI_MAX_RETRIES
        );

        if (!geminiRes.success || !geminiRes.text) {
          console.error(`[GEMINI FAILED] Watcher: ${watcher.id}, ErrorType: ${geminiRes.errorType}`);
          return {
            watcherId: watcher.id,
            userId,
            pair: selectedPair,
            timeframe: selectedTimeframe,
            status: 'FAILED',
            errorCategory: geminiRes.errorType || 'GEMINI_EXECUTION_ERROR',
            durationMs: Date.now() - watcherStartTime
          };
        }

        const parsedResult = JSON.parse(geminiRes.text || '{"signals": []}');
        const signals = parsedResult.signals || [];
        let telegramSent = false;

        if (signals.length > 0) {
          for (const signal of signals) {
            if (signal.confidenceScore >= 70) {
              // Duplicate Signal Protection
              const signalHash = `${signal.pair}_${signal.direction}_${signal.entryPrice}`;
              if (watcher.last_signal_data === signalHash) {
                console.log(`[DUPLICATE ALERT BLOCKED] Watcher: ${watcher.id}, Hash: ${signalHash}`);
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
                `*AI Reasoning:* ${signal.aiReasoning}`;

              await sendTelegramMessage(telegramChatId, alertMessage);
              
              await supabase
                .from("watchers")
                .update({ last_signal_data: signalHash })
                .eq("id", watcher.id);

              telegramSent = true;
            }
          }
        }

        const totalWatcherDuration = Date.now() - watcherStartTime;
        console.log(`[WATCHER COMPLETE] Watcher ID: ${watcher.id}, Pair: ${selectedPair}, Duration: ${totalWatcherDuration}ms, Status: SUCCESS, TelegramSent: ${telegramSent}`);

        return {
          watcherId: watcher.id,
          userId,
          pair: selectedPair,
          timeframe: selectedTimeframe,
          status: 'SUCCESS',
          telegramSent,
          signalsCount: signals.length,
          durationMs: totalWatcherDuration
        };

      } catch (watcherError: any) {
        const totalWatcherDuration = Date.now() - watcherStartTime;
        console.error(`[WATCHER ERROR] Watcher ID: ${watcher.id}, Error: ${watcherError.message || watcherError}`);
        return {
          watcherId: watcher.id,
          userId,
          pair: selectedPair,
          timeframe: selectedTimeframe,
          status: 'FAILED',
          errorCategory: 'WATCHER_EXECUTION_EXCEPTION',
          error: watcherError.message || String(watcherError),
          durationMs: totalWatcherDuration
        };
      }
    });

    console.log(`[Market Watcher Edge] Cycle completed. Processed ${processedResults.length} watchers concurrently.`);
    return new Response(JSON.stringify({
      success: true,
      processed: processedResults.length,
      results: processedResults
    }), {
      headers: { "Content-Type": "application/json" },
    });

  } catch (err: any) {
    console.error("[Market Watcher Edge] Fatal Error:", err.message || err);
    return new Response(JSON.stringify({ error: err.message || "Unknown error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" }
    });
  }
})
