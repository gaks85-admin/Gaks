import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = typeof process !== 'undefined' 
  ? (process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co")
  : (import.meta.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co");

const SUPABASE_PUBLIC_KEY = typeof process !== 'undefined'
  ? process.env.VITE_SUPABASE_ANON_KEY
  : import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_PUBLIC_KEY) {
  throw new Error('VITE_SUPABASE_ANON_KEY is missing');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);
