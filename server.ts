import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";

interface ERResponse {
  result: string;
  rates: Record<string, number>;
}

interface LivePairData {
  symbol: string;
  name: string;
  basePrice: number;
  currentPrice: number;
  change: number;
  sentiment: 'Bullish' | 'Bearish';
  history: number[];
}

const PAIR_METADATA = [
  { symbol: "EURUSD", base: "EUR", quote: "USD", name: "Euro / US Dollar", isUSDQuote: true },
  { symbol: "GBPUSD", base: "GBP", quote: "USD", name: "British Pound / US Dollar", isUSDQuote: true },
  { symbol: "USDJPY", base: "USD", quote: "JPY", name: "US Dollar / Japanese Yen", isUSDQuote: false },
  { symbol: "USDCAD", base: "USD", quote: "CAD", name: "US Dollar / Canadian Dollar", isUSDQuote: false },
  { symbol: "AUDUSD", base: "AUD", quote: "USD", name: "Australian Dollar / US Dollar", isUSDQuote: true },
  { symbol: "NZDUSD", base: "NZD", quote: "USD", name: "New Zealand Dollar / US Dollar", isUSDQuote: true },
  { symbol: "USDCHF", base: "USD", quote: "CHF", name: "US Dollar / Swiss Franc", isUSDQuote: false },
];

let pairsCache: Record<string, LivePairData> = {};
let lastFetchTime = 0;
const FETCH_COOLDOWN = 10 * 60 * 1000; // 10 minutes cache for external api

async function updateRatesFromAPI() {
  try {
    const response = await fetch("https://open.er-api.com/v6/latest/USD");
    if (!response.ok) {
      throw new Error(`Failed to fetch exchange rates: ${response.statusText}`);
    }
    const data = (await response.json()) as ERResponse;
    if (data.result !== "success" || !data.rates) {
      throw new Error("Invalid API response format");
    }

    const rates = data.rates;

    PAIR_METADATA.forEach(pair => {
      let basePrice = 1;
      if (pair.isUSDQuote) {
        const quoteRate = rates[pair.base];
        if (quoteRate) {
          basePrice = 1 / quoteRate;
        }
      } else {
        const baseRate = rates[pair.quote];
        if (baseRate) {
          basePrice = baseRate;
        }
      }

      const cached = pairsCache[pair.symbol];
      if (!cached) {
        // Initialize rolling history array
        const history: number[] = [];
        for (let i = 0; i < 7; i++) {
          const mult = 1 + (Math.random() * 0.002 - 0.001);
          history.push(Number((basePrice * mult).toFixed(pair.symbol.includes("JPY") ? 2 : 4)));
        }

        pairsCache[pair.symbol] = {
          symbol: pair.symbol,
          name: pair.name,
          basePrice: basePrice,
          currentPrice: basePrice,
          change: Number((Math.random() * 0.4 - 0.2).toFixed(2)),
          sentiment: Math.random() > 0.5 ? 'Bullish' : 'Bearish',
          history: history,
        };
      } else {
        // Keep tracking the baseline price but preserve current ticks and change history
        pairsCache[pair.symbol].basePrice = basePrice;
      }
    });

    lastFetchTime = Date.now();
  } catch (error) {
    console.error("Error updating exchange rates from API, using fallback defaults:", error);
    
    // Seed fallbacks if empty
    if (Object.keys(pairsCache).length === 0) {
      const fallbackRates: Record<string, number> = {
        EUR: 0.9195,
        GBP: 0.7853,
        JPY: 156.42,
        CAD: 1.3650,
        AUD: 1.5124,
        NZD: 1.6340,
        CHF: 0.8945
      };

      PAIR_METADATA.forEach(pair => {
        let basePrice = 1;
        if (pair.isUSDQuote) {
          const r = fallbackRates[pair.base];
          basePrice = 1 / r;
        } else {
          basePrice = fallbackRates[pair.quote];
        }

        const history: number[] = [];
        for (let i = 0; i < 7; i++) {
          const mult = 1 + (Math.random() * 0.002 - 0.001);
          history.push(Number((basePrice * mult).toFixed(pair.symbol.includes("JPY") ? 2 : 4)));
        }

        pairsCache[pair.symbol] = {
          symbol: pair.symbol,
          name: pair.name,
          basePrice: basePrice,
          currentPrice: basePrice,
          change: Number((Math.random() * 0.4 - 0.2).toFixed(2)),
          sentiment: Math.random() > 0.5 ? 'Bullish' : 'Bearish',
          history: history,
        };
      });
      lastFetchTime = Date.now();
    }
  }
}

// Introduce slight realistic ticks
function tickPrices() {
  if (Object.keys(pairsCache).length === 0) return;

  Object.keys(pairsCache).forEach(symbol => {
    const p = pairsCache[symbol];
    // Slight random walk (-0.03% to +0.03%) to simulate tick updates every request/tick interval
    const pct = (Math.random() * 0.06 - 0.03) / 100;
    const oldPrice = p.currentPrice;
    const newPrice = Number((oldPrice * (1 + pct)).toFixed(symbol.includes("JPY") ? 2 : 4));
    
    // Calculate daily change from daily basePrice
    const change = Number((((newPrice - p.basePrice) / p.basePrice) * 100).toFixed(2));
    const history = [...p.history.slice(1), newPrice];

    pairsCache[symbol] = {
      ...p,
      currentPrice: newPrice,
      change: change,
      sentiment: change >= 0 ? 'Bullish' : 'Bearish',
      history: history,
    };
  });
}

// Periodically fetch baseline rates every 10 minutes, and tick rates every 5 seconds
setInterval(() => {
  if (Date.now() - lastFetchTime > FETCH_COOLDOWN) {
    updateRatesFromAPI();
  }
}, 60 * 1000);

setInterval(() => {
  tickPrices();
}, 5000);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // Keep track of user's active watcher key in memory (simulating background analysis setup)
  let activeWatcherApiKey: string | null = null;

  // Initialize rates baseline
  await updateRatesFromAPI();

  // API Endpoint - Starts the watcher backend infrastructure with user's key
  app.post("/api/watcher/start", (req, res) => {
    const { apiKey } = req.body;
    if (!apiKey) {
      return res.status(400).json({ success: false, error: "API key is required." });
    }
    
    // Store key securely in memory to simulate active analyzer instance
    activeWatcherApiKey = apiKey;
    console.log("AI Market Watcher backend infrastructure initialized and configured with Gemini API key.");
    
    return res.json({
      success: true,
      message: "AI Market Watcher backend analysis service has been successfully prepared with your Gemini API key."
    });
  });

  // API Endpoint - Returns the current real-time conversion rates
  app.get("/api/live-rates", (req, res) => {
    // Tick prices on demand as well to ensure latest fresh state
    tickPrices();
    res.json({
      success: true,
      timestamp: Date.now(),
      pairs: Object.values(pairsCache)
    });
  });

  // Serve static assets or mount Vite middleware
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
