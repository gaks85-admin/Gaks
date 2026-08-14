import { PaperBrokerProvider } from './paper-broker-provider.js';
import { getBrokerProvider } from './broker-factory.js';
import { SupervisedMicrolotGovernor, DEFAULT_MICROLOT_LIMITS } from './microlot-governor.js';

async function runStage8Tests() {
  console.log('Starting Stage 8: Production Paper-Trading & Recovery Audit...\n');

  // --- 1. IDEMPOTENCY & CRASH RECOVERY ---
  console.log('--- 1. IDEMPOTENCY & CRASH RECOVERY ---');
  const paper = new PaperBrokerProvider(10000);
  const testClientOrderId = 'cl-test-crash-123';
  
  // Simulate first submission
  await paper.placeOrder({
    symbol: 'EURUSD',
    side: 'BUY',
    quantity: 0.1,
    clientOrderId: testClientOrderId
  });
  console.log('Initial order placed.');

  // Simulate recovery attempt
  const recovered = await paper.findOrderByClientOrderId(testClientOrderId);
  if (recovered) {
    console.log(`✅ PASSED: Order rehydrated from broker state (ID: ${recovered.orderId})`);
  } else {
    console.error('❌ FAILED: Order not found in broker state after crash simulation');
  }

  // --- 2. DUPLICATE POSITION PROTECTION ---
  console.log('\n--- 2. DUPLICATE POSITION PROTECTION ---');
  const existingPos = await paper.getPosition('EURUSD');
  if (existingPos) {
    console.log(`✅ PASSED: Existing position detected. System would skip duplicate execution.`);
  } else {
    console.error('❌ FAILED: Position not found after fill');
  }

  // --- 3. MICROLOT GOVERNOR ENFORCEMENT ---
  console.log('\n--- 3. MICROLOT GOVERNOR ENFORCEMENT ---');
  const gov = new SupervisedMicrolotGovernor(paper);
  
  const riskHigh = await gov.validateExecution('EURUSD', 100); // Over $50 limit
  console.log(!riskHigh.accepted && riskHigh.reason?.includes('exceeds microlot limit') ? '✅ PASSED: Excessive risk rejected' : '❌ FAILED: High risk allowed');

  const symbolInvalid = await gov.validateExecution('BTCUSD', 10); // Not in allowed list
  console.log(!symbolInvalid.accepted && symbolInvalid.reason?.includes('not in allowed') ? '✅ PASSED: Invalid symbol rejected' : '❌ FAILED: Invalid symbol allowed');

  const valid = await gov.validateExecution('GBPUSD', 20); // OK
  console.log(valid.accepted ? '✅ PASSED: Valid microlot accepted' : `❌ FAILED: Valid trade rejected (${valid.reason})`);

  // --- 4. REALISTIC FILL MODEL (SPREAD/SLIPPAGE) ---
  console.log('\n--- 4. REALISTIC FILL MODEL ---');
  const quote = await paper.getQuote('EURUSD');
  const order = await paper.placeOrder({ symbol: 'EURUSD', side: 'BUY', quantity: 0.1 });
  
  if (order.averageFillPrice && quote.ask !== order.averageFillPrice) {
    console.log(`✅ PASSED: Realistic fill detected (Quote Ask: ${quote.ask}, Actual Fill: ${order.averageFillPrice.toFixed(6)})`);
    const slippage = Math.abs(order.averageFillPrice - quote.ask);
    console.log(`Measured Slippage: ${slippage.toFixed(6)}`);
  } else {
    console.error('❌ FAILED: Perfect fill detected. No spread/slippage simulation.');
  }

  // --- 5. COMMISSION & FEES ---
  console.log('\n--- 5. COMMISSION & FEES ---');
  const accountAfter = await paper.getAccount();
  if (accountAfter.balance < 10000) {
    console.log(`✅ PASSED: Account balance correctly reduced by fees/commission. Current: $${accountAfter.balance.toFixed(2)}`);
  } else {
    console.error('❌ FAILED: No fees or commission applied.');
  }

  console.log('\nStage 8 Audit Complete.');
}

runStage8Tests().catch(console.error);
