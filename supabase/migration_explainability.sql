-- SQL Migration for Phase 3: Explainability & Analytics Engine
-- Table: public.watcher_evaluations

CREATE TABLE IF NOT EXISTS public.watcher_evaluations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    watcher_id UUID NOT NULL,
    pair TEXT,
    timeframe TEXT,
    strategy_mode TEXT,
    decision_score NUMERIC,
    matched_weight NUMERIC,
    possible_weight NUMERIC,
    recommendation TEXT,
    mandatory_rules_passed BOOLEAN,
    matched_rules JSONB,
    failed_rules JSONB,
    gemini_used BOOLEAN,
    gemini_result TEXT,
    trade_sent BOOLEAN,
    trade_reason TEXT,
    scan_duration_ms INTEGER,
    gemini_duration_ms INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Add indexes for performance optimization in analytics queries
CREATE INDEX IF NOT EXISTS idx_watcher_eval_user_id ON public.watcher_evaluations(user_id);
CREATE INDEX IF NOT EXISTS idx_watcher_eval_watcher_id ON public.watcher_evaluations(watcher_id);
CREATE INDEX IF NOT EXISTS idx_watcher_eval_created_at ON public.watcher_evaluations(created_at);
CREATE INDEX IF NOT EXISTS idx_watcher_eval_recommendation ON public.watcher_evaluations(recommendation);
