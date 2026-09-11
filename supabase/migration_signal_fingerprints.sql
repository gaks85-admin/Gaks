-- migration_signal_fingerprints.sql
-- Create signal_fingerprints table to store deduplication hashes for market watchers

CREATE TABLE IF NOT EXISTS public.signal_fingerprints (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  watcher_id UUID REFERENCES public.watchers(id) ON DELETE CASCADE,
  fingerprint TEXT NOT NULL,
  pair TEXT NOT NULL,
  direction TEXT NOT NULL,
  entry_price TEXT,
  stop_loss TEXT,
  take_profit TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Index for rapid lookup by watcher and creation time
CREATE INDEX IF NOT EXISTS idx_signal_fingerprints_lookup 
ON public.signal_fingerprints (watcher_id, fingerprint, created_at DESC);

-- Enable RLS
ALTER TABLE public.signal_fingerprints ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users and service role full access
CREATE POLICY "Allow service role full access on signal_fingerprints"
ON public.signal_fingerprints
FOR ALL
USING (true)
WITH CHECK (true);
