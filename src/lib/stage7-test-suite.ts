import { TheoreticalBrokerProvider } from './broker-execution-provider.js';
import { PaperBrokerProvider } from './paper-broker-provider.js';
import { revalidatePreExecution, FinalExecutionState } from './pre-execution-validator.js';
import { BrokerQuote } from './broker-types.js';

async function runStage7Tests() {
  console.log('Starting Stage 7: Live Broker & Paper-Trading Validation Audit...\n');

  // --- 1. BROKER QUOTE INTEGRATION ---
  console.log('--- 1. BROKER QUOTE INTEGRATION ---');
  const paperProvider = new PaperBrokerProvider(10000);
  
  try {
    const quote = await paperProvider.getQuote('EURUSD');
    console.log(`✅ PASSED: Quote Fetching (${quote.symbol} Bid: ${quote.bid} Ask: ${quote.ask} Source: ${quote.source})`);
  } catch (err) {
    console.error('❌ FAILED: Quote Fetching');
  }

  // --- 2. BROKER QUOTE FRESHNESS ---
  console.log('\n--- 2. BROKER QUOTE FRESHNESS ---');
  const freshQuote: BrokerQuote = {
    symbol: 'EURUSD',
    bid: 1.0500,
    ask: 1.0502,
    spread: 0.0002,
    timestamp: Date.now(),
    source: 'TEST'
  };

  const staleQuote: BrokerQuote = {
    symbol: 'EURUSD',
    bid: 1.0500,
    ask: 1.0502,
    spread: 0.0002,
    timestamp: Date.now() - 10000, // 10s old
    source: 'TEST'
  };

  const baseState: FinalExecutionState = {
    marketDataAvailable: true,
    marketDataFreshness: { isValid: true, dataAgeMs: 100, signalAgeMs: 100, entryDistance: 0 },
    currentPrice: 1.0502,
    spread: 0.0002,
    entryPrice: 1.0502,
    sl: 1.0400,
    tp: 1.0700,
    rr: 2.0,
    riskGovernorPassed: true,
    newsGate: { tradeBlocked: false, eventDetected: false },
    positionSizing: 0.1,
    userRiskLimitsPassed: true,
    duplicateTradeProtectionPassed: true,
    signalExpired: false
  };

  const freshRes = revalidatePreExecution({
    ...baseState,
    brokerQuote: freshQuote,
    brokerQuoteFreshnessPassed: true
  });
  console.log(freshRes.status === 'FINAL_EXECUTION_AUTHORIZED' ? '✅ PASSED: Fresh Quote Accepted' : `❌ FAILED: Fresh Quote Rejected (${freshRes.rejectionReason})`);

  const staleRes = revalidatePreExecution({
    ...baseState,
    brokerQuote: staleQuote,
    brokerQuoteFreshnessPassed: false
  });
  console.log(staleRes.status === 'FINAL_EXECUTION_REJECTED' && staleRes.rejectionReason === 'BROKER_QUOTE_STALE' ? '✅ PASSED: Stale Quote Rejected' : '❌ FAILED: Stale Quote Handling');

  // --- 3. REAL SPREAD VALIDATION ---
  console.log('\n--- 3. REAL SPREAD VALIDATION ---');
  const wideQuote: BrokerQuote = {
    ...freshQuote,
    spread: 0.0020 // 20 pips, very wide
  };

  const wideRes = revalidatePreExecution({
    ...baseState,
    brokerQuote: wideQuote,
    brokerQuoteFreshnessPassed: true,
    maxSpreadThreshold: 0.0005 // 5 pips max
  });
  console.log(wideRes.status === 'FINAL_EXECUTION_REJECTED' && wideRes.rejectionReason === 'EXCESSIVE_SPREAD' ? '✅ PASSED: Excessive Spread Rejected' : '❌ FAILED: Spread Validation');

  // --- 4. ENTRY DRIFT VALIDATION ---
  console.log('\n--- 4. ENTRY DRIFT VALIDATION ---');
  const driftedState: FinalExecutionState = {
    ...baseState,
    currentPrice: 1.0550, // Drifted far from intended 1.0502
    intendedEntryPrice: 1.0502,
    brokerQuote: { ...freshQuote, ask: 1.0550 },
    brokerQuoteFreshnessPassed: true,
    maxEntryDriftThreshold: 0.001 // 0.1% max drift
  };

  const driftRes = revalidatePreExecution(driftedState);
  console.log(driftRes.status === 'FINAL_EXECUTION_REJECTED' && driftRes.rejectionReason === 'EXCESSIVE_ENTRY_DRIFT' ? '✅ PASSED: Excessive Drift Rejected' : '❌ FAILED: Drift Validation');

  // --- 5. IDEMPOTENT ORDER SUBMISSION ---
  console.log('\n--- 5. IDEMPOTENT ORDER SUBMISSION ---');
  const testClientOrderId = 'test-idemp-123';
  await paperProvider.placeOrder({
    symbol: 'EURUSD',
    side: 'BUY',
    quantity: 0.1,
    clientOrderId: testClientOrderId
  });

  const duplicateOrder = await paperProvider.findOrderByClientOrderId(testClientOrderId);
  console.log(duplicateOrder !== null && duplicateOrder.clientOrderId === testClientOrderId ? '✅ PASSED: Idempotency Lookup Successful' : '❌ FAILED: Idempotency Lookup');

  // --- 6. PAPER EXECUTION LIFECYCLE ---
  console.log('\n--- 6. PAPER EXECUTION LIFECYCLE ---');
  const initialAccount = await paperProvider.getAccount();
  console.log(`Initial Balance: $${initialAccount.balance}`);
  
  await paperProvider.placeOrder({
    symbol: 'GBPUSD',
    side: 'BUY',
    quantity: 1.0,
    price: 1.2500
  });
  
  const pos = await paperProvider.getPosition('GBPUSD');
  if (pos) {
    console.log(`✅ PASSED: Position Opened (${pos.symbol} Qty: ${pos.quantity} Price: ${pos.averageEntryPrice})`);
    
    await paperProvider.closePosition('GBPUSD');
    const closedPos = await paperProvider.getPosition('GBPUSD');
    const finalAccount = await paperProvider.getAccount();
    
    if (!closedPos) {
      console.log(`✅ PASSED: Position Closed. Final Balance: $${finalAccount.balance.toFixed(2)}`);
    } else {
      console.error('❌ FAILED: Position Closing');
    }
  } else {
    console.error('❌ FAILED: Position Opening');
  }

  // --- 7. SLIPPAGE TRACKING ---
  console.log('\n--- 7. SLIPPAGE TRACKING ---');
  const history = await paperProvider.getExecutionHistory('GBPUSD');
  if (history.length > 0 && history[0].slippage !== undefined) {
    console.log(`✅ PASSED: Slippage Recorded (${history[0].slippage.toFixed(5)} pips)`);
  } else {
    console.error('❌ FAILED: Slippage Tracking');
  }

  console.log('\nStage 7 Audit Complete.');
}

runStage7Tests().catch(console.error);
