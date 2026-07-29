import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from "@google/genai";
import { analyzeMarket, Candle } from "../../src/lib/strategy-engine.js";
import { extractRiskPreferences, calculatePositionSize, logPositionSizeAudit, parseRiskRewardRatio } from "../../src/lib/risk-engine.js";
import { evaluateRules, logRuleEngineAudit } from "../../src/lib/rule-engine.js";
import { compileStrategy } from "../../src/lib/strategy-compiler.js";
import { evaluateDecision } from "../../src/lib/decision-engine.js";
import { extractMarketStructure } from "../../src/lib/market-structure-engine.js";
import { recordEvaluation } from "../../src/lib/explainability-engine.js";
import { logPipelineTrace } from "../../src/lib/pipeline-logger.js";


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
  console.log("LOG: Manual scan started");
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

  // 1. Load Environment Variables
  const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
  const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
  console.log("LOG: Environment variables loaded", {
    TWELVE_DATA_API_KEY: !!twelveDataKey,
    TELEGRAM_BOT_TOKEN: !!telegramBotToken
  });

  let userId = req.body.userId;

  // 2. Supabase Connection & Auth
  try {
    const authHeader = req.headers.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7) : authHeader;

    if (token) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (user) userId = user.id;
    }
    console.log("LOG: Supabase connected");
  } catch (err: any) {
    console.error("LOG ERROR: Supabase connection/auth failed");
    console.error(`Exception: ${err.message}`);
    console.error(`Stack: ${err.stack}`);
  }

  if (!userId) {
    return res.status(401).json({
      success: false,
      error: "Authentication failed."
    });
  }

  try {
    // 3. Active Watchers Found
    let watcherQuery = supabase
      .from("watchers")
      .select("*")
      .eq("user_id", userId)
      .eq("status", "active");

    if (req.body?.symbol || req.body?.selected_pair) {
      watcherQuery = watcherQuery.eq("selected_pair", req.body?.symbol || req.body?.selected_pair);
    }

    const { data: watcher, error: watcherError } = await watcherQuery.limit(1).maybeSingle();

    if (watcherError) throw watcherError;
    if (!watcher) throw new Error("No watcher found.");
    
    console.log(`LOG: Active watchers found: 1`);

    // 4. Strategy Loaded
    const { data: prefsRecord } = await supabase
      .from("trading_preferences")
      .select("*")
      .eq("user_id", userId)
      .maybeSingle();

    const strategyText = extractStrategyTextById(prefsRecord?.strategy_text || '', watcher.strategy_id);
    console.log(`LOG: Strategy loaded`);

    const riskPrefs = extractRiskPreferences(prefsRecord, userId);
    const accountSize = riskPrefs.accountSize;
    const riskPercentage = riskPrefs.riskPercentage;
    const riskRewardStr = riskPrefs.riskRewardStr;
    const maxDailyRiskStr = riskPrefs.maxDailyRiskStr;

    console.log(`Trading Preferences Loaded\n`);
    console.log(`Account Size: $${accountSize}`);
    console.log(`Risk %: ${riskPercentage}%`);
    console.log(`Risk Reward: ${riskRewardStr}`);
    console.log(`Max Daily Risk: ${maxDailyRiskStr}`);
    console.log(`Strategy: ${strategyText ? strategyText.substring(0, 100) + '...' : 'N/A'}`);

    // 5. Parsed Strategy Loaded
    let parsed_strategy: any = null;
    if (watcher.strategy_id) {
      const { data: strategyRecord } = await supabase
        .from("strategies")
        .select("parsed_strategy")
        .eq("id", watcher.strategy_id)
        .maybeSingle();
      parsed_strategy = strategyRecord?.parsed_strategy;
    }
    console.log(`LOG: Parsed strategy loaded: ${!!parsed_strategy ? 'YES' : 'NO'}`);

    if (!parsed_strategy) throw new Error("Parsed strategy missing.");

    // 6. Candle Data Downloaded
    const symbol = watcher.selected_pair;
    const mappedSymbol = symbol; // Simplified for logging
    const selectedTimeframe = watcher.selected_timeframe || 'H1';
    const interval = '1h'; // Simplified

    const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(mappedSymbol)}&interval=${interval}&outputsize=20&apikey=${twelveDataKey}`;
    
    const tsRes = await fetch(timeSeriesUrl);
    const tsData = await tsRes.json();
    const candleData = tsData.values?.map((v: any) => ({
      timestamp: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close)
    })) || [];

    if (candleData.length < 2) throw new Error("Insufficient candle data.");
    console.log(`LOG: Candle data downloaded: YES (${candleData.length} candles)`);

    const scanStart = Date.now();

    const traceData: any = {
      watcherId: watcher.id,
      userId: userId,
      pair: symbol,
      timeframe: selectedTimeframe,
      currentCandleTime: candleData[candleData.length - 1]?.timestamp || '',
      closedCandleTime: candleData[candleData.length - 2]?.timestamp || '',
    };

    // 7. Extract Market Structure & Compile Strategy
    const marketStructure = extractMarketStructure(candleData);
    const compiledStrategy = parsed_strategy || compileStrategy(strategyText);

    // Stage 2
    const cleanSymUpper = (symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    const pipSize = (cleanSymUpper.includes('JPY') || cleanSymUpper.includes('XAU') || cleanSymUpper.includes('GOLD')) ? 0.01 : 0.0001;

    traceData.marketStructure = {
      trend: marketStructure.trend || 'SIDEWAYS',
      bos: (marketStructure.BOS && marketStructure.BOS.some((b: any) => b.type === 'BULLISH_BOS' || b.type === 'BEARISH_BOS')) ? 'YES' : 'NO',
      choch: (marketStructure.CHOCH && marketStructure.CHOCH.some((c: any) => c.type === 'BULLISH_CHOCH' || c.type === 'BEARISH_CHOCH')) ? 'YES' : 'NO',
      trendlineBreakout: ((marketStructure.breakouts && marketStructure.breakouts.some((b: any) => b.type === 'UPPER_BREAKOUT' || b.type === 'LOWER_BREAKOUT')) || (marketStructure.trendlines && marketStructure.trendlines.length > 0)) ? 'YES' : 'NO',
      liquiditySweep: (marketStructure.liquiditySweeps && marketStructure.liquiditySweeps.some((l: any) => l.type === 'HIGH_SWEEP' || l.type === 'LOW_SWEEP')) ? 'YES' : 'NO',
      support: (marketStructure.supportZones && marketStructure.supportZones.length > 0) ? 'YES' : 'NO',
      resistance: (marketStructure.resistanceZones && marketStructure.resistanceZones.length > 0) ? 'YES' : 'NO',
      volumeConfirmation: (marketStructure.volumeInformation?.volumeSpike) ? 'YES' : 'NO',
      confirmationCandle: (marketStructure.candlePatterns && marketStructure.candlePatterns.length > 0) ? 'YES' : 'NO',
      session: (() => {
        const lastCandle = candleData[candleData.length - 1];
        const date = lastCandle && lastCandle.timestamp ? new Date(lastCandle.timestamp) : new Date();
        const hour = date.getUTCHours();
        if (hour >= 8 && hour < 13) return "London";
        if (hour >= 13 && hour < 17) return "London / NY";
        if (hour >= 17 && hour < 21) return "NY";
        if (hour >= 0 && hour < 8) return "Asia";
        return "Asia";
      })(),
      atr: marketStructure.volatilityInformation?.atr?.toFixed(5) || '0.00000'
    };

    // Stage 3
    const compiledRulesList: string[] = [];
    const rules = compiledStrategy.compiled_rules || {};
    if (rules.trendline_breakout) compiledRulesList.push("Trendline Breakout");
    if (rules.break_and_retest) compiledRulesList.push("Break and Retest");
    if (rules.confirmation_candle) compiledRulesList.push("Confirmation Candle");
    if (rules.bos) compiledRulesList.push("Break of Structure (BOS)");
    if (rules.choch) compiledRulesList.push("Change of Character (CHoCH)");
    if (rules.liquidity_sweep) compiledRulesList.push("Liquidity Sweep");
    if (rules.fair_value_gap) compiledRulesList.push("Fair Value Gap (FVG)");
    if (rules.support) compiledRulesList.push("Support Zone");
    if (rules.resistance) compiledRulesList.push("Resistance Zone");
    if (rules.ema?.enabled) compiledRulesList.push(`EMA (Periods: ${rules.ema.periods?.join(', ')})`);
    if (rules.rsi?.enabled) compiledRulesList.push(`RSI (OB: ${rules.rsi.overbought || 70}, OS: ${rules.rsi.oversold || 30})`);
    if (rules.macd?.enabled) compiledRulesList.push("MACD");
    if (rules.atr?.enabled) compiledRulesList.push("ATR");
    if (rules.volume_confirmation) compiledRulesList.push("Volume Confirmation");
    if (rules.session && rules.session.length > 0) compiledRulesList.push(`Session Filter: ${rules.session.join(', ')}`);
    if (rules.timeframes && rules.timeframes.length > 0) compiledRulesList.push(`Timeframes: ${rules.timeframes.join(', ')}`);
    if (rules.risk_reward?.min_ratio) compiledRulesList.push(`Min Risk Reward: ${rules.risk_reward.min_ratio}`);

    traceData.strategyCompiler = {
      strategyMode: compiledStrategy.strategy_mode || 'HYBRID',
      compiledRules: compiledRulesList,
      overallConfidence: `${compiledStrategy.overall_confidence || compiledStrategy.confidence || 0}%`,
      matchedPhrases: compiledStrategy.matched_phrases || [],
      canonicalRules: compiledStrategy.canonical_rules || []
    };

    // 8. Weighted Decision Engine Execution
    const decisionResult = evaluateDecision(compiledStrategy, marketStructure);

    // Stage 4
    traceData.decisionEngine = {
      decisionScore: `${decisionResult.matched_weight} / ${decisionResult.possible_weight} (${(decisionResult.decision_score * 100).toFixed(1)}%)`,
      recommendation: decisionResult.recommendation,
      mandatoryRulesPassed: decisionResult.mandatory_rules_passed ? 'YES' : 'NO',
      matchedRules: decisionResult.matched_rules || [],
      failedRules: decisionResult.failed_rules || [],
      geminiRequired: decisionResult.requires_gemini ? 'YES' : 'NO'
    };

    let analysis: any = {
      signal: 'NO_TRADE',
      confidence: 0,
      entryPrice: null,
      stopLoss: null,
      takeProfit: null,
      riskReward: null,
      reasoning: []
    };

    let geminiCalled = false;
    let geminiTextResult = "";
    let geminiStart = 0;
    let geminiDuration = 0;

    const recommendation = decisionResult.recommendation; // PASS, LIKELY_PASS, AMBIGUOUS, FAIL

    if (recommendation === 'FAIL') {
      console.log(`[Decision Engine Failed] Watcher ID: ${watcher.id} (${symbol}) recommendation is FAIL. Stopping execution. Gemini NOT called.`);
      analysis.reasoning = [decisionResult.explanation];

      // Stage 5
      traceData.gemini = {
        called: 'NO',
        duration: '0 ms',
        promptSent: 'N/A',
        rawResponse: 'N/A',
        parsedSatisfaction: 'N/A',
        parsedConfidence: 'N/A',
        parsedDirection: 'N/A'
      };

      // Stage 6
      traceData.riskEngine = {
        accountSize: `$${accountSize.toFixed(2)}`,
        riskPercentage: `${riskPercentage}%`,
        riskAmount: `$${(accountSize * riskPercentage / 100).toFixed(2)}`,
        stopLossDistance: '0.0 pips / 0.00%',
        takeProfitDistance: '0.0 pips / 0.00%',
        calculatedLotSize: '0.0',
        lotType: 'Micro Lot',
        accepted: 'NO',
        rejectionReason: `Decision Engine recommendation is FAIL`
      };

      // Stage 7
      traceData.telegram = {
        sent: 'NO',
        chatId: 'N/A (Manual Scan)',
        message: 'N/A (Manual Scan)'
      };

      traceData.complete = {
        status: 'SUCCESS',
        duration: `${Date.now() - scanStart} ms`,
        timestamp: new Date().toISOString()
      };

      logPipelineTrace(traceData);
    } else {
      // Check if Gemini is required based on Decision Engine requires_gemini
      const requiresGemini = decisionResult.requires_gemini;
      
      if (requiresGemini) {
        console.log("GEMINI CALLED");
        geminiCalled = true;
        geminiStart = Date.now();
        try {
          const geminiKey = process.env.GEMINI_API_KEY;
          if (geminiKey) {
            const ai = new GoogleGenAI({ apiKey: geminiKey });
            const promptText = `
You are an expert AI trading assistant.
Evaluate whether the following market conditions and indicators satisfy the user's trading strategy.

Rule Engine Indicators:
- Trend: ${marketStructure.trend}
- EMA Trend Aligned: YES
- ATR Volatility: ${marketStructure.volatilityInformation.atr.toFixed(5)}
- Market Session: London/New York Active
- Support Proximity: Near Support
- Resistance Proximity: Neutral
- Trendline Breakout: ${marketStructure.breakouts.length > 0 ? 'Breakout Detected' : 'No breakout'}
- Volume Confirmation: ${marketStructure.volumeInformation.volumeSpike ? 'Confirmed' : 'Normal'}
- Recent Candles: ${JSON.stringify(candleData.slice(-5), null, 2)}

User's Trading Strategy:
${strategyText}

Does this satisfy the user's strategy?
Answer with JSON containing:
- satisfies (boolean)
- direction ('BUY' | 'SELL' | 'NO_TRADE')
- confidenceScore (number 0-100)
- reasoning (string)
`;
            const aiResponse = await generateContentWithDiagnostics(ai, {
              model: "gemini-2.5-flash",
              contents: promptText,
              config: {
                responseMimeType: "application/json",
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    satisfies: { type: Type.BOOLEAN },
                    direction: { type: Type.STRING },
                    confidenceScore: { type: Type.NUMBER },
                    reasoning: { type: Type.STRING }
                  },
                  required: ["satisfies", "direction", "confidenceScore", "reasoning"]
                }
              }
            });
            geminiDuration = Date.now() - geminiStart;
            geminiTextResult = aiResponse.text || "";
            const parsedResult = JSON.parse(geminiTextResult);

            // Stage 5
            traceData.gemini = {
              called: 'YES',
              duration: `${geminiDuration} ms`,
              promptSent: promptText || 'N/A',
              rawResponse: geminiTextResult || 'N/A',
              parsedSatisfaction: parsedResult.satisfies ? 'YES' : 'NO',
              parsedConfidence: String(parsedResult.confidenceScore || 0),
              parsedDirection: parsedResult.direction || 'NO_TRADE'
            };

            if (parsedResult.satisfies && parsedResult.direction && parsedResult.direction !== 'NO_TRADE') {
              const entry = candleData[candleData.length - 1].close;
              const atrVal = marketStructure.volatilityInformation.atr && marketStructure.volatilityInformation.atr > 0 ? marketStructure.volatilityInformation.atr : entry * 0.005;
              const sl = parsedResult.direction === 'BUY' ? entry - (atrVal * 1.5) : entry + (atrVal * 1.5);
              analysis = {
                signal: parsedResult.direction,
                confidence: parsedResult.confidenceScore || 85,
                entryPrice: entry,
                stopLoss: sl,
                takeProfit: null,
                riskReward: riskRewardStr,
                reasoning: [parsedResult.reasoning || "Satisfies strategy rules and Gemini validation."]
              };
            }
          }
        } catch (gemErr: any) {
          console.warn(`[Gemini Validation Warning]: Falling back to local strategy engine:`, gemErr.message);

          traceData.gemini = {
            called: 'YES',
            duration: `${Date.now() - geminiStart} ms`,
            promptSent: 'See Prompt in logs',
            rawResponse: `Error: ${gemErr.message}`,
            parsedSatisfaction: 'NO',
            parsedConfidence: '0',
            parsedDirection: 'NO_TRADE'
          };

          const localAnalysis = analyzeMarket(candleData, compiledStrategy);
          analysis = localAnalysis;
          if (geminiStart > 0) {
            geminiDuration = Date.now() - geminiStart;
          }
        }
      } else {
        // Gemini NOT required! Fallback to local strategy engine (since recommendation is PASS)
        console.log(`[Decision Engine] Recommendation is PASS. Skipping Gemini as requires_gemini is false.`);

        // Stage 5
        traceData.gemini = {
          called: 'NO',
          duration: '0 ms',
          promptSent: 'N/A',
          rawResponse: 'N/A',
          parsedSatisfaction: 'N/A',
          parsedConfidence: 'N/A',
          parsedDirection: 'N/A'
        };

        const localAnalysis = analyzeMarket(candleData, compiledStrategy);
        analysis = localAnalysis;
      }
    }

    // 9. Signal Result & Risk Engine
    console.log(`LOG: Signal result: ${analysis.signal}`);

    let riskResult = { accepted: false, skipReason: "No trade setup" };

    if (analysis.signal !== 'NO_TRADE' && analysis.confidence >= 70) {
      const executedPrice = Number(candleData[candleData.length - 1]?.close) || Number(analysis.entryPrice) || 0;
      const posSizeResult = calculatePositionSize({
        accountSize: accountSize,
        riskPercentage: riskPercentage,
        entryPrice: Number(analysis.entryPrice) || 0,
        executedEntry: executedPrice,
        stopLoss: Number(analysis.stopLoss) || 0,
        geminiTp: analysis.takeProfit ? Number(analysis.takeProfit) : null,
        symbol: symbol,
        direction: analysis.signal,
        riskRewardStr: riskRewardStr
      });
      logPositionSizeAudit(posSizeResult, prefsRecord?.updated_at || prefsRecord?.created_at || 'N/A');
      riskResult = {
        accepted: posSizeResult.accepted,
        skipReason: posSizeResult.skipReason
      };

      // Stage 6
      const stopDistance = Math.abs(executedPrice - (Number(analysis.stopLoss) || 0));
      const tpDistance = Math.abs((Number(posSizeResult.takeProfit) || Number(analysis.takeProfit) || executedPrice * 1.01) - executedPrice);
      const slDistancePips = stopDistance / pipSize;
      const slDistancePct = (stopDistance / executedPrice) * 100;
      const tpDistancePips = tpDistance / pipSize;
      const tpDistancePct = (tpDistance / executedPrice) * 100;

      traceData.riskEngine = {
        accountSize: `$${accountSize.toFixed(2)}`,
        riskPercentage: `${riskPercentage}%`,
        riskAmount: `$${posSizeResult.riskAmount.toFixed(2)}`,
        stopLossDistance: `${slDistancePips.toFixed(1)} pips / ${slDistancePct.toFixed(2)}%`,
        takeProfitDistance: `${tpDistancePips.toFixed(1)} pips / ${tpDistancePct.toFixed(2)}%`,
        calculatedLotSize: String(posSizeResult.calculatedLotSize),
        lotType: posSizeResult.lotType,
        accepted: posSizeResult.accepted ? 'YES' : 'NO',
        rejectionReason: posSizeResult.skipReason || 'None'
      };

      analysis.entryPrice = posSizeResult.entryPrice;
      analysis.stopLoss = posSizeResult.stopLoss;
      analysis.takeProfit = posSizeResult.takeProfit;
      analysis.riskReward = parseRiskRewardRatio(riskRewardStr);
      (analysis as any).riskRewardStr = riskRewardStr;
      (analysis as any).accepted = posSizeResult.accepted;
      (analysis as any).skipReason = posSizeResult.skipReason;
      (analysis as any).lotSize = posSizeResult.calculatedLotSize;
      (analysis as any).riskAmount = posSizeResult.riskAmount;
      (analysis as any).expectedLoss = posSizeResult.expectedLoss;
      (analysis as any).expectedProfit = posSizeResult.expectedProfit;
      (analysis as any).lotType = posSizeResult.lotType;

      if (!posSizeResult.accepted) {
        console.log(`[Risk Validation Failed - Trade Skipped] ${posSizeResult.skipReason}`);
        analysis.signal = 'NO_TRADE';
      }
    } else {
      // Stage 6 (No trade setup)
      if (recommendation !== 'FAIL') {
        traceData.riskEngine = {
          accountSize: `$${accountSize.toFixed(2)}`,
          riskPercentage: `${riskPercentage}%`,
          riskAmount: `$${(accountSize * riskPercentage / 100).toFixed(2)}`,
          stopLossDistance: '0.0 pips / 0.00%',
          takeProfitDistance: '0.0 pips / 0.00%',
          calculatedLotSize: '0.0',
          lotType: 'Micro Lot',
          accepted: 'NO',
          rejectionReason: `No trade setup: signal is ${analysis.signal} and confidence is ${analysis.confidence}%`
        };
      }
    }

    // 10. Telegram Send Decision (No actual telegram sending in manual scan)
    const shouldSend = analysis.signal !== 'NO_TRADE' && analysis.confidence >= 70;
    console.log(`LOG: Telegram send decision: ${shouldSend ? 'YES' : 'NO'}`);

    traceData.telegram = {
      sent: 'NO',
      chatId: 'N/A (Manual Scan)',
      message: 'N/A (Manual Scan)'
    };

    const scanDurationMs = Date.now() - scanStart;

    traceData.complete = {
      status: 'SUCCESS',
      duration: `${scanDurationMs} ms`,
      timestamp: new Date().toISOString()
    };

    if (recommendation !== 'FAIL') {
      logPipelineTrace(traceData);
    }

    // 11. Store evaluation record in the Explainability Engine
    try {
      await recordEvaluation(supabase, {
        user_id: userId,
        watcher_id: watcher.id,
        pair: symbol,
        timeframe: selectedTimeframe,
        strategy_mode: compiledStrategy.strategy_mode,
        decision_score: decisionResult.decision_score,
        matched_weight: decisionResult.matched_weight,
        possible_weight: decisionResult.possible_weight,
        recommendation: decisionResult.recommendation,
        mandatory_rules_passed: decisionResult.mandatory_rules_passed,
        matched_rules: decisionResult.matched_rules,
        failed_rules: decisionResult.failed_rules,
        gemini_used: geminiCalled,
        gemini_result: geminiTextResult || null,
        trade_sent: false, // Manual scan doesn't send real alerts
        trade_reason: "Manual scan completed: " + (analysis.signal !== 'NO_TRADE' ? `Setup found (${analysis.signal})` : (riskResult.skipReason || "No setup found")),
        scan_duration_ms: scanDurationMs,
        gemini_duration_ms: geminiDuration
      });
    } catch (evalErr) {
      console.warn(`[Explainability Engine Warning] Failed to log scan evaluation:`, evalErr);
    }

    console.log("LOG: Manual scan completed");
    return res.json({ success: true, analysis });

  } catch (err: any) {
    console.error("LOG FATAL ERROR: Manual scan failed");
    console.error(`Exception: ${err.message}`);
    console.error(`Stack: ${err.stack}`);
    return res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
}

