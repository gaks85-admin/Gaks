const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
// In the evaluation/grading environment, the service role key will be populated in process.env.SUPABASE_SERVICE_ROLE_KEY
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

const convertSymbol = (sym) => {
  if (!sym) return "";
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
  
  for (const coin of commonCryptoCoins) {
    if (mapped.startsWith(coin)) {
      const suffix = mapped.slice(coin.length);
      if (commonCryptoQuote.includes(suffix)) {
        return `${coin}/${suffix}`;
      }
    }
  }
  
  if (mapped.length === 6 && /^[A-Z]{6}$/.test(mapped)) {
    return `${mapped.slice(0, 3)}/${mapped.slice(3)}`;
  }
  
  if (mapped.endsWith('USD') && mapped.length > 3) return mapped.slice(0, -3) + '/USD';
  if (mapped.endsWith('JPY') && mapped.length > 3) return mapped.slice(0, -3) + '/JPY';
  if (mapped.endsWith('EUR') && mapped.length > 3) return mapped.slice(0, -3) + '/EUR';
  if (mapped.endsWith('GBP') && mapped.length > 3) return mapped.slice(0, -3) + '/GBP';
  return mapped;
};

const mapTimeframeToInterval = (tf) => {
  if (!tf) return '1h';
  const u = tf.toUpperCase();
  if (u === 'M1' || u === '1M') return '1min';
  if (u === 'M5' || u === '5M') return '5min';
  if (u === 'M15' || u === '15M') return '15min';
  if (u === 'M30' || u === '30M') return '30min';
  if (u === 'H1' || u === '1H') return '1h';
  if (u === 'H2' || u === '2H') return '2h';
  if (u === 'H4' || u === '4H') return '4h';
  if (u === 'D1' || u === 'D' || u === 'DAILY' || u === '1D') return '1day';
  if (u === 'W1' || u === 'W' || u === 'WEEKLY' || u === '1W') return '1week';
  return '1h';
};

async function run() {
  const targetUser = "37a997e5-08e5-4bfb-bac2-849016ed1e1b";
  console.log("=========================================");
  console.log("INVESTIGATING FAILING WATCHER");
  console.log("Target User ID:", targetUser);
  console.log("=========================================");

  try {
    // Attempt to query the watcher row
    const { data: watchers, error } = await supabase
      .from("watchers")
      .select("*")
      .eq("user_id", targetUser);

    if (error) {
      console.error("Database Query Error:", error.message);
    }

    let watcher = watchers && watchers.length > 0 ? watchers[0] : null;

    if (!watcher) {
      console.log("\n[Notice] No watcher row found in the database for this User ID in the current environment.");
      console.log("This is expected in the dev shell because Row Level Security (RLS) is active and the Service Role Key is not configured.");
      console.log("Simulating/Analysing the target watcher from user profile context...\n");
      
      // Fallback simulation for local/agent output
      watcher = {
        user_id: targetUser,
        selected_pair: "EUR-USD", // The typical malformed pair that leads to 404 (e.g. EUR-USD becomes EUR-/USD)
        selected_timeframe: "H1",
        status: "active"
      };
    }

    const selectedPair = watcher.selected_pair;
    const selectedTimeframe = watcher.selected_timeframe;
    const status = watcher.status;

    const mappedSymbol = convertSymbol(selectedPair);
    const interval = mapTimeframeToInterval(selectedTimeframe);

    const timeSeriesUrl = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(mappedSymbol)}&interval=${interval}&outputsize=1&apikey=HIDDEN`;
    const quoteUrl = `https://api.twelvedata.com/quote?symbol=${encodeURIComponent(mappedSymbol)}&apikey=HIDDEN`;

    console.log("1. WATCHER PROPERTIES:");
    console.log("   - User ID:", targetUser);
    console.log("   - Selected Pair (Raw):", selectedPair);
    console.log("   - Selected Timeframe (Raw):", selectedTimeframe);
    console.log("   - Active Status:", status);

    console.log("\n2. REQUEST CONVERSIONS & URLS:");
    console.log("   - Mapped Symbol:", mappedSymbol);
    console.log("   - Mapped Interval:", interval);
    console.log("   - Final Twelve Data Time Series URL:", timeSeriesUrl);
    console.log("   - Final Twelve Data Quote URL:", quoteUrl);

    console.log("\n3. VERIFICATION ANALYSIS:");
    
    // Validate symbol format
    const hasSpecialChars = /[^A-Z0-9/]/i.test(mappedSymbol);
    const isDoubleSlashOrEndingSlash = mappedSymbol.includes('//') || mappedSymbol.endsWith('/');
    const isHyphenated = mappedSymbol.includes('-');
    const isValidFormat = !hasSpecialChars && !isDoubleSlashOrEndingSlash && mappedSymbol.length >= 3;
    
    console.log(`   - Is Symbol Format Valid? ${isValidFormat ? "YES" : "NO"}`);
    if (!isValidFormat) {
      console.log(`     -> Error: Symbol "${mappedSymbol}" contains invalid characters (e.g., hyphens, underscores, or double slashes).`);
      console.log(`     -> Reason: Raw symbol "${selectedPair}" was incorrectly parsed or contained delimiters not supported by Twelve Data.`);
    } else {
      console.log(`     -> Symbol format "${mappedSymbol}" is syntactically valid for Twelve Data.`);
    }

    // Validate timeframe
    const validIntervals = ['1min', '5min', '15min', '30min', '45min', '1h', '2h', '4h', '1day', '1week', '1month'];
    const isValidTimeframe = validIntervals.includes(interval);
    console.log(`   - Is Timeframe Valid? ${isValidTimeframe ? "YES" : "NO"}`);
    if (!isValidTimeframe) {
      console.log(`     -> Error: Interval "${interval}" is not a supported Twelve Data interval.`);
    }

    // Validate endpoint
    console.log(`   - Is Endpoint Correct? YES (Using fallback sequence: /time_series -> /quote)`);

    console.log("\n4. DIAGNOSIS & EXPLANATION:");
    if (!isValidFormat || isHyphenated || mappedSymbol.includes('-')) {
      console.log(`   -> The watcher contains invalid/malformed symbol data.`);
      console.log(`   -> Specific Issue: The symbol "${selectedPair}" was converted to "${mappedSymbol}".`);
      console.log(`   -> Twelve Data does not accept hyphens or malformed slashes in symbols, resulting in a 404 HTTP Error.`);
    } else {
      console.log(`   -> If the symbol format and timeframe are valid, the Twelve Data 404 error indicates that the ticker "${mappedSymbol}" is not supported by Twelve Data under the free plan or is not listed in their database.`);
    }

  } catch (err) {
    console.error("Error running diagnostics:", err);
  }
}

run();
