import { createClient } from '@supabase/supabase-js';
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || '';
const SUPABASE_PUBLIC_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const DEFAULT_URL = "https://wkujrqmxivljnuvumfau.supabase.co";
const DEFAULT_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrdWpycW14aXZsam51dnVtZmF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NTY5OTAsImV4cCI6MjA5ODIzMjk5MH0.XsQYwuH5KMcGPgEnyYZST2Qq4dd4c2sV8Zc3z7I5xrA";
const cleanUrl = (url) => {
    let cleaned = url.trim();
    if (!cleaned.startsWith('http://') && !cleaned.startsWith('https://')) {
        throw new Error(`Configuration Error: Supabase URL must start with http:// or https://. Received: ${url}`);
    }
    return cleaned.replace(/\/+$/, '');
};
const finalUrl = SUPABASE_URL && SUPABASE_URL.trim() !== '' ? cleanUrl(SUPABASE_URL) : DEFAULT_URL;
const finalKey = SUPABASE_PUBLIC_KEY && SUPABASE_PUBLIC_KEY.trim() !== '' ? SUPABASE_PUBLIC_KEY.trim() : DEFAULT_KEY;
export const isRealSupabaseConfigured = true;
export const supabase = createClient(finalUrl, finalKey);
