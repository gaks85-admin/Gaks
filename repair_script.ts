import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

async function repair() {
  // 1. Get all profiles
  const { data: profiles, error: pError } = await supabase.from('profiles').select('id');
  if (pError) throw pError;
  
  // 2. Get all existing connections
  const { data: connections, error: cError } = await supabase.from('telegram_connections').select('user_id');
  if (cError) throw cError;
  
  const existingUserIds = new Set(connections.map(c => c.user_id));
  const missingProfiles = profiles.filter(p => !existingUserIds.has(p.id));
  
  console.log(`Found ${missingProfiles.length} missing connections.`);
  
  for (const profile of missingProfiles) {
    const { error } = await supabase.from('telegram_connections').insert({
      user_id: profile.id,
      connected: false,
      connection_token: crypto.randomUUID(),
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    });
    if (error) {
      console.error(`Failed to insert for ${profile.id}:`, error);
    } else {
      console.log(`Repaired ${profile.id}`);
    }
  }
}

repair();
