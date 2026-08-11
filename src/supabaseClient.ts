import { createClient } from '@supabase/supabase-js';

const getEnvVar = (key: string): string => {
  try {
    if (typeof import.meta !== 'undefined' && import.meta && import.meta.env && (import.meta.env as Record<string, string>)[key]) {
      return (import.meta.env as Record<string, string>)[key];
    }
  } catch {
    // fallback
  }
  if (typeof process !== 'undefined' && process.env && process.env[key]) {
    return process.env[key]!;
  }
  return '';
};

const getSupabaseUrl = (): string => {
  let url = getEnvVar('VITE_SUPABASE_URL');
  if (url.endsWith('/rest/v1/')) {
    url = url.slice(0, -9);
  } else if (url.endsWith('/rest/v1')) {
    url = url.slice(0, -8);
  }
  return url;
};

const SUPABASE_URL = getSupabaseUrl();
const SUPABASE_PUBLIC_KEY = getEnvVar('VITE_SUPABASE_ANON_KEY');

export const isRealSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_PUBLIC_KEY);

export const supabase = createClient(
  SUPABASE_URL || 'https://placeholder.supabase.co',
  SUPABASE_PUBLIC_KEY || 'placeholder'
);

