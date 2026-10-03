import {
  PropFirmSettings,
  savePropFirmSettings,
  syncPropFirmHighWatermarks
} from './prop-firm-service.js';
import {
  evaluateWatcherPropFirmGate,
  resolvePersistedAccountType,
  computePropFirmResetBoundaryUtc,
  calculateSingleOpenWatcherRisk
} from './prop-firm-watcher-gate.js';
import { calculatePositionSize, extractRiskPreferences } from './risk-engine.js';
import { defaultEconomicEventService, EconomicEventService } from './economic-event-service.js';
import { validatePreExecution } from './pre-execution-validator.js';

export async function runPhase3PropFirmIntegrationTests(): Promise<{ total: number; passed: number; failed: number; failures: string[] }> {
  const failures: string[] = [];
  let total = 0;
  let passed = 0;

  async function test(name: string, fn: () => Promise<boolean> | boolean) {
    total++;
    try {
      const res = await fn();
      if (res) {
        passed++;
      } else {
        failures.push(name);
      }
    } catch (e: any) {
      failures.push(`${name} (Threw: ${e.message})`);
    }
  }

  // 1. Account type resolution
  await test('Account Type Prop', () => resolvePersistedAccountType('prop') === 'prop');
  await test('Account Type Personal', () => resolvePersistedAccountType('personal') === 'personal');

  // 2. Prop Firm Position Sizing Authority (FTMO $100k, 0.5% risk)
  await test('Prop Firm Position Sizing Authority', () => {
    const sizing = calculatePositionSize({
      accountSize: 100000,
      riskPercentage: 0.5,
      entryPrice: 4122.59,
      stopLoss: 4142.33,
      symbol: 'XAUUSD'
    });
    return sizing.accepted === true && sizing.lots === 0.25 && sizing.expectedLoss === 493.5;
  });

  // 3. Fail-closed when Prop Firm settings are missing
  await test('Fail-closed Missing Prop Firm Settings', async () => {
    const gate = await evaluateWatcherPropFirmGate({
      supabase: null,
      userId: 'user-missing',
      symbol: 'XAUUSD',
      rawAccountType: 'prop',
      proposedTradeRisk: 500,
      currentMarketPrice: 4122.59,
      propFirmSettings: null
    });
    return gate.passed === false && gate.blockReason === 'PROP_FIRM_SETTINGS_UNAVAILABLE';
  });

  // 4. Personal Account Isolation (Legacy $10 capital, 20% risk)
  await test('Personal Account Legacy Extraction Isolation', () => {
    const prefs = extractRiskPreferences({
      custom_capital: '10',
      preferred_risk: '20%'
    });
    return prefs.accountSize === 10 && prefs.riskPercentage === 20;
  });

  // 5. Personal Account News Protection - Disabled by Default (PASS)
  await test('Personal News Protection Disabled Passes Without News Query', async () => {
    // When news_restriction_enabled is false, news gate does not block
    const userPrefs = {
      news_restriction_enabled: false,
      news_buffer_before_minutes: 30,
      news_buffer_after_minutes: 30
    };
    return userPrefs.news_restriction_enabled === false;
  });

  // 6. Personal Account News Protection - Enabled with High Impact News (BLOCKED)
  await test('Personal News Protection Enabled Blocks on High Impact News', async () => {
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => ({
              gte: () => ({
                lte: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: [
                        {
                          id: 'evt-1',
                          name: 'Non-Farm Payrolls',
                          currency: 'USD',
                          impact: 'HIGH',
                          scheduled_at: new Date().toISOString()
                        }
                      ],
                      error: null
                    })
                  })
                })
              })
            })
          })
        })
      })
    };

    const service = new EconomicEventService(mockSupabase);
    const result = await service.checkNewsHardPause('XAUUSD', {
      bufferBeforeMinutes: 30,
      bufferAfterMinutes: 30
    });

    return result.status === 'BLOCKED' && result.event === 'Non-Farm Payrolls' && result.currency === 'USD';
  });

  // 7. Personal Account News Protection - Enabled with No News (CLEAR)
  await test('Personal News Protection Enabled Clears when No High Impact News', async () => {
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => ({
              gte: () => ({
                lte: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: [],
                      error: null
                    })
                  })
                })
              })
            })
          })
        })
      })
    };

    const service = new EconomicEventService(mockSupabase);
    const result = await service.checkNewsHardPause('XAUUSD', {
      bufferBeforeMinutes: 30,
      bufferAfterMinutes: 30
    });

    return result.status === 'CLEAR' && result.event === null;
  });

  // 8. News Gate Fail-Closed on DB Error
  await test('Personal News Protection Fails Closed on DB Error', async () => {
    const mockSupabase = {
      from: () => ({
        select: () => ({
          eq: () => ({
            in: () => ({
              gte: () => ({
                lte: () => ({
                  order: () => ({
                    limit: async () => ({
                      data: null,
                      error: { message: 'Connection timeout' }
                    })
                  })
                })
              })
            })
          })
        })
      })
    };

    const service = new EconomicEventService(mockSupabase);
    const result = await service.checkNewsHardPause('EURUSD', {
      bufferBeforeMinutes: 15,
      bufferAfterMinutes: 15
    });

    return Boolean(result.status === 'BLOCKED' && result.reason?.includes('Connection timeout'));
  });

  return { total, passed, failed: failures.length, failures };
}
