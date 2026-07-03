import { supabase } from '../supabaseClient';

export interface TelegramConnection {
  id: string;
  user_id: string;
  telegram_chat_id: string | null;
  telegram_user_id: string | null;
  telegram_username: string | null;
  connection_token: string;
  connected: boolean;
  connected_at: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Helper to generate secure random token using the Web Crypto API
 */
export function generateSecureToken(): string {
  const array = new Uint8Array(24);
  window.crypto.getRandomValues(array);
  return Array.from(array)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/**
 * LocalStorage Fallback helper for telegram connections
 */
function getLocalConnection(userId: string): TelegramConnection | null {
  try {
    const connectionsStr = localStorage.getItem('gaks_telegram_connections') || '[]';
    const connections: TelegramConnection[] = JSON.parse(connectionsStr);
    return connections.find(c => c.user_id === userId) || null;
  } catch (e) {
    return null;
  }
}

function saveLocalConnection(userId: string, connection: TelegramConnection) {
  try {
    const connectionsStr = localStorage.getItem('gaks_telegram_connections') || '[]';
    const connections: TelegramConnection[] = JSON.parse(connectionsStr);
    const index = connections.findIndex(c => c.user_id === userId);
    
    if (index !== -1) {
      connections[index] = connection;
    } else {
      connections.push(connection);
    }
    
    localStorage.setItem('gaks_telegram_connections', JSON.stringify(connections));
  } catch (e) {
    console.error('Error saving local telegram connection', e);
  }
}

/**
 * Fetch connection details (trying Supabase, falling back to LocalStorage)
 */
export async function getTelegramConnection(userId: string): Promise<{ data: TelegramConnection | null; isFallback: boolean; error: any }> {
  try {
    const { data, error } = await supabase
      .from('telegram_connections')
      .select('*')
      .eq('user_id', userId);

    if (error) {
      // Table doesn't exist or other error, fallback to LocalStorage
      const local = getLocalConnection(userId);
      return { data: local, isFallback: true, error: null };
    }

    const connection = (data && data.length > 0) ? (data[0] as TelegramConnection) : null;
    return { data: connection, isFallback: false, error: null };
  } catch (err: any) {
    const local = getLocalConnection(userId);
    return { data: local, isFallback: true, error: null };
  }
}

/**
 * Initiates/creates or updates the connection token
 */
export async function initiateTelegramConnection(userId: string): Promise<{ token: string | null; alreadyConnected: boolean; error: any }> {
  try {
    const { data: existingConnection, isFallback } = await getTelegramConnection(userId);
    
    if (existingConnection && existingConnection.connected) {
      return { token: null, alreadyConnected: true, error: null };
    }

    const token = generateSecureToken();

    if (isFallback) {
      // Perform LocalStorage update
      const nowStr = new Date().toISOString();
      const updatedRecord: TelegramConnection = existingConnection
        ? {
            ...existingConnection,
            connection_token: token,
            updated_at: nowStr
          }
        : {
            id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
            user_id: userId,
            telegram_chat_id: null,
            telegram_user_id: null,
            telegram_username: null,
            connection_token: token,
            connected: false,
            connected_at: null,
            created_at: nowStr,
            updated_at: nowStr
          };
      
      saveLocalConnection(userId, updatedRecord);
      return { token, alreadyConnected: false, error: null };
    }

    // Attempt real Supabase database operation
    if (existingConnection) {
      const { error } = await supabase
        .from('telegram_connections')
        .update({
          connection_token: token,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', userId);
        
      if (error) {
        // Fall back to local
        const nowStr = new Date().toISOString();
        const updatedRecord = {
          ...existingConnection,
          connection_token: token,
          updated_at: nowStr
        };
        saveLocalConnection(userId, updatedRecord);
        return { token, alreadyConnected: false, error: null };
      }
    } else {
      const { error } = await supabase
        .from('telegram_connections')
        .insert({
          user_id: userId,
          connection_token: token,
          connected: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        });
        
      if (error) {
        // Fall back to local
        const nowStr = new Date().toISOString();
        const newRecord: TelegramConnection = {
          id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
          user_id: userId,
          telegram_chat_id: null,
          telegram_user_id: null,
          telegram_username: null,
          connection_token: token,
          connected: false,
          connected_at: null,
          created_at: nowStr,
          updated_at: nowStr
        };
        saveLocalConnection(userId, newRecord);
        return { token, alreadyConnected: false, error: null };
      }
    }
    
    return { token, alreadyConnected: false, error: null };
  } catch (err: any) {
    // Ultimate fallback to LocalStorage
    const existing = getLocalConnection(userId);
    if (existing && existing.connected) {
      return { token: null, alreadyConnected: true, error: null };
    }
    const token = generateSecureToken();
    const nowStr = new Date().toISOString();
    const record: TelegramConnection = existing
      ? { ...existing, connection_token: token, updated_at: nowStr }
      : {
          id: crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2),
          user_id: userId,
          telegram_chat_id: null,
          telegram_user_id: null,
          telegram_username: null,
          connection_token: token,
          connected: false,
          connected_at: null,
          created_at: nowStr,
          updated_at: nowStr
        };
    saveLocalConnection(userId, record);
    return { token, alreadyConnected: false, error: null };
  }
}

/**
 * Returns deep link URL to open in Telegram
 */
export function getTelegramDeepLink(token: string): string {
  return `https://t.me/Gaksai_bot?start=${token}`;
}
