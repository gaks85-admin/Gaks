// src/lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

// Environment variables for Supabase (if configured)
const supabaseUrl = (import.meta as any).env?.VITE_SUPABASE_URL || '';
const supabaseAnonKey = (import.meta as any).env?.VITE_SUPABASE_ANON_KEY || '';

// Check if actual credentials are provided
export const isRealSupabaseConfigured = !!(supabaseUrl && supabaseAnonKey);

// Define type schema for user session
export interface SupabaseUserProfile {
  id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  subscription_plan: string;
  telegram_connected: boolean;
  created_at: string;
  updated_at: string;
}

// Highly reliable Local Storage-based Supabase simulation for fallback
class MockSupabaseAuth {
  private listeners: Array<(event: string, session: any) => void> = [];

  constructor() {
    // Restore session if exists
    const currentSession = this.getCurrentSession();
    if (currentSession) {
      setTimeout(() => {
        this.trigger('SIGNED_IN', currentSession);
      }, 50);
    }
  }

  private trigger(event: string, session: any) {
    this.listeners.forEach(cb => cb(event, session));
  }

  getCurrentSession() {
    try {
      const activeUserStr = localStorage.getItem('gaks_active_user');
      if (activeUserStr) {
        const user = JSON.parse(activeUserStr);
        return { user, access_token: 'mock-token-xyz' };
      }
    } catch (e) {
      console.error('Error parsing mock session', e);
    }
    return null;
  }

  async signUp({ email, password, options }: any) {
    // Simulate delay
    await new Promise(r => setTimeout(r, 800));

    const cleanEmail = email.trim().toLowerCase();
    
    // Get existing profiles
    const registeredUsersStr = localStorage.getItem('gaks_registered_users') || '[]';
    const registeredUsers = JSON.parse(registeredUsersStr);

    if (registeredUsers.some((u: any) => u.email === cleanEmail)) {
      return { data: { user: null }, error: { message: 'An account with this email already exists.' } };
    }

    const newId = crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2) + '-' + Date.now();
    const fullName = options?.data?.full_name || email.split('@')[0];
    
    const newUserProfile: SupabaseUserProfile = {
      id: newId,
      full_name: fullName,
      email: cleanEmail,
      avatar_url: null,
      subscription_plan: 'Free',
      telegram_connected: false,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };

    // Save profile and registered password credential
    registeredUsers.push({ id: newId, email: cleanEmail, password, profile: newUserProfile });
    localStorage.setItem('gaks_registered_users', JSON.stringify(registeredUsers));

    // Save active session
    localStorage.setItem('gaks_active_user', JSON.stringify(newUserProfile));
    const session = { user: newUserProfile, access_token: 'mock-token-xyz' };
    
    this.trigger('SIGNED_IN', session);

    return { data: { user: newUserProfile, session }, error: null };
  }

  async signInWithPassword({ email, password }: any) {
    await new Promise(r => setTimeout(r, 800));

    const cleanEmail = email.trim().toLowerCase();
    const registeredUsersStr = localStorage.getItem('gaks_registered_users') || '[]';
    const registeredUsers = JSON.parse(registeredUsersStr);

    const userRecord = registeredUsers.find((u: any) => u.email === cleanEmail && u.password === password);

    if (!userRecord) {
      return { data: { user: null }, error: { message: 'Invalid login credentials. Please check your email and password.' } };
    }

    // Save active session
    localStorage.setItem('gaks_active_user', JSON.stringify(userRecord.profile));
    const session = { user: userRecord.profile, access_token: 'mock-token-xyz' };

    this.trigger('SIGNED_IN', session);

    return { data: { user: userRecord.profile, session }, error: null };
  }

  async signOut() {
    await new Promise(r => setTimeout(r, 400));
    localStorage.removeItem('gaks_active_user');
    this.trigger('SIGNED_OUT', null);
    return { error: null };
  }

  async getSession() {
    const session = this.getCurrentSession();
    return { data: { session }, error: null };
  }

  onAuthStateChange(callback: (event: string, session: any) => void) {
    this.listeners.push(callback);
    const session = this.getCurrentSession();
    callback(session ? 'INITIAL_SESSION' : 'SIGNED_OUT', session);
    return {
      data: {
        subscription: {
          unsubscribe: () => {
            this.listeners = this.listeners.filter(cb => cb !== callback);
          }
        }
      }
    };
  }

  async resetPasswordForEmail(email: string, options?: any) {
    await new Promise(r => setTimeout(r, 800));
    const cleanEmail = email.trim().toLowerCase();
    const registeredUsersStr = localStorage.getItem('gaks_registered_users') || '[]';
    const registeredUsers = JSON.parse(registeredUsersStr);

    const userExists = registeredUsers.some((u: any) => u.email === cleanEmail);
    if (!userExists) {
      return { data: null, error: { message: 'No registered account found with this email address.' } };
    }

    // Set a password reset token/indicator
    localStorage.setItem('gaks_reset_email_pending', cleanEmail);
    return { data: {}, error: null };
  }

  async updateUser({ password }: any) {
    await new Promise(r => setTimeout(r, 800));
    const cleanEmail = localStorage.getItem('gaks_reset_email_pending') || '';
    const activeSession = this.getCurrentSession();
    
    let targetEmail = cleanEmail;
    if (activeSession && activeSession.user) {
      targetEmail = activeSession.user.email;
    }

    if (!targetEmail) {
      return { data: null, error: { message: 'No active password reset session found.' } };
    }

    const registeredUsersStr = localStorage.getItem('gaks_registered_users') || '[]';
    const registeredUsers = JSON.parse(registeredUsersStr);

    const userIdx = registeredUsers.findIndex((u: any) => u.email === targetEmail);
    if (userIdx === -1) {
      return { data: null, error: { message: 'User profile not found.' } };
    }

    // Update password
    registeredUsers[userIdx].password = password;
    localStorage.setItem('gaks_registered_users', JSON.stringify(registeredUsers));
    localStorage.removeItem('gaks_reset_email_pending');

    // Automatically log user in
    const profile = registeredUsers[userIdx].profile;
    localStorage.setItem('gaks_active_user', JSON.stringify(profile));
    const session = { user: profile, access_token: 'mock-token-xyz' };
    this.trigger('SIGNED_IN', session);

    return { data: { user: profile }, error: null };
  }
}

class MockSupabaseQueryBuilder {
  private tableName: string;

  constructor(tableName: string) {
    this.tableName = tableName;
  }

  select(columns: string) {
    return this;
  }

  eq(columnName: string, value: any) {
    return this;
  }

  async single() {
    await new Promise(r => setTimeout(r, 200));
    if (this.tableName === 'profiles') {
      const activeUserStr = localStorage.getItem('gaks_active_user');
      if (activeUserStr) {
        return { data: JSON.parse(activeUserStr), error: null };
      }
    }
    return { data: null, error: { message: 'Profile record not found' } };
  }

  async update(newData: Partial<SupabaseUserProfile>) {
    await new Promise(r => setTimeout(r, 300));
    if (this.tableName === 'profiles') {
      const activeUserStr = localStorage.getItem('gaks_active_user');
      if (activeUserStr) {
        const activeUser: SupabaseUserProfile = JSON.parse(activeUserStr);
        const updatedUser = {
          ...activeUser,
          ...newData,
          updated_at: new Date().toISOString()
        };

        // Update in active session
        localStorage.setItem('gaks_active_user', JSON.stringify(updatedUser));

        // Update in registered user list to persist profile across sessions
        const registeredUsersStr = localStorage.getItem('gaks_registered_users') || '[]';
        const registeredUsers = JSON.parse(registeredUsersStr);
        const index = registeredUsers.findIndex((u: any) => u.id === activeUser.id);
        if (index !== -1) {
          registeredUsers[index].profile = updatedUser;
          localStorage.setItem('gaks_registered_users', JSON.stringify(registeredUsers));
        }

        return { data: updatedUser, error: null };
      }
    }
    return { data: null, error: { message: 'Failed to update profile' } };
  }
}

class MockSupabaseClient {
  auth = new MockSupabaseAuth();

  from(tableName: string) {
    return new MockSupabaseQueryBuilder(tableName);
  }
}

// Export the client. Seamlessly swap to real Supabase client when VITE_SUPABASE_URL is set
export const supabase = isRealSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey)
  : (new MockSupabaseClient() as any);
