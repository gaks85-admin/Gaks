-- =========================================================================
-- PROP FIRM SETTINGS MIGRATION V1
-- =========================================================================

CREATE TABLE IF NOT EXISTS public.prop_firm_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
    
    firm_name TEXT,
    account_phase TEXT,
    account_size NUMERIC,
    
    profit_target NUMERIC,
    profit_target_type TEXT CHECK (profit_target_type IN ('PERCENTAGE', 'AMOUNT')),
    
    daily_loss_limit NUMERIC,
    daily_loss_limit_type TEXT CHECK (daily_loss_limit_type IN ('PERCENTAGE', 'AMOUNT')),
    daily_loss_calculation_basis TEXT CHECK (daily_loss_calculation_basis IN ('BALANCE', 'EQUITY')),
    
    daily_reset_time TIME,
    daily_reset_timezone TEXT,
    
    maximum_drawdown NUMERIC,
    drawdown_type TEXT CHECK (drawdown_type IN ('STATIC', 'TRAILING')),
    drawdown_calculation_basis TEXT CHECK (drawdown_calculation_basis IN ('BALANCE', 'EQUITY')),
    
    risk_per_trade NUMERIC,
    risk_per_trade_type TEXT CHECK (risk_per_trade_type IN ('PERCENTAGE', 'AMOUNT')),
    
    maximum_trades_per_day INTEGER,
    
    news_restriction_enabled BOOLEAN DEFAULT false NOT NULL,
    news_buffer_before_minutes INTEGER DEFAULT 5 NOT NULL,
    news_buffer_after_minutes INTEGER DEFAULT 5 NOT NULL,
    
    created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.prop_firm_settings ENABLE ROW LEVEL SECURITY;

-- Create Policies for authenticated user ownership
CREATE POLICY "Users can read own prop firm settings"
  ON public.prop_firm_settings
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own prop firm settings"
  ON public.prop_firm_settings
  FOR INSERT
  TO authenticated
  With CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own prop firm settings"
  ON public.prop_firm_settings
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own prop firm settings"
  ON public.prop_firm_settings
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Admin override policy
CREATE POLICY "Admin can select all prop firm settings"
  ON public.prop_firm_settings
  FOR SELECT
  TO authenticated
  USING (auth.email() = 'gaks6535@gmail.com');

-- Service role full access
CREATE POLICY "Service role full access prop firm settings"
  ON public.prop_firm_settings
  FOR ALL
  TO service_role
  USING (true)
  With CHECK (true);

-- Performance index on user_id
CREATE INDEX IF NOT EXISTS idx_prop_firm_settings_user_id ON public.prop_firm_settings(user_id);

-- Trigger function for updated_at timestamp
CREATE OR REPLACE FUNCTION public.handle_prop_firm_settings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for updated_at timestamp
DROP TRIGGER IF EXISTS update_prop_firm_settings_modtime ON public.prop_firm_settings;
CREATE TRIGGER update_prop_firm_settings_modtime
  BEFORE UPDATE ON public.prop_firm_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_prop_firm_settings_updated_at();

COMMENT ON TABLE public.prop_firm_settings IS 'Stores user-specific Prop Firm evaluation and funded account configuration rules (one row per user).';

-- Phase 4A: Authoritative High-Water Mark (HWM) persistence columns
ALTER TABLE public.prop_firm_settings
  ADD COLUMN IF NOT EXISTS high_watermark_balance NUMERIC,
  ADD COLUMN IF NOT EXISTS high_watermark_equity NUMERIC;

UPDATE public.prop_firm_settings
SET
  high_watermark_balance = COALESCE(high_watermark_balance, account_size),
  high_watermark_equity = COALESCE(high_watermark_equity, account_size)
WHERE account_size IS NOT NULL AND account_size > 0;

-- Phase 4B: Database-level monotonic HWM enforcement trigger and atomic RPC
CREATE OR REPLACE FUNCTION public.enforce_monotonic_prop_firm_hwm()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.account_size IS NOT DISTINCT FROM NEW.account_size
     AND OLD.firm_name IS NOT DISTINCT FROM NEW.firm_name
     AND OLD.account_phase IS NOT DISTINCT FROM NEW.account_phase THEN
    NEW.high_watermark_balance := GREATEST(
      COALESCE(OLD.high_watermark_balance, OLD.account_size, 0),
      COALESCE(NEW.high_watermark_balance, OLD.high_watermark_balance, OLD.account_size, 0)
    );
    NEW.high_watermark_equity := GREATEST(
      COALESCE(OLD.high_watermark_equity, OLD.account_size, 0),
      COALESCE(NEW.high_watermark_equity, OLD.high_watermark_equity, OLD.account_size, 0)
    );
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS enforce_monotonic_prop_firm_hwm_trigger ON public.prop_firm_settings;
CREATE TRIGGER enforce_monotonic_prop_firm_hwm_trigger
  BEFORE UPDATE ON public.prop_firm_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_monotonic_prop_firm_hwm();

CREATE OR REPLACE FUNCTION public.sync_prop_firm_high_watermarks(
  p_user_id UUID,
  p_candidate_balance NUMERIC,
  p_candidate_equity NUMERIC
)
RETURNS TABLE (
  high_watermark_balance NUMERIC,
  high_watermark_equity NUMERIC
) AS $$
BEGIN
  RETURN QUERY
  UPDATE public.prop_firm_settings AS pfs
  SET
    high_watermark_balance = GREATEST(
      COALESCE(pfs.high_watermark_balance, pfs.account_size, 0),
      COALESCE(p_candidate_balance, 0)
    ),
    high_watermark_equity = GREATEST(
      COALESCE(pfs.high_watermark_equity, pfs.account_size, 0),
      COALESCE(p_candidate_equity, 0)
    ),
    updated_at = NOW()
  WHERE pfs.user_id = p_user_id
  RETURNING pfs.high_watermark_balance, pfs.high_watermark_equity;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;


