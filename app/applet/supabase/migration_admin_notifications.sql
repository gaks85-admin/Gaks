-- Migration for Admin Notifications persistent audit history
CREATE TABLE IF NOT EXISTS public.admin_notifications (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  admin_user_id UUID REFERENCES auth.users ON DELETE SET NULL,
  target_user_id UUID REFERENCES auth.users ON DELETE CASCADE NOT NULL,
  channel TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  provider_message_id TEXT,
  error_message TEXT,
  sent_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL
);

-- Enable RLS
ALTER TABLE public.admin_notifications ENABLE ROW LEVEL SECURITY;

-- Policies
CREATE POLICY "Admins can view admin_notifications"
  ON public.admin_notifications
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'gaks6535@gmail.com')
    )
  );

CREATE POLICY "Admins can insert admin_notifications"
  ON public.admin_notifications
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.profiles 
      WHERE id = auth.uid() AND (role = 'admin' OR email = 'gaks6535@gmail.com')
    )
  );

CREATE INDEX IF NOT EXISTS idx_admin_notifications_target_user ON public.admin_notifications(target_user_id);
CREATE INDEX IF NOT EXISTS idx_admin_notifications_admin_user ON public.admin_notifications(admin_user_id);
