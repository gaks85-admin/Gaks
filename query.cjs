const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = "https://wkujrqmxivljnuvumfau.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const { data, error } = await supabase.from('trading_preferences').select('*');
  console.log("Trading Preferences:", JSON.stringify(data, null, 2), "Error:", error);
  
  const { data: watchers, error: watchersError } = await supabase.from('watchers').select('*');
  console.log("Watchers:", JSON.stringify(watchers, null, 2), "Error:", watchersError);
}
run();
