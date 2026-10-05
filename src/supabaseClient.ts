// src/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

// 1. Read the browser-safe Vite variables (strictly using import.meta.env)
// @ts-ignore
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
// @ts-ignore
const SUPABASE_PUBLIC_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// 2. Validate that they exist
if (!SUPABASE_URL || !SUPABASE_PUBLIC_KEY) {
  throw new Error(
    "Configuration Error: The authentication service URL or Public Key is not set. " +
    "Please check your environment variables (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)."
  );
}

// 3. Validate the URL format
const cleanUrl = (url: string): string => {
  let cleaned = url.trim();
  if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
    throw new Error(`Configuration Error: Supabase URL must start with http:// or https://. Received: ${url}`);
  }
  return cleaned.replace(/\/+$/, '');
};

const SUPABASE_URL_CLEAN = cleanUrl(SUPABASE_URL);
const SUPABASE_PUBLIC_KEY_CLEAN = SUPABASE_PUBLIC_KEY.trim();

// Export configuration verification flag
export const isRealSupabaseConfigured = true;

// 4. Create exactly ONE Supabase client (no placeholders or substitutions)
export const supabase = createClient(
  SUPABASE_URL_CLEAN,
  SUPABASE_PUBLIC_KEY_CLEAN
);





