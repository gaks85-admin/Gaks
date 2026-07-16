import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function debug() {
  const { data, error } = await supabase
    .from('profiles')
    .select('id, email');
  
  if (error) {
    console.error("Error:", error);
  } else {
    console.log("Profiles:", JSON.stringify(data, null, 2));
  }
}

debug();
