#!/bin/bash
VITE_SUPABASE_URL="http://mock.supabase.co" VITE_SUPABASE_ANON_KEY="mock" SUPABASE_SERVICE_ROLE_KEY="mock" node dist/server.cjs &
PID=$!
sleep 2
curl -s http://localhost:3000/api/admin/health
kill $PID
