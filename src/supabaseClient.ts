// src/supabaseClient.ts
import { createClient } from '@supabase/supabase-js';

// Access variables directly using import.meta.env
// The build process will replace these at compile time
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || import.meta.env.SUPABASE_URL || '';
const SUPABASE_PUBLIC_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || import.meta.env.SUPABASE_ANON_KEY || '';

// Clean the URL
const cleanUrl = (url: string): string => {
  if (!url) return '';
  let cleaned = url.trim();
  if (cleaned && !cleaned.startsWith('http')) {
    cleaned = 'https://' + cleaned;
  }
  return cleaned.replace(/\/+$/, '');
};

export const SUPABASE_URL_CLEAN = cleanUrl(SUPABASE_URL);
export const SUPABASE_PUBLIC_KEY_CLEAN = SUPABASE_PUBLIC_KEY.trim();

export const isRealSupabaseConfigured = !!(
  SUPABASE_URL_CLEAN &&
  !SUPABASE_URL_CLEAN.includes('placeholder') &&
  SUPABASE_PUBLIC_KEY_CLEAN &&
  SUPABASE_PUBLIC_KEY_CLEAN !== 'placeholder' &&
  SUPABASE_URL_CLEAN.startsWith('http')
);

// Initialize the singleton client
export const supabase = createClient(
  SUPABASE_URL_CLEAN || 'https://placeholder.supabase.co',
  SUPABASE_PUBLIC_KEY_CLEAN || 'placeholder'
);




