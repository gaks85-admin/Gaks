import fs from 'fs';

let content = fs.readFileSync('api/cron/market-watcher.ts', 'utf8');

// 1. Add idempotency lock
const lockSnippet = `      if (!selectedPair) {
        console.log(\`LOG: Watcher \${watcher.id} skipped - No selected pair\`);
        skipped.push({ userId, reason: "No selected pair" });
        watchersSkippedCount++;
        continue;
      }

      // =====================================================================
      // STAGE 5 IDEMPOTENCY LOCK: CAS update on last_scan_at
      // =====================================================================
      const lockTime = now.toISOString();
      let lockQuery = supabase.from("watchers").update({ last_scan_at: lockTime }).eq("id", watcher.id);
      if (watcher.last_scan_at) {
        lockQuery = lockQuery.eq("last_scan_at", watcher.last_scan_at);
      } else {
        lockQuery = lockQuery.is("last_scan_at", null);
      }
      
      const { data: lockedData, error: lockErr } = await lockQuery.select();
      if (lockErr || !lockedData || lockedData.length === 0) {
        console.log(\`[Idempotency] Watcher \${watcher.id} already being processed by another cron. Skipping.\`);
        skipped.push({ userId, reason: "Duplicate execution protected" });
        watchersSkippedCount++;
        continue;
      }
`;

content = content.replace(/      if \(\!selectedPair\) \{\n.*?\n.*?\n.*?\n      \}/s, lockSnippet);

fs.writeFileSync('api/cron/market-watcher.ts', content);
