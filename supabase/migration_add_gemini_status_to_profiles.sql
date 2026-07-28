-- Migration: Add Gemini monitoring columns to public.profiles table
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gemini_status TEXT DEFAULT 'READY';
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gemini_last_error TEXT NULL;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS gemini_last_checked TIMESTAMP WITH TIME ZONE NULL;
