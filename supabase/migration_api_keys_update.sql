-- Migration: Add API key monitoring columns to user_api_keys table
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS last_tested_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS last_success_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS last_error TEXT;
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS last_error_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS total_requests INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS total_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE public.user_api_keys ADD COLUMN IF NOT EXISTS telegram_notified BOOLEAN NOT NULL DEFAULT false;
