import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// https://vitejs.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), '');
  
  const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseAnonKey = env.VITE_SUPABASE_ANON_KEY || env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY || process.env.SUPABASE_ANON_KEY;

  // Build-time validation to prevent producing a broken production bundle
  if (command === 'build' && (!supabaseUrl || !supabaseAnonKey)) {
    throw new Error(
      '\n=======================================================================\n' +
      'CRITICAL BUILD ERROR: Supabase environment variables are missing!\n' +
      'Please ensure VITE_SUPABASE_URL (or SUPABASE_URL) and \n' +
      'VITE_SUPABASE_ANON_KEY (or SUPABASE_ANON_KEY) are configured.\n' +
      '=======================================================================\n'
    );
  }

  return {
    plugins: [react(), tailwindcss()],
    define: {
      'import.meta.env.VITE_SUPABASE_URL': JSON.stringify(supabaseUrl || ''),
      'import.meta.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(supabaseAnonKey || ''),
    },
    server: {
      port: 3000,
      host: '0.0.0.0'
    }
  };
});
