-- Migration: Integrate the Strategy system with the AI Market Watcher engine.

-- 1. Create a default trading preferences record for existing auth users who don't have one
INSERT INTO public.trading_preferences (user_id, strategy_text)
SELECT id, '• Entry conditions\n• Confirmation indicators\n• Exit & stop-loss logic\n• Risk management rules'
FROM auth.users
ON CONFLICT (user_id) DO NOTHING;

-- 2. Modify the watchers table strategy_id column
-- Convert strategy_id to TEXT to accommodate both 'default' and custom UUIDs.
ALTER TABLE public.watchers ALTER COLUMN strategy_id TYPE TEXT;

-- 3. Migrate all existing watchers that currently have a NULL strategy_id to the 'default' strategy
UPDATE public.watchers SET strategy_id = 'default' WHERE strategy_id IS NULL;

-- 4. Enforce NOT NULL and DEFAULT constraint on strategy_id
ALTER TABLE public.watchers ALTER COLUMN strategy_id SET DEFAULT 'default';
ALTER TABLE public.watchers ALTER COLUMN strategy_id SET NOT NULL;
