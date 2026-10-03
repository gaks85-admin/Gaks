-- Migration: Add strategy_summary and personal account economic news protection to public.trading_preferences

-- 1. Ensure strategy_summary column exists
ALTER TABLE public.trading_preferences
  ADD COLUMN IF NOT EXISTS strategy_summary TEXT;

-- 2. Add news protection fields for Personal Accounts
ALTER TABLE public.trading_preferences
  ADD COLUMN IF NOT EXISTS news_restriction_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS news_buffer_before_minutes INTEGER NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS news_buffer_after_minutes INTEGER NOT NULL DEFAULT 30;

-- 3. Add CHECK constraints for news buffer bounds (0 to 1440 minutes = 24h)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trading_preferences_news_buffer_before_check'
  ) THEN
    ALTER TABLE public.trading_preferences
      ADD CONSTRAINT trading_preferences_news_buffer_before_check
      CHECK (news_buffer_before_minutes >= 0 AND news_buffer_before_minutes <= 1440);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'trading_preferences_news_buffer_after_check'
  ) THEN
    ALTER TABLE public.trading_preferences
      ADD CONSTRAINT trading_preferences_news_buffer_after_check
      CHECK (news_buffer_after_minutes >= 0 AND news_buffer_after_minutes <= 1440);
  END IF;
END $$;

-- 4. Reload PostgREST schema cache
NOTIFY pgrst, 'reload schema';
