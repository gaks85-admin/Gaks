import { createClient } from '@supabase/supabase-js';

const getSupabaseUrl = (): string => {
  let url = "https://wkujrqmxivljnuvumfau.supabase.co";
  if (typeof process !== 'undefined' && process.env && process.env.VITE_SUPABASE_URL) {
    url = process.env.VITE_SUPABASE_URL;
  } else if (typeof import.meta !== 'undefined' && import.meta.env && (import.meta.env as any).VITE_SUPABASE_URL) {
    url = (import.meta.env as any).VITE_SUPABASE_URL;
  }
  
  if (url.endsWith('/rest/v1/')) {
    url = url.slice(0, -9);
  } else if (url.endsWith('/rest/v1')) {
    url = url.slice(0, -8);
  }
  return url;
};

const getSupabaseKey = (): string | undefined => {
  if (typeof process !== 'undefined' && process.env && process.env.VITE_SUPABASE_ANON_KEY) {
    return process.env.VITE_SUPABASE_ANON_KEY;
  }
  if (typeof process !== 'undefined' && process.env && process.env.SUPABASE_ANON_KEY) {
    return process.env.SUPABASE_ANON_KEY;
  }
  // @ts-ignore
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) {
    // @ts-ignore
    return import.meta.env.VITE_SUPABASE_ANON_KEY;
  }
  return undefined;
};

const SUPABASE_URL = getSupabaseUrl();
const SUPABASE_PUBLIC_KEY = getSupabaseKey();

if (!SUPABASE_PUBLIC_KEY) {
  console.warn('VITE_SUPABASE_ANON_KEY is missing');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY || "dummy-key");
