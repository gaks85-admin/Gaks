import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = "https://wkujrqmxivljnuvumfau.supabase.co";
const SUPABASE_PUBLIC_KEY = "sb_publishable_BheqR2OkNYKqT7bj8xThWA_gGG2hcjf";

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);
