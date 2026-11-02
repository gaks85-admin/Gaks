export const ADMIN_EMAIL = 'gaks6535@gmail.com';
export async function verifyAdminAuth(req, supabase) {
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
        const userId = user.id;
        const userEmail = (user.email || '').toLowerCase().trim();
        const isPrimaryAdmin = userEmail === ADMIN_EMAIL.toLowerCase().trim();
        if (!isPrimaryAdmin) {
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
    }
    catch (err) {
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
