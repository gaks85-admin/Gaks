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
 * Verifies that the bearer token is valid and belongs to an authorized administrator in public.app_admins.
 * Does NOT trust client-side claims, query params, or body parameters.
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
    // 1. Verify the Supabase JWT cryptographically
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

    // 2. Determine identity ONLY from verified user.id and email
    const userId = user.id;
    const userEmail = (user.email || '').toLowerCase().trim();
    const isPrimaryAdmin = userEmail === ADMIN_EMAIL.toLowerCase().trim();

    if (!isPrimaryAdmin) {
      // 3. Query authoritative public.app_admins table for secondary admins
      const { data: adminRecord, error: adminErr } = await supabase
        .from('app_admins')
        .select('user_id')
        .eq('user_id', userId)
        .maybeSingle();

      if (adminErr) {
        console.error('[ADMIN AUTH] app_admins lookup failed:', adminErr.message);
        return {
          isAdmin: false,
          user,
          userId,
          email: user.email || null,
          error: 'Internal Server Error',
          statusCode: 500
        };
      }

      if (!adminRecord) {
        return {
          isAdmin: false,
          user,
          userId,
          email: user.email || null,
          error: 'Forbidden',
          statusCode: 403
        };
      }
    }

    // Attach verified user info to request for downstream handlers
    if (req) {
      req.user = user;
      req.userId = userId;
    }

    return {
      isAdmin: true,
      user,
      userId,
      email: user.email || null
    };
  } catch (err: any) {
    console.error('[ADMIN AUTH] Unexpected verification error:', err);
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

