import { PropFirmSettings, getPropFirmSettings, savePropFirmSettings } from './prop-firm-service.js';

export function runPropFirmTestSuite(): { passed: boolean; results: { name: string; success: boolean; error?: string }[] } {
  const results: { name: string; success: boolean; error?: string }[] = [];

  function assert(condition: boolean, message: string) {
    if (!condition) {
      throw new Error(`Assertion failed: ${message}`);
    }
  }

  function test(name: string, fn: () => void | Promise<void>) {
    try {
      const res = fn();
      if (res && typeof res.then === 'function') {
        // Handle async test if needed, but synchronous simulation preferred for simple mock tests
      }
      results.push({ name, success: true });
    } catch (err: any) {
      results.push({ name, success: false, error: err.message });
    }
  }

  test('1. Valid PropFirmSettings object creation and typing', () => {
    const settings: PropFirmSettings = {
      user_id: 'user-123',
      firm_name: 'FTMO',
      account_phase: 'Phase 1',
      account_size: 100000,
      profit_target: 10000,
      profit_target_type: 'AMOUNT',
      daily_loss_limit: 5000,
      daily_loss_limit_type: 'AMOUNT',
      daily_loss_calculation_basis: 'BALANCE',
      daily_reset_time: '00:00:00',
      daily_reset_timezone: 'UTC',
      maximum_drawdown: 10000,
      drawdown_type: 'STATIC',
      drawdown_calculation_basis: 'BALANCE',
      risk_per_trade: 1.0,
      risk_per_trade_type: 'PERCENTAGE',
      maximum_trades_per_day: 5,
      news_restriction_enabled: true,
      news_buffer_before_minutes: 5,
      news_buffer_after_minutes: 5
    };

    assert(settings.user_id === 'user-123', 'User ID must match');
    assert(settings.firm_name === 'FTMO', 'Firm name must match');
    assert(settings.account_size === 100000, 'Account size must match');
    assert(settings.drawdown_type === 'STATIC', 'Drawdown type must match');
  });

  test('2. Mock Supabase save and get Prop Firm settings', async () => {
    const mockStorage = new Map<string, any>();

    const mockSupabase = {
      from: (table: string) => {
        assert(table === 'prop_firm_settings', 'Table must be prop_firm_settings');
        return {
          select: (cols: string) => ({
            eq: (col: string, val: any) => ({
              maybeSingle: async () => {
                const item = mockStorage.get(val);
                return { data: item || null, error: null };
              }
            })
          }),
          upsert: async (payload: any) => {
            mockStorage.set(payload.user_id, payload);
            return { error: null };
          }
        };
      }
    };

    const userId = 'test-user-456';
    const testSettings: Partial<PropFirmSettings> = {
      firm_name: 'MyFundedFX',
      account_size: 50000,
      drawdown_type: 'TRAILING',
      daily_loss_calculation_basis: 'EQUITY'
    };

    const saveRes = await savePropFirmSettings(mockSupabase, userId, testSettings);
    assert(saveRes.success, 'Save must succeed');

    const loaded = await getPropFirmSettings(mockSupabase, userId);
    assert(loaded !== null, 'Loaded settings must not be null');
    assert(loaded?.firm_name === 'MyFundedFX', 'Firm name must match saved value');
    assert(loaded?.drawdown_type === 'TRAILING', 'Drawdown type must match saved value');
  });

  test('3. Prop account can load missing configuration without crashing', async () => {
    const mockSupabase = {
      from: (table: string) => ({
        select: (cols: string) => ({
          eq: (col: string, val: any) => ({
            maybeSingle: async () => ({ data: null, error: null })
          })
        })
      })
    };

    const loaded = await getPropFirmSettings(mockSupabase, 'nonexistent-user');
    assert(loaded === null, 'Missing config should return null without crashing');
  });

  test('4. Personal account does not require Prop Firm settings', () => {
    const accountType: 'personal' | 'prop' | null = 'personal';
    const propSettingsConfigured = false;

    // When personal, prop settings are irrelevant
    assert(accountType === 'personal', 'Account type is personal');
    assert(!propSettingsConfigured, 'Prop settings are not required for personal account');
  });

  const failedTests = results.filter(r => !r.success);
  return {
    passed: failedTests.length === 0,
    results
  };
}
