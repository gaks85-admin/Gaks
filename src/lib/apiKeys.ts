import { supabase } from '../supabaseClient';
import { runGeminiRequest } from './geminiWrapper';
import { GoogleGenAI } from '@google/genai';
import { sendTelegramMessage } from './telegramWrapper';

export interface UserApiKey {
  id?: string;
  user_id: string;
  provider: string;
  api_key: string;
  created_at?: string;
  updated_at?: string;
}

/**
 * Retrieves the Gemini API key for the currently authenticated user.
 * Returns null if no key is saved or if user is not authenticated.
 */
export async function getGeminiKey(): Promise<string | null> {
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      console.warn("getGeminiKey: No active session found", sessionError);
      return null;
    }

    const { data, error } = await supabase
      .from('user_api_keys')
      .select('api_key')
      .eq('user_id', session.user.id)
      .eq('provider', 'gemini')
      .maybeSingle();

    if (error) {
      console.warn("Could not fetch Gemini key from database:", error.message);
      return null;
    }

    if (data && data.api_key) {
      return data.api_key;
    }

    return null;
  } catch (err) {
    console.error("Exception in getGeminiKey:", err);
    return null;
  }
}

/**
 * Saves a new Gemini API key. If a key already exists, updates it.
 * Validates the value to prevent duplicates or empty entries.
 */
export async function saveGeminiKey(key: string): Promise<{ success: boolean; error?: string }> {
  const trimmedKey = key.trim();
  if (!trimmedKey) {
    return { success: false, error: "API key cannot be empty." };
  }

  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      return { success: false, error: "You must be logged in to save API keys." };
    }

    const userId = session.user.id;

    // Test the new key immediately
    try {
        const ai = new GoogleGenAI({ apiKey: trimmedKey });
        await ai.models.generateContent({ model: "gemini-2.5-flash", contents: "Reply only with OK" });
    } catch (err: any) {
        return { success: false, error: "Validation failed: " + err.message };
    }

    // Check if key already exists
    const { data: existingKey, error: checkError } = await supabase
      .from('user_api_keys')
      .select('id')
      .eq('user_id', userId)
      .eq('provider', 'gemini')
      .maybeSingle();

    if (checkError) {
      console.warn("Could not query existing key, attempting upsert anyway", checkError);
    }

    let result;
    const commonFields = {
        api_key: trimmedKey,
        updated_at: new Date().toISOString()
    };

    console.log("[Gemini Save] Saving key", {
      userId,
      provider: "gemini"
    });

    if (existingKey?.id) {
      // Update existing
      result = await supabase
        .from('user_api_keys')
        .update(commonFields)
        .eq('id', existingKey.id);
    } else {
      // Insert new
      result = await supabase
        .from('user_api_keys')
        .insert({
          user_id: userId,
          provider: 'gemini',
          created_at: new Date().toISOString(),
          ...commonFields
        });
    }

    if (result.error) {
      console.error("Could not save API key to database:", result.error.message);
      return {
        success: false,
        error: result.error.message
      };
    }

    console.log("[Gemini Save] Saved key successfully", {
      userId,
      provider: "gemini"
    });

    // Resume all paused watchers
    await supabase.from('watchers').update({ status: 'active', updated_at: new Date().toISOString() }).eq('user_id', userId).eq('status', 'paused');

    // Send Telegram: ✅ Gaks AI ... (Need to fetch chatId for the user)
    const { data: conn } = await supabase.from('telegram_connections').select('telegram_chat_id').eq('user_id', userId).maybeSingle();
    if (conn && conn.telegram_chat_id) {
        const message = "✅ Gaks AI\n\nYour Gemini API key has been verified successfully.\n\nYour Market Watcher has been resumed.";
        await sendTelegramMessage(conn.telegram_chat_id, message);
    }

    return { success: true };
  } catch (err: any) {
    console.error("Exception in saveGeminiKey:", err);
    return { success: false, error: err.message || "An unexpected error occurred." };
  }
}

/**
 * Updates an existing Gemini API key.
 */
export async function updateGeminiKey(key: string): Promise<{ success: boolean; error?: string }> {
  return saveGeminiKey(key); // Reuses the upsert logic in saveGeminiKey
}

/**
 * Deletes the saved Gemini API key for the authenticated user.
 */
export async function deleteGeminiKey(): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { session }, error: sessionError } = await supabase.auth.getSession();
    if (sessionError || !session?.user) {
      return { success: false, error: "You must be logged in to delete API keys." };
    }

    const userId = session.user.id;

    const { error } = await supabase
      .from('user_api_keys')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'gemini');

    if (error) {
      console.warn("Could not delete API key from database:", error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error("Exception in deleteGeminiKey:", err);
    return { success: false, error: err.message || "An unexpected error occurred." };
  }
}

