-- Migration: Add stateful trade lifecycle columns to watchers table

ALTER TABLE public.watchers 
  ADD COLUMN IF NOT EXISTS trade_status TEXT DEFAULT 'WAITING',
  ADD COLUMN IF NOT EXISTS entry_price NUMERIC,
  ADD COLUMN IF NOT EXISTS stop_loss NUMERIC,
  ADD COLUMN IF NOT EXISTS take_profit NUMERIC,
  ADD COLUMN IF NOT EXISTS direction TEXT,
  ADD COLUMN IF NOT EXISTS opened_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS signal_message_id TEXT;
