import { supabase } from '../supabaseClient';

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
      console.warn("Could not fetch Gemini key from database (falling back to local storage):", error.message);
      // Fallback: check localStorage for simulated sessions/resilience
      return localStorage.getItem(`gaks_gemini_key_${session.user.id}`) || null;
    }

    if (data && data.api_key) {
      return data.api_key;
    }

    // Fallback: check localStorage
    return localStorage.getItem(`gaks_gemini_key_${session.user.id}`) || null;
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
    if (existingKey?.id) {
      // Update existing
      result = await supabase
        .from('user_api_keys')
        .update({
          api_key: trimmedKey,
          updated_at: new Date().toISOString()
        })
        .eq('id', existingKey.id);
    } else {
      // Insert new
      result = await supabase
        .from('user_api_keys')
        .insert({
          user_id: userId,
          provider: 'gemini',
          api_key: trimmedKey,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
    }

    if (result.error) {
      console.warn("Could not save API key to database (falling back to local storage):", result.error.message);
      // Fallback: save to localStorage to ensure the app stays operational
      localStorage.setItem(`gaks_gemini_key_${userId}`, trimmedKey);
      return { success: true }; // Return success as we saved it in local fallback
    }

    // Keep localStorage in sync
    localStorage.setItem(`gaks_gemini_key_${userId}`, trimmedKey);
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
    localStorage.removeItem(`gaks_gemini_key_${userId}`);

    const { error } = await supabase
      .from('user_api_keys')
      .delete()
      .eq('user_id', userId)
      .eq('provider', 'gemini');

    if (error) {
      console.warn("Could not delete API key from database (cleaning up local storage):", error.message);
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err: any) {
    console.error("Exception in deleteGeminiKey:", err);
    return { success: false, error: err.message || "An unexpected error occurred." };
  }
}
