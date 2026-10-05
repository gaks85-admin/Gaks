-- ============================================================================
-- GAKS AI — AUTHORITATIVE ADMIN ACCESS CONTROL
-- Phase 1: Database Migration Only
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.app_admins (
  user_id UUID PRIMARY KEY
    REFERENCES auth.users(id)
    ON DELETE CASCADE,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_admins ENABLE ROW LEVEL SECURITY;

-- Authenticated users can only read their own admin record.
DROP POLICY IF EXISTS "Users can check own admin status"
ON public.app_admins;

CREATE POLICY "Users can check own admin status"
ON public.app_admins
FOR SELECT
TO authenticated
USING (auth.uid() = user_id);

-- IMPORTANT:
-- There must be NO INSERT, UPDATE, or DELETE policy for the authenticated role.
-- Therefore normal authenticated clients cannot grant themselves admin access
-- or modify existing administrator records.

-- Service role requires unrestricted backend access.
DROP POLICY IF EXISTS "Service role full access on app_admins"
ON public.app_admins;

CREATE POLICY "Service role full access on app_admins"
ON public.app_admins
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- Authoritative admin helper.
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.app_admins
    WHERE user_id = auth.uid()
  );
$$;

-- Seed the existing Gaks administrator.
INSERT INTO public.app_admins (user_id)
SELECT id
FROM auth.users
WHERE lower(trim(email)) = 'gaks6535@gmail.com'
ON CONFLICT (user_id) DO NOTHING;
