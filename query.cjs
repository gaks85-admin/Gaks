const { createClient } = require('@supabase/supabase-js');
const SUPABASE_URL = "https://wkujrqmxivljnuvumfau.supabase.co";
const SUPABASE_KEY = "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const { data, error } = await supabase.from('watchers').select('*');
  console.log(JSON.stringify(data, null, 2));
}
run();
