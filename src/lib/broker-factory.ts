import { TheoreticalBrokerProvider, BrokerExecutionProvider } from './broker-execution-provider.js';
import { PaperBrokerProvider } from './paper-broker-provider.js';

let providerInstance: BrokerExecutionProvider | null = null;

export function getBrokerProvider(): BrokerExecutionProvider {
  if (providerInstance) return providerInstance;

  const mode = process.env.EXECUTION_MODE || 'THEORETICAL';

  console.log(`[BrokerFactory] Initializing provider for mode: ${mode}`);

  switch (mode) {
    case 'PAPER':
      providerInstance = new PaperBrokerProvider(10000);
      break;
    case 'LIVE':
      // In a real scenario, this would be a LiveBrokerProvider (e.g., OANDA, MetaTrader)
      // For now, we default back to Theoretical or Paper if Live is requested but not implemented
      console.warn('[BrokerFactory] LIVE mode requested but no live provider configured. Defaulting to THEORETICAL.');
      providerInstance = new TheoreticalBrokerProvider();
      break;
    case 'THEORETICAL':
    default:
      providerInstance = new TheoreticalBrokerProvider();
      break;
  }

  return providerInstance;
}
