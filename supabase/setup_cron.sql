-- Ensure necessary extensions are enabled
create extension if not exists pg_net;
create extension if not exists pg_cron;

-- Add duplicate signal prevention column to watchers table if it doesn't exist
alter table if exists public.watchers 
add column if not exists last_signal_data text;

-- Set up the cron job to run every 5 minutes
-- IMPORTANT: 
-- 1. Replace 'YOUR_PROJECT_REF' with your actual Supabase project reference ID
-- 2. Replace 'YOUR_SERVICE_ROLE_KEY' with your actual Supabase Service Role Key (used for authorization)

select
  cron.schedule(
    'invoke-market-watcher-every-5-minutes', -- Unique name for the cron job
    '*/5 * * * *',                           -- Cron expression (every 5 minutes)
    $$
    select
      net.http_post(
          url:='https://YOUR_PROJECT_REF.supabase.co/functions/v1/market-watcher',
          headers:='{"Content-Type": "application/json", "Authorization": "Bearer YOUR_SERVICE_ROLE_KEY"}'::jsonb
      ) as request_id;
    $$
  );

-- Useful queries for debugging and monitoring:

-- 1. Check if the cron job is scheduled correctly:
-- select * from cron.job;

-- 2. Check the recent execution history and status:
-- select * from cron.job_run_details order by start_time desc limit 10;

-- 3. To unschedule or stop the cron job if needed:
-- select cron.unschedule('invoke-market-watcher-every-5-minutes');
