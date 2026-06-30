-- =========================================================================
-- Gaks AI - Production-Ready Supabase SQL Migration
-- Feature: Telegram Integration Linking Schema
-- Database Target: PostgreSQL / Supabase
-- =========================================================================

-- 1. Create the telegram_connections table
-- Designed to store secure linking tokens and status details for the Gaks AI Telegram Bot
CREATE TABLE IF NOT EXISTS public.telegram_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL UNIQUE,
  telegram_chat_id TEXT,
  telegram_user_id TEXT,
  telegram_username TEXT,
  connection_token TEXT NOT NULL UNIQUE,
  connected BOOLEAN NOT NULL DEFAULT FALSE,
  connected_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Documentation comments explaining tables and column purposes
COMMENT ON TABLE public.telegram_connections IS 'Stores deep link tokens and active chat mappings for the Gaks AI Telegram alerting engine.';
COMMENT ON COLUMN public.telegram_connections.user_id IS 'References the primary authenticated user; restricted to one row per user.';
COMMENT ON COLUMN public.telegram_connections.connection_token IS 'Secure random hex string generated via Web Crypto API for deep link authorization.';

-- 2. Enable Row Level Security (RLS) for telegram_connections
ALTER TABLE public.telegram_connections ENABLE ROW LEVEL SECURITY;

-- 3. Create RLS Policies for telegram_connections
-- Ensures that users can only interact with their own link mappings

CREATE POLICY "Users can read own telegram connections"
  ON public.telegram_connections
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own telegram connections"
  ON public.telegram_connections
  FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own telegram connections"
  ON public.telegram_connections
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own telegram connections"
  ON public.telegram_connections
  FOR DELETE
  USING (auth.uid() = user_id);

-- 4. Create performance indexes for lookups
CREATE INDEX IF NOT EXISTS idx_telegram_connections_user_id ON public.telegram_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_telegram_connections_token ON public.telegram_connections(connection_token);

-- 5. Reusable trigger function to automatically update the updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_telegram_connections_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- 6. Apply trigger to telegram_connections table
CREATE OR REPLACE TRIGGER update_telegram_connections_modtime
  BEFORE UPDATE ON public.telegram_connections
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_telegram_connections_updated_at();
