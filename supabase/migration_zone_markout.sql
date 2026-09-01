-- =========================================================================
-- STATEFUL ZONE MARKOUT & TAP CONFIRMATION LIFECYCLE MIGRATION
-- =========================================================================

ALTER TABLE public.watchers
  ADD COLUMN IF NOT EXISTS zone_data JSONB DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS zone_status TEXT DEFAULT 'NO_ZONE',
  ADD COLUMN IF NOT EXISTS zone_high NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS zone_low NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS zone_type TEXT DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS zone_invalidation_level NUMERIC DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS zone_marked_at TIMESTAMPTZ DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS zone_tapped_at TIMESTAMPTZ DEFAULT NULL;

-- Comment on zone columns
COMMENT ON COLUMN public.watchers.zone_data IS 'Serialized active marked zone structure, boundaries, and metadata';
COMMENT ON COLUMN public.watchers.zone_status IS 'Stateful lifecycle status of marked zone: NO_ZONE, WAITING_FOR_TAP, ZONE_TAPPED, CONFIRMED, INVALIDATED, EXPIRED';
COMMENT ON COLUMN public.watchers.zone_high IS 'Upper boundary price of active marked zone';
COMMENT ON COLUMN public.watchers.zone_low IS 'Lower boundary price of active marked zone';
COMMENT ON COLUMN public.watchers.zone_type IS 'Structural type of active marked zone (e.g., BULLISH_FVG, BEARISH_FVG, ORDER_BLOCK, SUPPORT, RESISTANCE)';
COMMENT ON COLUMN public.watchers.zone_invalidation_level IS 'Structural invalidation boundary price';
COMMENT ON COLUMN public.watchers.zone_marked_at IS 'Timestamp when active zone was marked';
COMMENT ON COLUMN public.watchers.zone_tapped_at IS 'Timestamp when price tapped active zone';
