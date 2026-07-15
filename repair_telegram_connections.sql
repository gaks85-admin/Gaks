-- Repair script to insert missing telegram_connections rows for all existing users
INSERT INTO public.telegram_connections (user_id, connected, connection_token, created_at, updated_at)
SELECT id, false, gen_random_uuid()::text, NOW(), NOW()
FROM public.profiles
WHERE id NOT IN (SELECT user_id FROM public.telegram_connections);
