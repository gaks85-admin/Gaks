import { createClient } from '@supabase/supabase-js';

const getEnvVar = (key: string): string => {
  // 1. Check process.env first (Primarily for Node.js/Server-side bundling)
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key]!;
    }
  } catch {}

  // 2. Static access for Vite-prefixed or Allowed variables (Client-side)
  // These are replaced at build-time by Vite
  if (key === 'VITE_SUPABASE_URL') return import.meta.env.VITE_SUPABASE_URL || '';
  if (key === 'VITE_SUPABASE_ANON_KEY') return import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  if (key === 'SUPABASE_URL') return (import.meta.env as any).SUPABASE_URL || '';
  if (key === 'SUPABASE_ANON_KEY') return (import.meta.env as any).SUPABASE_ANON_KEY || '';

  // 3. Dynamic access fallback for development
  try {
    const env = (import.meta as any).env;
    if (env && env[key]) return env[key];
  } catch {}

  return '';
};

const getSupabaseUrl = (): string => {
  let url = getEnvVar('SUPABASE_URL') || getEnvVar('VITE_SUPABASE_URL');
  if (!url) return '';
  
  // Clean trailing slashes or rest paths
  url = url.trim();
  if (url.endsWith('/')) url = url.slice(0, -1);
  if (url.endsWith('/rest/v1')) url = url.slice(0, -8);
  if (url.endsWith('/rest/v1/')) url = url.slice(0, -9);
  if (url.endsWith('/')) url = url.slice(0, -1);
  
  return url;
};

const SUPABASE_URL = getSupabaseUrl();
const SUPABASE_PUBLIC_KEY = getEnvVar('SUPABASE_ANON_KEY') || getEnvVar('VITE_SUPABASE_ANON_KEY');

// Enhanced diagnostics for production troubleshooting
const IS_PLACEHOLDER = !SUPABASE_URL || SUPABASE_URL.includes('placeholder') || !SUPABASE_PUBLIC_KEY || SUPABASE_PUBLIC_KEY === 'placeholder';

export const isRealSupabaseConfigured = !IS_PLACEHOLDER;

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_PUBLIC_KEY || 'placeholder'
);

if (IS_PLACEHOLDER) {
  console.warn('[WARNING] Supabase is initialized with placeholder values! Authentication WILL fail.');
  if (typeof window !== 'undefined') {
    console.error('[CRITICAL] Supabase Configuration Missing. Ensure VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are set in your environment.');
  }
}

console.log('[DIAGNOSTIC] Supabase initialized.', {
  url: SUPABASE_URL?.replace(/^https:\/\//, '').split('.')[0] || 'MISSING',
  hasKey: !!SUPABASE_PUBLIC_KEY,
  isPlaceholder: IS_PLACEHOLDER,
  envType: typeof import.meta !== 'undefined' ? 'ESM' : 'CJS'
});


