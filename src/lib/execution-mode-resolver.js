import { getSupabase } from '../../lib/supabase-server.js';
import fs from 'fs';
import path from 'path';
function getSettingsFile() {
    if (typeof window !== 'undefined' || typeof process === 'undefined' || !process.cwd) {
        return 'settings.json';
    }
    try {
        return path.join(process.cwd(), 'settings.json');
    } catch {
        return 'settings.json';
    }
}
const DEFAULT_SETTINGS = {
    executionMode: 'HYBRID',
    defaultGeminiModel: 'gemini-3.5-flash-lite',
    defaultStrategy: 'Gaks AI Default Strategy',
    scanInterval: 15,
    maintenanceMode: false
};
export async function getGlobalExecutionSettings(supabaseClient) {
    let settings = { ...DEFAULT_SETTINGS };
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
    }
    catch (err) {
    }
    try {
        if (typeof window === 'undefined') {
            const settingsFile = getSettingsFile();
            if (fs.existsSync(settingsFile)) {
                const data = fs.readFileSync(settingsFile, 'utf-8');
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
        }
    }
    catch (err) {
    }
    return settings;
}
export function normalizeExecutionMode(rawMode) {
    if (!rawMode)
        return 'HYBRID';
    const clean = String(rawMode).trim().toUpperCase();
    if (clean === 'RULE_ONLY')
        return 'RULE_ONLY';
    if (clean === 'AI_ONLY')
        return 'AI_ONLY';
    if (clean === 'HYBRID')
        return 'HYBRID';
    return 'HYBRID';
}
