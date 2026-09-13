import { getSupabase } from '../../lib/supabase-server.js';
import fs from 'fs';
import path from 'path';

export type ExecutionMode = 'RULE_ONLY' | 'HYBRID' | 'AI_ONLY';

export interface GlobalExecutionSettings {
  executionMode: ExecutionMode;
  defaultGeminiModel: string;
  defaultStrategy: string;
  scanInterval: number;
  maintenanceMode: boolean;
}

const SETTINGS_FILE = path.join(process.cwd(), 'settings.json');

const DEFAULT_SETTINGS: GlobalExecutionSettings = {
  executionMode: 'HYBRID',
  defaultGeminiModel: 'gemini-3.5-flash-lite',
  defaultStrategy: 'Gaks AI Default Strategy',
  scanInterval: 15,
  maintenanceMode: false
};

/**
 * Loads the centrally controlled admin execution settings.
 * Prioritizes Supabase `system_settings` table ('global_config'),
 * falls back to `settings.json`, and finally DEFAULT_SETTINGS.
 */
export async function getGlobalExecutionSettings(supabaseClient?: any): Promise<GlobalExecutionSettings> {
  let settings: GlobalExecutionSettings = { ...DEFAULT_SETTINGS };

  try {
    const supabase = supabaseClient || getSupabase();
    const { data, error } = await supabase
      .from('system_settings')
      .select('*')
      .eq('id', 'global_config')
      .maybeSingle();

    if (data && data.settings) {
      const dbSettings = data.settings;
      return {
        executionMode: normalizeExecutionMode(dbSettings.executionMode),
        defaultGeminiModel: dbSettings.defaultGeminiModel || settings.defaultGeminiModel,
        defaultStrategy: dbSettings.defaultStrategy || settings.defaultStrategy,
        scanInterval: Number(dbSettings.scanInterval) || settings.scanInterval,
        maintenanceMode: Boolean(dbSettings.maintenanceMode)
      };
    }
  } catch (err) {
    // Fallback to local filesystem or defaults
  }

  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = fs.readFileSync(SETTINGS_FILE, 'utf-8');
      const parsed = JSON.parse(data);
      if (parsed) {
        return {
          executionMode: normalizeExecutionMode(parsed.executionMode),
          defaultGeminiModel: parsed.defaultGeminiModel || settings.defaultGeminiModel,
          defaultStrategy: parsed.defaultStrategy || settings.defaultStrategy,
          scanInterval: Number(parsed.scanInterval) || settings.scanInterval,
          maintenanceMode: Boolean(parsed.maintenanceMode)
        };
      }
    }
  } catch (err) {
    // Return default settings
  }

  return settings;
}

export function normalizeExecutionMode(rawMode?: string | null): ExecutionMode {
  if (!rawMode) return 'HYBRID';
  const clean = String(rawMode).trim().toUpperCase();
  if (clean === 'RULE_ONLY') return 'RULE_ONLY';
  if (clean === 'AI_ONLY') return 'AI_ONLY';
  if (clean === 'HYBRID') return 'HYBRID';
  return 'HYBRID';
}
