# Implementation Plan: Historical Trading Costs and Execution Cost Engine

## 1. Scope
Implement connected execution-cost components for the Gaks AI backtesting engine:
- Spread modelling (bid/ask, fixed/variable)
- Slippage modelling (fixed/configurable)
- Commission modelling (per lot, round-turn, per-side)
- Swap and overnight rollover modelling

## 2. Changes
- Update `BacktestSimulationConfig` in `src/lib/backtest-types.ts` to include granular cost settings.
- Update `BacktestTradeRecord` to include all detailed cost components for inspection.
- Update `src/lib/backtest-trade-simulator.ts` to implement the cost logic during trade entry, exit, and rollover.
- Update `src/lib/backtest-analytics.ts` to use net PnL after all costs.

## 3. Implementation Steps
1.  Extend `BacktestSimulationConfig` and `BacktestTradeRecord` with new cost settings and fields.
2.  Implement `calculateSpreadCost`, `calculateSlippageCost`, `calculateCommission`, and `calculateSwapCost` in a new utility or within `backtest-trade-simulator.ts`.
3.  Integrate these functions into `backtest-trade-simulator.ts` to update `BacktestTradeRecord` during simulation.
4.  Update `backtest-engine.ts` if necessary to propagate configuration.
5.  Add unit tests for each cost component and integration tests.
6.  Update UI if necessary to display cost breakdown.

## 4. Verification
- Run regression tests for backtest engine, simulator, and analytics.
- Ensure all deterministic requirements are met.
