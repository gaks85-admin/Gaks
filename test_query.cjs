const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = "https://wkujrqmxivljnuvumfau.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function run() {
  const targetUser = "37a997e5-08e5-4bfb-bac2-849016ed1e1b";
  console.log("Querying for user:", targetUser);

  const tables = ["watchers", "trading_preferences", "telegram_connections", "user_api_keys", "profiles"];
  for (const table of tables) {
    const { data, error } = await supabase.from(table).select("*").eq("user_id", targetUser);
    console.log(`Table ${table} for user:`, JSON.stringify(data, null, 2), "Error:", error);
  }
}

run();
