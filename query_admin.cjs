const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const { data, error } = await supabase.from('watchers').select('*');
  console.log("WATCHERS:", JSON.stringify(data, null, 2));
  
  const { data: tp } = await supabase.from('trading_preferences').select('*');
  console.log("TRADING PREFS:", JSON.stringify(tp, null, 2));
}
run();
