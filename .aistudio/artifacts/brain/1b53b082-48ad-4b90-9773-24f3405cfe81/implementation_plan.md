# Revised Implementation Plan - Fully Dynamic Symbol Support in Gaks AI

## Objective
Remove hardcoded symbol whitelists in `src/lib/watcher-handlers/start.ts` and make symbol validation **fully dynamic**. Users will be able to add any currency pair (`USDCAD`, `AUDUSD`, `AUDCAD`, `EURGBP`, etc.), index (`US30`, `NAS100`, `SPX500`, `GER30`, `UK100`, `US2000`), commodity (`XAUUSD`, `XAGUSD`), or crypto ticker without restrictions.

## Proposed Changes

### 1. Make `isSupportedSymbol` Dynamic in `src/lib/watcher-handlers/start.ts`
- Instead of checking against a fixed array of 6 symbols, update `isSupportedSymbol` to accept any standard alphanumeric ticker symbol format (3 to 10 characters, supporting forex pairs, indices, metals, and crypto).
- Rely on the robust Twelve Data gateway symbol validation during data fetching.

### 2. Update Quick-Add Pills & UI in `src/components/WatcherTab.tsx`
- Ensure the UI allows typing any custom symbol smoothly.

## Verification Plan
- Compile applet with `compile_applet`.
- Test watcher activation with custom symbols like `USDCAD`, `AUDUSD`, `AUDCAD`, and `GER30` to verify successful acceptance.
