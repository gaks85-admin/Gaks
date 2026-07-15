
const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function testQuery() {
  console.log("Fetching all watchers...");
  const { data: allWatchers, error: allError } = await supabase.from("watchers").select("*");
  console.log("Total watchers count (watchers table):", allWatchers ? allWatchers.length : 0);
  if (allError) console.error("Error fetching all:", allError);

  console.log("Fetching all market_watchers...");
  const { data: allMarketWatchers, error: allMarketError } = await supabase.from("market_watchers").select("*");
  console.log("Total watchers count (market_watchers table):", allMarketWatchers ? allMarketWatchers.length : 0);
  if (allMarketError) console.error("Error fetching all:", allMarketError);
}

testQuery();
