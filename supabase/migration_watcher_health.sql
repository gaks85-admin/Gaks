-- Migration: Watcher Health & Diagnostic Tracking
-- Adds health tracking and diagnostic replay columns to the public.watchers table

alter table if exists public.watchers 
add column if not exists last_scan_at timestamp with time zone,
add column if not exists last_successful_scan_at timestamp with time zone,
add column if not exists last_scan_status text,
add column if not exists last_scan_error text,
add column if not exists last_signal_at timestamp with time zone,
add column if not exists last_signal_data text;

comment on column public.watchers.last_scan_status is 'Status of last scan: COMPLETED_NO_SIGNAL, SIGNAL_SENT, SCAN_FAILED_QUOTA, SCAN_FAILED_TIMEOUT, SCAN_FAILED_STALE_DATA, SCAN_FAILED_ERROR';
comment on column public.watchers.last_signal_data is 'JSON string of last sent trade signal for deduplication & diagnostics';
