import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { sendTelegramMessage } from './telegramWrapper';

// Simplified Error Classification
export type GeminiErrorType = 'invalid_key' | 'quota_exceeded' | 'rate_limited' | 'temporary_failure' | 'unknown_error';

export function classifyGeminiError(error: any): GeminiErrorType {
    const message = error.message ? error.message.toLowerCase() : '';
    const status = error.status || 0;

    if (status === 401 || status === 403 || message.includes('invalid') || message.includes('permission denied')) {
        return 'invalid_key';
    }
    if (status === 429 || message.includes('quota') || message.includes('rate limit')) {
        return 'quota_exceeded';
    }
    if (status >= 500 || message.includes('timeout') || message.includes('network')) {
        return 'temporary_failure';
    }
    return 'unknown_error';
}

export async function runGeminiRequest(
    supabase: any,
    userId: string,
    prompt: string,
    model: string = 'gemini-2.5-flash',
    config?: any
) {
    // 1. Load the API key for the current user.
    const { data: apiKeyData, error: apiKeyError } = await supabase
        .from('user_api_keys')
        .select('api_key, id, telegram_notified')
        .eq('user_id', userId)
        .eq('provider', 'gemini')
        .maybeSingle();

    if (apiKeyError || !apiKeyData || !apiKeyData.api_key) {
        throw new Error('Gemini API key not found for user.');
    }

    // 2. Load watcher status
    const { data: watcher, error: watcherError } = await supabase
        .from('watchers')
        .select('status')
        .eq('user_id', userId)
        .maybeSingle();

    if (watcher && watcher.status !== 'active') {
        throw new Error('Watcher skipped because Gemini key is inactive.');
    }

    // Initialize GoogleGenAI
    const ai = new GoogleGenAI({ apiKey: apiKeyData.api_key });

    // 3. Increment total_requests.
    await supabase.from('user_api_keys').update({
        total_requests: (apiKeyData.total_requests || 0) + 1,
        last_tested_at: new Date().toISOString()
    }).eq('id', apiKeyData.id);

    try {
        // 5. Call Gemini.
        const response = await ai.models.generateContent({
            model: model,
            contents: prompt,
            config: config
        });

        // On success:
        await supabase.from('user_api_keys').update({
            status: 'active',
            last_success_at: new Date().toISOString(),
            last_error: null,
            telegram_notified: false
        }).eq('id', apiKeyData.id);

        return response.text;
    } catch (error: any) {
        // On failure:
        const errorType = classifyGeminiError(error);
        
        // Increment total_failures.
        await supabase.from('user_api_keys').update({
            total_failures: (apiKeyData.total_failures || 0) + 1,
            last_error: errorType,
            last_error_at: new Date().toISOString()
        }).eq('id', apiKeyData.id);

        // Notify Telegram if status changes to invalid_key or quota_exceeded
        if ((errorType === 'invalid_key' || errorType === 'quota_exceeded') && !apiKeyData.telegram_notified) {
            // Need to fetch chatId, assume it's in telegram_connections table
            const { data: conn } = await supabase.from('telegram_connections').select('telegram_chat_id').eq('user_id', userId).maybeSingle();
            
            if (conn && conn.telegram_chat_id) {
                const message = `⚠️ Gaks AI Notice\n\nYour Gemini API key is no longer working.\n\nReason: ${errorType}\n\nPlease update your Gemini API key in Settings.\n\nYour Market Watcher has been paused until the issue is resolved.`;
                await sendTelegramMessage(conn.telegram_chat_id, message);
            }
            
            await supabase.from('user_api_keys').update({ telegram_notified: true }).eq('id', apiKeyData.id);
        }

        throw error;
    }
}
