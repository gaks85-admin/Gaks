import { PropFirmSettings, AccountType } from './types.js';

export type { PropFirmSettings };

export function resolvePersistedAccountType(rawType?: string | null): AccountType {
  if (!rawType) return 'personal';
  const clean = String(rawType).toLowerCase().trim();
  if (clean === 'prop' || clean === 'prop_firm' || clean === 'propfirm') {
    return 'prop';
  }
  return 'personal';
}

export async function savePropFirmSettings(supabaseClient: any, settings: PropFirmSettings) {
  if (!supabaseClient) return { data: settings, error: null };
  return await supabaseClient
    .from('prop_firm_settings')
    .upsert(settings, { onConflict: 'user_id' });
}

export async function syncPropFirmHighWatermarks(supabaseClient: any, userId: string, balance: number) {
  if (!supabaseClient) return { error: null };
  // Stub for high watermark sync
  return { error: null };
}

export function computePropFirmResetBoundaryUtc(now = new Date()): Date {
  const boundary = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
  return boundary;
}

export function calculateSingleOpenWatcherRisk(watchers: any[]): number {
  return (watchers || []).reduce((sum, w) => sum + (Number(w.risk_amount) || 0), 0);
}
