
export type OrderType = 'MARKET' | 'LIMIT' | 'STOP' | 'STOP_LIMIT';
export type OrderSide = 'BUY' | 'SELL';
export type OrderStatus = 
  | 'CREATED'
  | 'SUBMITTED'
  | 'ACCEPTED'
  | 'PARTIALLY_FILLED'
  | 'FILLED'
  | 'ACTIVE'
  | 'CLOSING'
  | 'CLOSED'
  | 'REJECTED'
  | 'CANCELED'
  | 'EXPIRED'
  | 'UNKNOWN';
export type PositionSide = 'LONG' | 'SHORT';

export interface BrokerAccount {
  accountId: string;
  currency: string;
  balance: number;
  equity: number;
  marginUsed: number;
  marginAvailable: number;
  unrealizedPnL: number;
  leveragedAmount: number;
  status: 'ENABLED' | 'DISABLED' | 'READ_ONLY';
}

export interface BrokerOrder {
  orderId: string;
  clientOrderId?: string;
  tradeId?: string;
  symbol: string;
  type: OrderType;
  side: OrderSide;
  quantity: number;
  price?: number;
  sl?: number;
  tp?: number;
  status: OrderStatus;
  filledQuantity: number;
  remainingQuantity: number;
  averageFillPrice?: number;
  createdAt: number;
  updatedAt: number;
  expiry?: number;
}

export interface BrokerPosition {
  positionId: string;
  symbol: string;
  side: PositionSide;
  quantity: number;
  averageEntryPrice: number;
  currentPrice: number;
  sl?: number;
  tp?: number;
  unrealizedPnL: number;
  realizedPnL: number;
  swap: number;
  commission: number;
  openedAt: number;
}

export interface BrokerFill {
  fillId: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  commission: number;
  timestamp: number;
}

export interface BrokerExecution {
  executionId: string;
  orderId: string;
  symbol: string;
  side: OrderSide;
  quantity: number;
  price: number;
  commission: number;
  timestamp: number;
  slippage?: number;
}

export interface BrokerPnL {
  tradeId: string;
  symbol: string;
  grossPnL: number;
  netPnL: number;
  commission: number;
  swap: number;
  slippage: number;
  fees: number;
  realizedR?: number;
}

export interface BrokerError {
  code: string;
  message: string;
  retryable: boolean;
  timestamp: number;
}

export interface BrokerQuote {
  symbol: string;
  bid: number;
  ask: number;
  spread: number;
  timestamp: number;
  source: string;
}

export interface BrokerReconciliationResult {
  match: boolean;
  discrepancies: string[];
  reconciledAt: number;
}
