import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI, Type } from '@google/genai';

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
        return s.id === targetId;
      }) || parsed.strategies[0];
      return active ? (active.text || DEFAULT_STRATEGY_TEXT) : DEFAULT_STRATEGY_TEXT;
    }
  } catch (e) {
    // Not JSON
  }
  return strategyTextRaw;
}

async function sendTelegramMessage(chatId: string | number, text: string) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;

  const url = `https://api.telegram.org/bot${token}/sendMessage`;
  try {
    await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown" })
    });
  } catch (err) {
    console.error("Error sending Telegram message:", err);
  }
}

async function getLivePrice(symbol: string): Promise<number> {
  try {
    const res = await fetch("https://open.er-api.com/v6/latest/USD");
    if (res.ok) {
      const data = await res.json();
      if (data && data.rates) {
        const rates = data.rates;
        const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, '');
        if (normalized === 'EURUSD') return 1 / (rates['EUR'] || 0.92);
        if (normalized === 'GBPUSD') return 1 / (rates['GBP'] || 0.78);
        if (normalized === 'USDJPY') return rates['JPY'] || 156;
        if (normalized === 'USDCAD') return rates['CAD'] || 1.36;
        if (normalized === 'AUDUSD') return 1 / (rates['AUD'] || 1.51);
        if (normalized === 'NZDUSD') return 1 / (rates['NZD'] || 1.63);
        if (normalized === 'USDCHF') return rates['CHF'] || 0.89;
      }
    }
  } catch (e) {
    console.error("Failed to fetch rates, using fallback:", e);
  }
  
  const normalized = symbol.toUpperCase().replace(/[^A-Z]/g, '');
  if (normalized === 'EURUSD') return 1.0850;
  if (normalized === 'GBPUSD') return 1.2750;
  if (normalized === 'USDJPY') return 156.40;
  if (normalized === 'USDCAD') return 1.3650;
  if (normalized === 'AUDUSD') return 0.6650;
  if (normalized === 'NZDUSD') return 0.6120;
  if (normalized === 'USDCHF') return 0.8955;
  return 1.0;
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
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return res.status(401).json({ success: false, error: "Unauthorized: Invalid authentication token." });
    }
    
    const email = user.email?.trim().toLowerCase();
    const ADMIN_EMAIL = "gaks6535@gmail.com";
    if (email !== ADMIN_EMAIL) {
      return res.status(403).json({ success: false, error: "Unauthorized: Insufficient privileges." });
    }

    const { watcherId, action } = req.body;
    if (!action) {
      return res.status(400).json({ success: false, error: "Missing required field: action." });
    }
    if (action !== 'add_pair' && !watcherId) {
      return res.status(400).json({ success: false, error: "Missing required field: watcherId." });
    }

    if (action === 'add_pair') {
      const { email, symbol, timeframe } = req.body;
      if (!email || !symbol || !timeframe) {
        return res.status(400).json({ success: false, error: "Missing email, symbol, or timeframe." });
      }

      // Query profiles by email
      const { data: profile, error: pErr } = await supabase
        .from('profiles')
        .select('*')
        .eq('email', email.trim().toLowerCase())
        .maybeSingle();

      if (pErr || !profile) {
        return res.status(404).json({ success: false, error: `No registered profile found with email "${email}".` });
      }

      const userId = profile.id;
      const nowString = new Date().toISOString();

      // Ensure default trading preferences exist so strategy text doesn't fail
      const { data: prefs } = await supabase.from('trading_preferences').select('*').eq('user_id', userId).maybeSingle();
      if (!prefs) {
        await supabase.from('trading_preferences').insert({
          user_id: userId,
          strategy_text: '• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules',
          capital: '$10,000',
          preferred_risk: '1%'
        });
      }

      // Ensure basic telegram connection record is present
      const { data: tgConn } = await supabase.from('telegram_connections').select('*').eq('user_id', userId).maybeSingle();
      if (!tgConn) {
        await supabase.from('telegram_connections').insert({
          user_id: userId,
          connected: false
        });
      }

      // Now insert or update the watcher for this user and pair
      const { data: existingWatcher } = await supabase
        .from("watchers")
        .select("id")
        .eq("user_id", userId)
        .eq("selected_pair", symbol.toUpperCase())
        .maybeSingle();

      if (existingWatcher) {
        await supabase
          .from("watchers")
          .update({
            status: "active",
            selected_timeframe: timeframe,
            started_at: nowString,
            updated_at: nowString
          })
          .eq("id", existingWatcher.id);
      } else {
        await supabase
          .from("watchers")
          .insert({
            user_id: userId,
            status: "active",
            selected_pair: symbol.toUpperCase(),
            selected_timeframe: timeframe,
            started_at: nowString,
            updated_at: nowString
          });
      }

      return res.status(200).json({ success: true, message: `Watcher for ${symbol} (${timeframe}) successfully added for ${email}!` });
    }

    if (action === 'restart') {
      await supabase.from('watchers').update({ status: 'active', started_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', watcherId);
      return res.status(200).json({ success: true, message: "Watcher restarted successfully." });
    } else if (action === 'stop') {
      await supabase.from('watchers').update({ status: 'stopped', stopped_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('id', watcherId);
      return res.status(200).json({ success: true, message: "Watcher stopped successfully." });
    } else if (action === 'delete') {
      await supabase.from('watchers').delete().eq('id', watcherId);
      return res.status(200).json({ success: true, message: "Watcher deleted successfully." });
    } else if (action === 'force_scan') {
      const { data: watcher, error: wErr } = await supabase.from('watchers').select('*').eq('id', watcherId).maybeSingle();
      if (wErr || !watcher) {
        return res.status(404).json({ success: false, error: "Watcher not found." });
      }
      
      const userId = watcher.user_id;
      
      const { data: keyRec } = await supabase.from('user_api_keys').select('*').eq('user_id', userId).eq('provider', 'gemini').maybeSingle();
      const geminiKey = keyRec?.api_key || process.env.GEMINI_API_KEY;
      
      if (!geminiKey) {
        return res.status(400).json({ success: false, error: "Gemini API key is not configured for this user or server." });
      }
      
      const { data: prefsRecord } = await supabase.from('trading_preferences').select('*').eq('user_id', userId).maybeSingle();
      const strategyTextRaw = prefsRecord?.strategy_text || '';
      const strategyText = extractStrategyTextById(strategyTextRaw, watcher.strategy_id);
      
      let collectedData: Record<string, any> = {};
      const twelveDataKey = process.env.TWELVE_DATA_API_KEY;
      const symbol = watcher.selected_pair || 'EURUSD';
      
      if (twelveDataKey) {
        try {
          const mappedSymbol = symbol.length === 6 ? `${symbol.slice(0, 3)}/${symbol.slice(3)}` : symbol;
          const response = await fetch(`https://api.twelvedata.com/quote?symbol=${encodeURIComponent(mappedSymbol)}&apikey=${twelveDataKey}`);
          if (response.ok) {
            const quoteData = await response.json();
            if (quoteData && !quoteData.error && quoteData.close) {
              const currentPrice = parseFloat(quoteData.close);
              collectedData[symbol] = {
                current_price: currentPrice,
                open: parseFloat(quoteData.open || "0") || currentPrice,
                high: parseFloat(quoteData.high || "0") || currentPrice,
                low: parseFloat(quoteData.low || "0") || currentPrice,
                close: currentPrice,
                bid: quoteData.bid ? parseFloat(quoteData.bid) : currentPrice * 0.9999,
                ask: quoteData.ask ? parseFloat(quoteData.ask) : currentPrice * 1.0001,
                volume: parseFloat(quoteData.volume || "0"),
                timestamp: quoteData.timestamp || Math.floor(Date.now() / 1000)
              };
            }
          }
        } catch (e) {
          console.error("Twelve data fetch failed in Vercel force scan, falling back:", e);
        }
      }
      
      if (Object.keys(collectedData).length === 0) {
        const price = await getLivePrice(symbol);
        collectedData[symbol] = {
          current_price: price,
          open: price * 0.998,
          high: price * 1.002,
          low: price * 0.997,
          close: price,
          bid: price * 0.9999,
          ask: price * 1.0001,
          volume: 152000,
          timestamp: Math.floor(Date.now() / 1000)
        };
      }
      
      const accountSize = watcher.account_size || 1000;
      const riskPercentage = watcher.risk_percentage || 1;
      
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const promptText = `
You are an expert AI trading assistant.
Analyze the following live market data against the user's trading strategy.
Return a structured JSON list of trading signals. Only generate a signal if the setup strongly matches the strategy.
If no valid setups are found, return an empty array for signals.

User's Trading Strategy:
${strategyText}

Account Size: $${accountSize}
Risk Percentage per trade: ${riskPercentage}%

Live Market Data:
${JSON.stringify(collectedData, null, 2)}
`;

      const aiResponse = await ai.models.generateContent({
        model: "gemini-2.5-flash",
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

      const parsedResult = JSON.parse(aiResponse.text || '{"signals": []}');
      const signals = parsedResult.signals || [];
      let signalsSent = 0;
      
      if (signals.length > 0) {
        for (const sig of signals) {
          await supabase.from("signals").insert({
            user_id: userId,
            pair: sig.pair,
            signal_type: sig.direction,
            confidence: sig.confidenceScore,
            delivery_status: watcher.telegram_chat_id ? "delivered" : "no_telegram"
          });
          
          if (watcher.telegram_chat_id && sig.confidenceScore >= 70) {
            const alertMessage = `🚨 *Force Scan Trading Alert* 🚨\n\n` +
              `*Pair:* ${sig.pair}\n` +
              `*Direction:* ${sig.direction === 'BUY' ? '🟢 BUY' : '🔴 SELL'}\n` +
              `*Entry Price:* ${sig.entryPrice}\n` +
              `*Stop Loss:* ${sig.stopLoss}\n` +
              `*Take Profit:* ${sig.takeProfit}\n` +
              `*Risk/Reward:* ${sig.riskRewardRatio}\n` +
              `*Confidence:* ${sig.confidenceScore}/100\n\n` +
              `*AI Reasoning:* ${sig.aiReasoning}`;
              
            await sendTelegramMessage(watcher.telegram_chat_id, alertMessage);
            signalsSent++;
          }
        }
      }
      
      await supabase.from("watchers").update({
        last_scan_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }).eq("id", watcherId);
      
      return res.status(200).json({
        success: true,
        message: `Force scan complete! Scanned ${symbol}. Signals found: ${signals.length}, Sent to Telegram: ${signalsSent}.`,
        signals: signals
      });
    }

    return res.status(400).json({ success: false, error: "Invalid action type." });
  } catch (err: any) {
    console.error("Failed executing watcher action:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
}
