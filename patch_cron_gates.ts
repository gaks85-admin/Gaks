import fs from 'fs';

let content = fs.readFileSync('api/cron/market-watcher.ts', 'utf8');

// Replace the STAGE 5 code with the corrected version
const oldStage5Pattern = /\s*\/\/ === STAGE 5 HARDENING: NEWS HARD-PAUSE GATE ===[\s\S]*?console\.log\(\`\[THEORETICAL BROKER\] Order Placed: \$\{brokerOrder\.orderId\}\`\);/g;

const newGates = `
        // === STAGE 5 HARDENING: NEWS HARD-PAUSE GATE ===
        const newsGateResult = await defaultEconomicEventService.checkNewsHardPause(selectedPair);

        const marketCandleTimestampMs = new Date(tsResult.candles[tsResult.candles.length - 1]?.timestamp || Date.now()).getTime();

        // === STAGE 5 HARDENING: EXECUTION FRESHNESS GATE ===
        const freshnessResult = validateExecutionFreshness({
          signalGeneratedAt: Date.now(),
          marketDataTimestamp: marketCandleTimestampMs,
          currentPrice: executedPrice,
          entryPrice: posSizeResult.entryPrice || executedPrice,
          stopLoss: posSizeResult.stopLoss,
          takeProfit: posSizeResult.takeProfit || 0,
          instrument: selectedPair,
          timeframe: selectedTimeframe,
          isBuy: analysis.signal === 'BUY'
        }, executedPrice * 0.9999, executedPrice * 1.0001); // Simulated bid/ask

        // === STAGE 5 HARDENING: FINAL PRE-EXECUTION REVALIDATION ===
        const finalValidation = revalidatePreExecution({
          marketDataAvailable: true,
          marketDataFreshness: freshnessResult,
          currentPrice: executedPrice,
          spread: (executedPrice * 1.0001) - (executedPrice * 0.9999),
          entryPrice: posSizeResult.entryPrice || executedPrice,
          sl: posSizeResult.stopLoss,
          tp: posSizeResult.takeProfit || 0,
          rr: posSizeResult.actualRr || 0,
          riskGovernorPassed: true, // Governor passed previously
          newsGate: newsGateResult,
          positionSizing: posSizeResult.calculatedLotSize || posSizeResult.exactLotSize,
          userRiskLimitsPassed: true,
          duplicateTradeProtectionPassed: true,
          signalExpired: false
        });

        if (finalValidation.status === 'FINAL_EXECUTION_REJECTED') {
            console.log(\`[Authoritative Decision] Signal suppressed for Watcher ID: \${watcher.id} (\${selectedPair}): Final decision is REJECTED from gate \${finalValidation.rejectionReason}.\`);
            
            const scanDurationMs = Date.now() - scanStart;
            await recordEvaluation(supabase, {
                user_id: userId,
                watcher_id: watcher.id,
                pair: selectedPair,
                timeframe: selectedTimeframe,
                strategy_mode: compiledStrategy.strategy_mode,
                decision_score: decisionResult.decision_score,
                matched_weight: decisionResult.matched_weight,
                possible_weight: decisionResult.possible_weight,
                recommendation: decisionResult.recommendation,
                mandatory_rules_passed: decisionResult.mandatory_rules_passed,
                matched_rules: decisionResult.matched_rules,
                failed_rules: decisionResult.failed_rules,
                gemini_used: geminiCalled,
                gemini_result: geminiTextResult || null,
                trade_sent: false,
                trade_reason: \`Safety Gate Rejected: \${finalValidation.rejectionReason}\`,
                scan_duration_ms: scanDurationMs,
                gemini_duration_ms: geminiDuration,
                decision_snapshot: decisionSnapshot
            });
            continue;
        }

        // === STAGE 5 HARDENING: THEORETICAL BROKER EXECUTION ===
        const brokerOrder = await defaultBrokerProvider.placeOrder({
            symbol: selectedPair,
            type: 'MARKET',
            side: analysis.signal as 'BUY'|'SELL',
            quantity: posSizeResult.calculatedLotSize || posSizeResult.exactLotSize,
            price: executedPrice,
            sl: posSizeResult.stopLoss,
            tp: posSizeResult.takeProfit || undefined
        });
        
        console.log(\`[THEORETICAL BROKER] Order Placed: \${brokerOrder.orderId}\`);`;

content = content.replace(oldStage5Pattern, newGates);

fs.writeFileSync('api/cron/market-watcher.ts', content);
