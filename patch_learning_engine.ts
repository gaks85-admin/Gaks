import fs from 'fs';

let content = fs.readFileSync('src/lib/learning-engine.ts', 'utf8');

const filterSnippet = `
    // STAGE 5: Only terminal outcomes may enter the learning dataset
    const validOutcomes = ['WIN', 'LOSS', 'BREAKEVEN', 'BROKER_REALIZED_WIN', 'BROKER_REALIZED_LOSS', 'BROKER_REALIZED_BREAKEVEN'];
    if (!params.outcome || !validOutcomes.includes(params.outcome.toUpperCase())) {
      console.warn(\`[Learning Engine] Rejected non-terminal or invalid outcome: \${params.outcome}\`);
      return null;
    }

    // 2. Strict idempotency check using trade_id`;

content = content.replace('// 2. Strict idempotency check using trade_id', filterSnippet);

fs.writeFileSync('src/lib/learning-engine.ts', content);
