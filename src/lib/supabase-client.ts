import { createClient } from '@supabase/supabase-js';

// Support both Vite browser environment (import.meta.env) and Node.js environment (process.env)
const envUrl = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SUPABASE_URL) ||
  (typeof process !== 'undefined' && (process.env?.VITE_SUPABASE_URL || process.env?.SUPABASE_URL)) ||
  '';

const envKey = (typeof import.meta !== 'undefined' && (import.meta as any).env?.VITE_SUPABASE_ANON_KEY) ||
  (typeof process !== 'undefined' && (process.env?.VITE_SUPABASE_ANON_KEY || process.env?.SUPABASE_SERVICE_ROLE_KEY)) ||
  '';

export const isSupabaseConfigured = Boolean(
  envUrl &&
  envKey &&
  !envUrl.includes('mock.supabase.co') &&
  envUrl.startsWith('http')
);

// In-memory / localStorage fallback store for demo/preview without Supabase credentials
const memoryStore: Record<string, any[]> = {};

function getLocalData(tableName: string): any[] {
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = window.localStorage.getItem(`gaks_db_${tableName}`);
      if (stored) return JSON.parse(stored);
    } catch {
      // Fall back to memory
    }
  }
  return memoryStore[tableName] || [];
}

function saveLocalData(tableName: string, data: any[]): void {
  memoryStore[tableName] = data;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      window.localStorage.setItem(`gaks_db_${tableName}`, JSON.stringify(data));
    } catch {
      // Ignore storage errors
    }
  }
}

// Lightweight mock builder to gracefully handle offline/preview mode
function createMockClient() {
  return {
    from: (tableName: string) => {
      let filtered = [...getLocalData(tableName)];
      const queryBuilder = {
        select: (_cols?: string) => queryBuilder,
        eq: (col: string, val: any) => {
          filtered = filtered.filter(item => item[col] === val);
          return queryBuilder;
        },
        in: (col: string, vals: any[]) => {
          filtered = filtered.filter(item => vals.includes(item[col]));
          return queryBuilder;
        },
        gte: (col: string, val: any) => {
          filtered = filtered.filter(item => item[col] >= val);
          return queryBuilder;
        },
        lte: (col: string, val: any) => {
          filtered = filtered.filter(item => item[col] <= val);
          return queryBuilder;
        },
        order: (_col: string, _opts?: any) => queryBuilder,
        limit: (_n: number) => queryBuilder,
        maybeSingle: async () => ({ data: filtered[0] || null, error: null }),
        single: async () => ({ data: filtered[0] || null, error: null }),
        then: (resolve: (res: { data: any[]; error: null }) => void) => {
          return Promise.resolve({ data: filtered, error: null }).then(resolve);
        },
        upsert: async (payload: any | any[], _opts?: any) => {
          const records = Array.isArray(payload) ? payload : [payload];
          const current = getLocalData(tableName);
          for (const rec of records) {
            const index = current.findIndex(item => 
              (rec.id && item.id === rec.id) || (rec.user_id && item.user_id === rec.user_id)
            );
            if (index >= 0) {
              current[index] = { ...current[index], ...rec, updated_at: new Date().toISOString() };
            } else {
              current.push({ ...rec, id: rec.id || `mock-${Date.now()}`, created_at: new Date().toISOString() });
            }
          }
          saveLocalData(tableName, current);
          return { data: payload, error: null };
        }
      };
      return queryBuilder;
    }
  };
}

export const supabase = isSupabaseConfigured
  ? createClient(envUrl, envKey)
  : (createMockClient() as any);
