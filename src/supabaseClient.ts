import { createClient } from '@supabase/supabase-js';

// Safe access to environment variables across different runtimes (Node.js, Vite, etc.)
const getEnv = (name: string): string | undefined => {
  if (typeof process !== 'undefined' && process.env?.[name]) {
    return process.env[name];
  }
  try {
    // @ts-ignore - import.meta.env is Vite specific
    return import.meta?.env?.[name];
  } catch (e) {
    return undefined;
  }
};

const SUPABASE_URL = getEnv('VITE_SUPABASE_URL') || getEnv('SUPABASE_URL') || "https://wkujrqmxivljnuvumfau.supabase.co";
const SUPABASE_PUBLIC_KEY = getEnv('VITE_SUPABASE_ANON_KEY') || getEnv('SUPABASE_ANON_KEY');

if (!SUPABASE_URL) {
  console.error('VITE_SUPABASE_URL or SUPABASE_URL is missing');
}
if (!SUPABASE_PUBLIC_KEY) {
  throw new Error('VITE_SUPABASE_ANON_KEY or SUPABASE_ANON_KEY is missing');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY);
