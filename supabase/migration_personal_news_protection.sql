-- =========================================================================
-- PERSONAL ACCOUNT ECONOMIC NEWS PROTECTION MIGRATION
-- =========================================================================

-- 1. Add news protection columns to trading_preferences table
ALTER TABLE public.trading_preferences
ADD COLUMN IF NOT EXISTS news_restriction_enabled BOOLEAN NOT NULL DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS news_buffer_before_minutes INTEGER NOT NULL DEFAULT 30,
ADD COLUMN IF NOT EXISTS news_buffer_after_minutes INTEGER NOT NULL DEFAULT 30;

-- 2. Add CHECK constraints with sensible maximum bounds (0 <= minutes <= 1440)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_trading_preferences_news_buffer_before'
  ) THEN
    ALTER TABLE public.trading_preferences
    ADD CONSTRAINT check_trading_preferences_news_buffer_before
    CHECK (news_buffer_before_minutes >= 0 AND news_buffer_before_minutes <= 1440);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'check_trading_preferences_news_buffer_after'
  ) THEN
    ALTER TABLE public.trading_preferences
    ADD CONSTRAINT check_trading_preferences_news_buffer_after
    CHECK (news_buffer_after_minutes >= 0 AND news_buffer_after_minutes <= 1440);
  END IF;
END $$;
