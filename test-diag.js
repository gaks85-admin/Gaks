import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://wkujrqmxivljnuvumfau.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndrdWpycW14aXZsam51dnVtZmF1Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI2NTY5OTAsImV4cCI6MjA5ODIzMjk5MH0.XsQYwuH5KMcGPgEnyYZST2Qq4dd4c2sV8Zc3z7I5xrA';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

async function testDiag() {
  console.log('Testing connection to:', SUPABASE_URL);
  try {
    const { data, error } = await supabase.auth.signInWithPassword({
      email: 'nonexistent_test_user_1234567@gaks.ai',
      password: 'password123'
    });
    console.log('Result:', { data, error });
  } catch (err) {
    console.error('Exception:', err);
  }
}

testDiag();
