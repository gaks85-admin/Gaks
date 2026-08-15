import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.VITE_SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

if (!supabaseUrl || !supabaseServiceKey) {
  console.error("Missing Supabase credentials.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseServiceKey);

async function main() {
  console.log("=== DB TABLES LISTING ===");
  // We can query postgrest to see table information or perform a simple select from pg_catalog if we have permissions
  // or query profiles, watchers, watcher_evaluations, trade_learning, telegram_connections, etc.
  const tables = ['profiles', 'trading_preferences', 'watchlist_items', 'user_api_keys', 'telegram_connections', 'signals', 'market_watchers', 'strategies', 'watchers', 'notification_logs', 'watcher_evaluations', 'trade_learning', 'reconciliation_alerts'];
  for (const t of tables) {
    const { count, error } = await supabase.from(t).select('*', { count: 'exact', head: true });
    if (error) {
      console.log(`- Table [${t}]: Error: ${error.message}`);
    } else {
      console.log(`- Table [${t}]: Exists, Count = ${count}`);
    }
  }
}

main().catch(console.error);
