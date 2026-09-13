// src/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

/**
 * PRO-TIP: Vite environment variables MUST be accessed via static literal properties 
 * (e.g. import.meta.env.VITE_URL) to be correctly replaced during the production build.
 */

const getViteEnv = (key: string): string => {
  // 1. Static replacement for Browser (Vite)
  // These literals MUST remain as is for Vite to replace them at build-time.
  if (key === 'VITE_SUPABASE_URL') return import.meta.env.VITE_SUPABASE_URL || '';
  if (key === 'VITE_SUPABASE_ANON_KEY') return import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  
  // @ts-ignore
  if (key === 'SUPABASE_URL') return import.meta.env.SUPABASE_URL || '';
  // @ts-ignore
  if (key === 'SUPABASE_ANON_KEY') return import.meta.env.SUPABASE_ANON_KEY || '';

  // 2. Fallback for Node.js / Server-side environments
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key]!;
    }
  } catch {}
  
  return '';
};

const rawUrl = getViteEnv('VITE_SUPABASE_URL') || getViteEnv('SUPABASE_URL');
const rawKey = getViteEnv('VITE_SUPABASE_ANON_KEY') || getViteEnv('SUPABASE_ANON_KEY');

// Clean and validate the URL
const cleanUrl = (url: string): string => {
  if (!url) return '';
  let cleaned = url.trim();
  if (cleaned.endsWith('/')) cleaned = cleaned.slice(0, -1);
  if (cleaned.endsWith('/rest/v1')) cleaned = cleaned.slice(0, -8);
  if (cleaned.endsWith('/')) cleaned = cleaned.slice(0, -1);
  return cleaned;
};

export const SUPABASE_URL = cleanUrl(rawUrl);
export const SUPABASE_PUBLIC_KEY = rawKey.trim();

// A real configuration must have a valid URL and a non-placeholder key
export const isRealSupabaseConfigured = !!(
  SUPABASE_URL && 
  !SUPABASE_URL.includes('placeholder') && 
  SUPABASE_PUBLIC_KEY && 
  SUPABASE_PUBLIC_KEY !== 'placeholder'
);

// Initialize the singleton client
export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_PUBLIC_KEY || 'placeholder'
);

// Diagnostic logging for production troubleshooting (safe metadata only)
if (typeof window !== 'undefined') {
  if (!isRealSupabaseConfigured) {
    console.warn('[AUTH] Supabase is not configured. Redirecting to placeholder.');
  } else {
    console.log('[AUTH] Supabase client initialized.', {
      endpoint: SUPABASE_URL.split('.')[0].replace('https://', ''),
      valid: true
    });
  }
}



