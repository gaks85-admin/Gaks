export interface PreExecutionValidationParams {
  symbol: string;
  lotSize: number;
  entryPrice: number;
  stopLoss: number;
  takeProfit?: number;
}

export function validatePreExecution(params: PreExecutionValidationParams): { valid: boolean; reason?: string } {
  if (!params.symbol || params.symbol.trim() === '') {
    return { valid: false, reason: 'Invalid trading symbol' };
  }
  if (params.lotSize <= 0) {
    return { valid: false, reason: 'Invalid lot size: must be > 0' };
  }
  if (params.entryPrice <= 0 || params.stopLoss <= 0) {
    return { valid: false, reason: 'Invalid entry or stop loss price' };
  }
  return { valid: true };
}

export const revalidatePreExecution = validatePreExecution;

