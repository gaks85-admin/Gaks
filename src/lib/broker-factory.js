import { TheoreticalBrokerProvider } from "./broker-execution-provider.js";
import { PaperBrokerProvider } from "./paper-broker-provider.js";
let providerInstance = null;
function getBrokerProvider() {
  if (providerInstance) return providerInstance;
  const mode = process.env.EXECUTION_MODE || "THEORETICAL";
  console.log(`[BrokerFactory] Initializing provider for mode: ${mode}`);
  switch (mode) {
    case "PAPER":
      providerInstance = new PaperBrokerProvider(1e4);
      break;
    case "LIVE":
      console.warn("[BrokerFactory] LIVE mode requested but no live provider configured. Defaulting to THEORETICAL.");
      providerInstance = new TheoreticalBrokerProvider();
      break;
    case "THEORETICAL":
    default:
      providerInstance = new TheoreticalBrokerProvider();
      break;
  }
  return providerInstance;
}
export {
  getBrokerProvider
};
