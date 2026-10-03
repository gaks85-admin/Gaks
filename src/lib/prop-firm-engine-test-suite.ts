import { calculatePositionSize, extractRiskPreferences } from './risk-engine.js';
import { resolvePersistedAccountType } from './prop-firm-service.js';

export function runPropFirmEngineTests(): { total: number; passed: number; failed: number; failures: string[] } {
  const failures: string[] = [];
  let total = 0;
  let passed = 0;

  function assert(condition: boolean, testName: string) {
    total++;
    if (condition) {
      passed++;
    } else {
      failures.push(testName);
    }
  }

  // 1. Account type resolution
  assert(resolvePersistedAccountType('prop') === 'prop', 'resolvePersistedAccountType prop');
  assert(resolvePersistedAccountType('PROP') === 'prop', 'resolvePersistedAccountType PROP uppercase');
  assert(resolvePersistedAccountType('prop_firm') === 'prop', 'resolvePersistedAccountType prop_firm');
  assert(resolvePersistedAccountType('personal') === 'personal', 'resolvePersistedAccountType personal');
  assert(resolvePersistedAccountType(null) === 'personal', 'resolvePersistedAccountType null defaults to personal');
  assert(resolvePersistedAccountType(undefined) === 'personal', 'resolvePersistedAccountType undefined defaults to personal');

  // 2. Personal Account legacy extraction
  const personalPrefs = extractRiskPreferences({
    custom_capital: '10',
    preferred_risk: '20%'
  });
  assert(personalPrefs.accountSize === 10, 'Personal account size extract $10');
  assert(personalPrefs.riskPercentage === 20, 'Personal risk percentage extract 20%');

  // 3. Prop firm sizing calculation (FTMO $100k, 0.5% risk -> $500 risk budget, entry 4122.59, SL 4142.33 -> 0.25 lots)
  const propSizing = calculatePositionSize({
    accountSize: 100000,
    riskPercentage: 0.5,
    entryPrice: 4122.59,
    stopLoss: 4142.33,
    symbol: 'XAUUSD'
  });
  assert(propSizing.accepted === true, 'Prop firm sizing accepted');
  assert(propSizing.lots === 0.25, `Prop firm lots expected 0.25, got ${propSizing.lots}`);
  assert(propSizing.riskAmount === 500, `Prop firm risk amount expected 500, got ${propSizing.riskAmount}`);
  assert(propSizing.expectedLoss === 493.5, `Prop firm expected loss expected 493.5, got ${propSizing.expectedLoss}`);

  // 4. Legacy personal account sizing calculation ($10 capital, 20% risk -> $2 risk budget, SL distance 19.74 -> 0.001 lot < min lot 0.01 -> rejected)
  const legacySizing = calculatePositionSize({
    accountSize: 10,
    riskPercentage: 20,
    entryPrice: 4122.59,
    stopLoss: 4142.33,
    symbol: 'XAUUSD'
  });
  assert(legacySizing.accepted === false, 'Legacy $10/20% account correctly rejected due to min lot violation');

  return { total, passed, failed: failures.length, failures };
}
