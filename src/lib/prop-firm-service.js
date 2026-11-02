export function resolvePersistedAccountType(rawType) {
    if (!rawType)
        return 'personal';
    const clean = String(rawType).toLowerCase().trim();
    if (clean === 'prop' || clean === 'prop_firm' || clean === 'propfirm') {
        return 'prop';
    }
    return 'personal';
}
export async function getPropFirmSettings(supabaseClient, userId) {
    if (!supabaseClient || !userId)
        return null;
    try {
        const { data, error } = await supabaseClient
            .from('prop_firm_settings')
            .select('*')
            .eq('user_id', userId)
            .maybeSingle();
        if (error || !data)
            return null;
        return data;
    }
    catch {
        return null;
    }
}
export async function savePropFirmSettings(supabaseClient, userIdOrSettings, maybeSettings) {
    if (!supabaseClient)
        return { data: null, error: null };
    try {
        let payload = {};
        if (typeof userIdOrSettings === 'string') {
            payload = { user_id: userIdOrSettings, ...(maybeSettings || {}) };
        }
        else {
            payload = { ...(userIdOrSettings || {}) };
        }
        if (!payload.user_id) {
            return { data: null, error: new Error('Missing user_id for prop firm settings') };
        }
        const { data, error } = await supabaseClient
            .from('prop_firm_settings')
            .upsert(payload, { onConflict: 'user_id' })
            .select()
            .maybeSingle();
        return { data, error };
    }
    catch (err) {
        return { data: null, error: err };
    }
}
export async function syncPropFirmHighWatermarks(supabaseClient, userId, balance) {
    if (!supabaseClient || !userId)
        return { error: null };
    try {
        await supabaseClient
            .from('prop_firm_settings')
            .update({
            high_watermark_balance: balance,
            updated_at: new Date().toISOString()
        })
            .eq('user_id', userId);
        return { error: null };
    }
    catch {
        return { error: null };
    }
}
export function computePropFirmResetBoundaryUtc(now = new Date()) {
    const boundary = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0));
    return boundary;
}
export function calculateSingleOpenWatcherRisk(watchers) {
    return (watchers || []).reduce((sum, w) => sum + (Number(w.risk_amount) || 0), 0);
}
