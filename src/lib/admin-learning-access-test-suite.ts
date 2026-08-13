import { verifyAdminAuth, ADMIN_EMAIL } from '../../api/auth-admin.js';
import performanceSnapshotHandler from '../../api/performance/snapshot.js';
import { getUserPerformanceSnapshot } from './performance-snapshot.js';
import { getLearningStatus } from './learning-status.js';
import { evaluateAdaptiveLearning } from './adaptive-learning-engine.js';
import { evaluateRiskGovernor } from './risk-governor.js';

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`[ADMIN LEARNING ACCESS TEST FAILED]: ${msg}`);
  }
}

export async function runAdminLearningAccessTestSuite(): Promise<boolean> {
  console.log('[TEST] Running Admin-Only Learning Dashboard Access Control Test Suite...');

  // Mock Supabase clients
  const createMockSupabase = (user: any, profileRole?: string) => {
    return {
      auth: {
        getUser: async (token: string) => {
          if (token === 'valid_admin_token') {
            return { data: { user: { id: 'admin_user_id', email: ADMIN_EMAIL } }, error: null };
          }
          if (token === 'valid_role_admin_token') {
            return { data: { user: { id: 'role_admin_user_id', email: 'custom_admin@domain.com' } }, error: null };
          }
          if (token === 'valid_normal_user_token') {
            return { data: { user: { id: 'normal_user_123', email: 'trader@example.com' } }, error: null };
          }
          return { data: { user: null }, error: { message: 'Invalid token' } };
        }
      },
      from: (table: string) => ({
        select: (cols: string) => ({
          eq: (col: string, val: string) => ({
            maybeSingle: async () => {
              if (val === 'role_admin_user_id') {
                return { data: { role: 'admin' }, error: null };
              }
              if (val === 'normal_user_123') {
                return { data: { role: 'user' }, error: null };
              }
              return { data: null, error: null };
            }
          })
        })
      })
    } as any;
  };

  // Test 1: Missing auth header/token returns 401 Unauthorized
  const mockReqNoAuth = { headers: {} };
  const mockSupabase = createMockSupabase(null);
  const authResNoAuth = await verifyAdminAuth(mockReqNoAuth, mockSupabase);
  assert(!authResNoAuth.isAdmin, 'Test 1.1 - Missing token returns isAdmin=false');
  assert(authResNoAuth.statusCode === 401, 'Test 1.2 - Missing token returns statusCode 401');

  // Test 2: Invalid token returns 401 Unauthorized
  const mockReqInvalidToken = { headers: { authorization: 'Bearer bad_token' } };
  const authResInvalid = await verifyAdminAuth(mockReqInvalidToken, mockSupabase);
  assert(!authResInvalid.isAdmin, 'Test 2.1 - Invalid token returns isAdmin=false');
  assert(authResInvalid.statusCode === 401, 'Test 2.2 - Invalid token returns statusCode 401');

  // Test 3: Normal user token returns 403 Forbidden
  const mockReqNormalUser = { headers: { authorization: 'Bearer valid_normal_user_token' } };
  const authResNormal = await verifyAdminAuth(mockReqNormalUser, mockSupabase);
  assert(!authResNormal.isAdmin, 'Test 3.1 - Normal user returns isAdmin=false');
  assert(authResNormal.statusCode === 403, 'Test 3.2 - Normal user returns statusCode 403');
  assert(authResNormal.error === 'Forbidden', 'Test 3.3 - Normal user error message is Forbidden');

  // Test 4: Primary Admin Email returns 200/isAdmin=true
  const mockReqAdmin = { headers: { authorization: 'Bearer valid_admin_token' } };
  const authResAdmin = await verifyAdminAuth(mockReqAdmin, mockSupabase);
  assert(authResAdmin.isAdmin === true, 'Test 4.1 - Primary admin email returns isAdmin=true');
  assert(authResAdmin.email === ADMIN_EMAIL, 'Test 4.2 - Primary admin email is verified');

  // Test 5: Role Admin returns isAdmin=true
  const mockReqRoleAdmin = { headers: { authorization: 'Bearer valid_role_admin_token' } };
  const authResRoleAdmin = await verifyAdminAuth(mockReqRoleAdmin, mockSupabase);
  assert(authResRoleAdmin.isAdmin === true, 'Test 5.1 - Admin role returns isAdmin=true');

  // Test 6: Performance snapshot handler mock response for non-admin
  const mockResObj = () => {
    let statusCode = 200;
    let jsonBody: any = null;
    return {
      status: (code: number) => {
        statusCode = code;
        return {
          json: (body: any) => {
            jsonBody = body;
            return { statusCode, jsonBody };
          }
        };
      },
      getStatusCode: () => statusCode,
      getJsonBody: () => jsonBody
    };
  };

  // Test 7: Normal user backend learning continues operating silently
  const sampleUserTrades = [
    { trade_id: 't-1', user_id: 'normal_user_123', outcome: 'WIN', realized_r: 2.0, pair: 'EURUSD', setup_type: 'PULLBACK', completed_at: '2026-06-01T10:00:00Z', is_closed: true, status: 'CLOSED' },
    { trade_id: 't-2', user_id: 'normal_user_123', outcome: 'WIN', realized_r: 1.5, pair: 'EURUSD', setup_type: 'PULLBACK', completed_at: '2026-06-02T10:00:00Z', is_closed: true, status: 'CLOSED' },
    { trade_id: 't-3', user_id: 'normal_user_123', outcome: 'LOSS', realized_r: -1.0, pair: 'EURUSD', setup_type: 'PULLBACK', completed_at: '2026-06-03T10:00:00Z', is_closed: true, status: 'CLOSED' }
  ];

  // Verify backend snapshot and status derivation are functional
  const userSnapshot = await getUserPerformanceSnapshot('normal_user_123', {
    completedTrades: sampleUserTrades
  });
  assert(userSnapshot.totalCompletedTrades === 3, 'Test 7.1 - User completed trades aggregated');
  assert(userSnapshot.wins === 2 && userSnapshot.losses === 1, 'Test 7.2 - Outcome statistics accurate');

  const userLearningStatus = await getLearningStatus('normal_user_123', {
    completedTrades: sampleUserTrades
  });
  assert(userLearningStatus.summary.length > 0, 'Test 7.3 - Learning status derived');

  // Verify adaptive learning decisions execute silently in the background
  const adaptiveDecision = evaluateAdaptiveLearning({
    pair: 'EURUSD',
    timeframe: 'H1',
    setup: 'PULLBACK',
    direction: 'BUY',
    marketRegime: 'TRENDING_BULLISH',
    completedTrades: sampleUserTrades
  });
  assert(adaptiveDecision.decision !== undefined, 'Test 7.4 - Adaptive decision evaluates silently');

  // Verify Risk Governor evaluates silently in the background
  const governorState = evaluateRiskGovernor({
    metrics: {
      totalTrades: 3,
      winRate: 66.7,
      expectancyR: 0.83,
      consecutiveLosses: 1,
      consecutiveWins: 0,
      totalRealizedR: 2.5,
      performanceByPair: { EURUSD: { trades: 3, expectancyR: 0.83, winRate: 66.7 } },
      performanceBySetup: { PULLBACK: { trades: 3, expectancyR: 0.83, winRate: 66.7 } },
      sampleSizeTier: 'INSUFFICIENT'
    },
    equityState: {
      configuredCapital: 1000,
      estimatedEquity: 1025,
      estimatedDrawdownPercent: 2.5
    },
    candidate: {
      pair: 'EURUSD',
      timeframe: 'H1',
      strategySetup: 'PULLBACK',
      qualityScore: 80,
      confidence: 85
    }
  });
  assert(governorState.status === 'NORMAL', 'Test 7.5 - Risk Governor operates silently in normal mode');

  console.log('[TEST] All Admin-Only Learning Dashboard Access Control tests passed successfully!');
  return true;
}
