const { createClient } = require('@supabase/supabase-js');

const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";

const supabase = createClient(url, key);

async function main() {
  const watcherData = {
    user_id: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11', // valid uuid
    status: 'active',
    selected_pair: 'BTC/USD',
    selected_timeframe: 'H1',
    trade_status: 'WAITING'
  };
  
  const { data, error } = await supabase.from('watchers').upsert(watcherData, { onConflict: 'user_id,selected_pair' }).select();
  console.log("Upsert result:");
  console.log(data, error);
}

main();
