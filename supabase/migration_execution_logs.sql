-- Migration to add execution_logs table for Live Monitoring
-- This table stores a full trace of each watcher scan session

CREATE TABLE IF NOT EXISTS public.execution_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    watcher_id UUID REFERENCES public.watchers(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    pair TEXT,
    run_time TIMESTAMPTZ DEFAULT NOW(),
    logs JSONB, -- Array of log entries: { time: string, message: string, type: 'info' | 'success' | 'error' | 'warning' }
    final_signal TEXT,
    decision_score NUMERIC,
    status TEXT DEFAULT 'success', -- 'success', 'error', 'warning'
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Enable RLS
ALTER TABLE public.execution_logs ENABLE ROW LEVEL SECURITY;

-- Policy for admins to read all
CREATE POLICY admin_all_logs ON public.execution_logs
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.profiles
            WHERE profiles.id = auth.uid() AND profiles.role = 'admin'
        )
    );

-- Policy for users to read their own logs
CREATE POLICY user_own_logs ON public.execution_logs
    FOR SELECT
    TO authenticated
    USING (user_id = auth.uid());

-- Index for performance
CREATE INDEX idx_execution_logs_watcher_id ON public.execution_logs(watcher_id);
CREATE INDEX idx_execution_logs_user_id ON public.execution_logs(user_id);
CREATE INDEX idx_execution_logs_run_time ON public.execution_logs(run_time DESC);
