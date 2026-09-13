// src/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

/**
 * PRO-TIP: Vite environment variables MUST be accessed via static literal properties 
 * (e.g. import.meta.env.VITE_URL) to be correctly replaced during the production build.
 */

const getViteEnv = (key: string): string => {
  // 1. Fallback for Node.js / Server-side environments
  // We check this first to avoid import.meta errors in some Node environments
  try {
    if (typeof process !== 'undefined' && process.env && process.env[key]) {
      return process.env[key]!;
    }
  } catch {}

  // 2. Static replacement for Browser (Vite)
  // IMPORTANT: These literals MUST remain as full import.meta.env.KEY paths 
  // for Vite to statically replace them during the production build.
  try {
    if (key === 'VITE_SUPABASE_URL') return import.meta.env.VITE_SUPABASE_URL || '';
    if (key === 'VITE_SUPABASE_ANON_KEY') return import.meta.env.VITE_SUPABASE_ANON_KEY || '';
  } catch {}
  
  return '';
};

const rawUrl = getViteEnv('VITE_SUPABASE_URL');
const rawKey = getViteEnv('VITE_SUPABASE_ANON_KEY');

// Clean and validate the URL
const cleanUrl = (url: string): string => {
  if (!url) return '';
  let cleaned = url.trim();
  
  // Ensure protocol
  if (cleaned && !cleaned.startsWith('http')) {
    cleaned = 'https://' + cleaned;
  }
  
  // Remove trailing slashes and common API paths that users often accidentally include
  const patternsToRemove = ['/rest/v1', '/auth/v1', '/storage/v1'];
  
  let changed = true;
  while (changed) {
    changed = false;
    if (cleaned.endsWith('/')) {
      cleaned = cleaned.slice(0, -1);
      changed = true;
    }
    for (const pattern of patternsToRemove) {
      if (cleaned.endsWith(pattern)) {
        cleaned = cleaned.slice(0, -pattern.length);
        changed = true;
      }
    }
  }
  
  return cleaned;
};

export const SUPABASE_URL = cleanUrl(rawUrl);
export const SUPABASE_PUBLIC_KEY = rawKey.trim();

// A real configuration must have a valid URL and a non-placeholder key
export const isRealSupabaseConfigured = !!(
  SUPABASE_URL && 
  !SUPABASE_URL.includes('placeholder') && 
  SUPABASE_PUBLIC_KEY && 
  SUPABASE_PUBLIC_KEY !== 'placeholder' &&
  SUPABASE_URL.startsWith('http')
);

// Initialize the singleton client
export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_PUBLIC_KEY || 'placeholder'
);

// Diagnostic logging for production troubleshooting (safe metadata only)
if (typeof window !== 'undefined') {
  const isAppUrl = SUPABASE_URL && window.location.origin.includes(SUPABASE_URL.replace('https://', '').replace('http://', ''));
  
  if (!isRealSupabaseConfigured) {
    console.warn('[AUTH] Supabase is not configured. Redirecting to placeholder.');
  } else if (isAppUrl) {
    console.error('[AUTH] CRITICAL CONFIGURATION ERROR: Your VITE_SUPABASE_URL appears to be set to your application\'s own URL instead of your Supabase Project URL. This will cause authentication to fail.');
  } else {
    console.log('[AUTH] Supabase client initialized.', {
      endpoint: SUPABASE_URL.split('.')[0].replace('https://', '').replace('http://', ''),
      isCustomDomain: !SUPABASE_URL.includes('.supabase.co'),
      valid: true
    });
  }
}



