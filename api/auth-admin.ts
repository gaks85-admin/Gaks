import { SupabaseClient } from '@supabase/supabase-js';

export const ADMIN_EMAIL = 'gaks6535@gmail.com';

export interface AdminAuthResult {
  isAdmin: boolean;
  user: any | null;
  userId: string | null;
  email: string | null;
  error?: string;
  statusCode?: number;
}

/**
 * Centralized server-side admin authorization verification.
 * Verifies that the bearer token is valid and belongs to an authorized administrator.
 * Does NOT trust client-side claims or parameters.
 */
export async function verifyAdminAuth(
  req: any,
  supabase: SupabaseClient
): Promise<AdminAuthResult> {
  const authHeader = req.headers?.authorization || req.headers?.Authorization || '';
  const token = authHeader.startsWith('Bearer ') ? authHeader.substring(7).trim() : authHeader.trim();

  if (!token) {
    return {
      isAdmin: false,
      user: null,
      userId: null,
      email: null,
      error: 'Unauthorized',
      statusCode: 401
    };
  }

  try {
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    if (authError || !user) {
      return {
        isAdmin: false,
        user: null,
        userId: null,
        email: null,
        error: 'Unauthorized',
        statusCode: 401
      };
    }

    const email = user.email?.trim().toLowerCase();

    // 1. Check primary administrator email allowlist
    if (email === ADMIN_EMAIL.trim().toLowerCase()) {
      return {
        isAdmin: true,
        user,
        userId: user.id,
        email
      };
    }

    // 2. Check profile role in database
    try {
      const { data: profile, error: profileErr } = await supabase
        .from('profiles')
        .select('role')
        .eq('id', user.id)
        .maybeSingle();

      if (!profileErr && profile && profile.role === 'admin') {
        return {
          isAdmin: true,
          user,
          userId: user.id,
          email
        };
      }
    } catch (profileErr) {
      console.warn('[Admin Auth] Error checking profile role:', profileErr);
    }

    // Authenticated user is not an administrator
    return {
      isAdmin: false,
      user,
      userId: user.id,
      email,
      error: 'Forbidden',
      statusCode: 403
    };
  } catch (err: any) {
    console.error('[Admin Auth] Error during admin verification:', err);
    return {
      isAdmin: false,
      user: null,
      userId: null,
      email: null,
      error: 'Internal Server Error',
      statusCode: 500
    };
  }
}
