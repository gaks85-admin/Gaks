import { createClient } from '@supabase/supabase-js';

const getSupabaseUrl = (): string => {
  let url = "";
  
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_URL) {
    url = import.meta.env.VITE_SUPABASE_URL;
  }
  
  if (!url) {
    return "";
  }

  if (url.endsWith('/rest/v1/')) {
    url = url.slice(0, -9);
  } else if (url.endsWith('/rest/v1')) {
    url = url.slice(0, -8);
  }
  return url;
};

const getSupabaseKey = (): string | undefined => {
  if (typeof import.meta !== 'undefined' && import.meta.env && import.meta.env.VITE_SUPABASE_ANON_KEY) {
    return import.meta.env.VITE_SUPABASE_ANON_KEY;
  }
  return undefined;
};

const SUPABASE_URL = getSupabaseUrl();
const SUPABASE_PUBLIC_KEY = getSupabaseKey();

export const isRealSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_PUBLIC_KEY);

const getClient = () => {
  if (!isRealSupabaseConfigured) {
    throw new Error('Supabase configuration missing: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY must be defined.');
  }
  return createClient(SUPABASE_URL, SUPABASE_PUBLIC_KEY!);
};

export const supabase = new Proxy({} as any, {
  get(target, prop) {
    const client = getClient();
    const value = (client as any)[prop];
    if (typeof value === 'function') {
      return value.bind(client);
    }
    return value;
  }
});
