const { createClient } = require('@supabase/supabase-js');

const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";

const supabase = createClient(url, key);

async function main() {
  const { data, error } = await supabase.from('watchers').select('*').limit(5);
  console.log("Watchers:");
  console.log(data);
}

main();
