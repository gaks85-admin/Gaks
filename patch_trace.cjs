const fs = require('fs');

// 1. App.tsx logs
let appContent = fs.readFileSync('src/App.tsx', 'utf8');

appContent = appContent.replace(
  `// Call secure backend activation route`,
  `console.log(\`[WATCHER LIFECYCLE] Frontend payload sent to backend for \${targetSymbol} / \${targetTimeframe}\`);
      // Call secure backend activation route`
);

appContent = appContent.replace(
  `const { data, error } = await supabase
        .from('watchers')
        .select('status, selected_pair, selected_timeframe, trade_status, last_scan_at, last_analyzed_closed_candle_time')
        .eq('user_id', userId);`,
  `const { data, error } = await supabase
        .from('watchers')
        .select('id, status, selected_pair, selected_timeframe, trade_status, last_scan_at, last_analyzed_closed_candle_time')
        .eq('user_id', userId);
      console.log(\`[WATCHER LIFECYCLE] WATCHER FETCHED (loadWatcherStatus): \${JSON.stringify(data)}\`);`
);

appContent = appContent.replace(
  `if (dbW && dbW.status !== 'active') return false;`,
  `if (dbW && dbW.status !== 'active') {
              console.log(\`[WATCHER LIFECYCLE] WATCHER REMOVED from UI: \${w.symbol}, Status: \${dbW.status}\`);
              return false;
            }`
);

appContent = appContent.replace(
  `if (nextList.length === 0) localStorage.removeItem('gaks_watchlist');`,
  `if (nextList.length === 0) {
              console.log(\`[WATCHER LIFECYCLE] WATCHER HIDDEN (Watchlist Empty)\`);
              localStorage.removeItem('gaks_watchlist');
            }`
);

appContent = appContent.replace(
  `const { data, error } = await supabase
        .from('watchers')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');`,
  `const { data, error } = await supabase
        .from('watchers')
        .select('*')
        .eq('user_id', userId)
        .eq('status', 'active');
      console.log(\`[WATCHER LIFECYCLE] WATCHER FETCHED (loadWatchlistFromSupabase): \${JSON.stringify(data)}\`);`
);

fs.writeFileSync('src/App.tsx', appContent);

// 2. api/watcher/start.ts logs
let startContent = fs.readFileSync('api/watcher/start.ts', 'utf8');

startContent = startContent.replace(
  `const { error: watchersError } = await supabase
      .from("watchers")
      .upsert(watcherData, { onConflict: "user_id,selected_pair" });`,
  `console.log(\`[WATCHER LIFECYCLE] Backend INSERT into watchers table: \${JSON.stringify(watcherData)}\`);
    const { error: watchersError, data: insertData } = await supabase
      .from("watchers")
      .upsert(watcherData, { onConflict: "user_id,selected_pair" })
      .select();
    console.log(\`[WATCHER LIFECYCLE] Database row after INSERT: \${JSON.stringify(insertData)}\`);`
);

startContent = startContent.replace(
  `const { data: savedWatcherRow, error: fetchSavedErr } = await supabase
      .from("watchers")
      .select("id, selected_timeframe, scan_interval_minutes")
      .eq("user_id", userId)
      .eq("selected_pair", selectedPair)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();`,
  `const { data: savedWatcherRow, error: fetchSavedErr } = await supabase
      .from("watchers")
      .select("id, status, selected_timeframe, scan_interval_minutes")
      .eq("user_id", userId)
      .eq("selected_pair", selectedPair)
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(1)
      .single();
    console.log(\`[WATCHER LIFECYCLE] WATCHER CREATED / FETCHED: \${JSON.stringify(savedWatcherRow)}\`);`
);

fs.writeFileSync('api/watcher/start.ts', startContent);

// 3. api/watcher/stop.ts logs
let stopContent = fs.readFileSync('api/watcher/stop.ts', 'utf8');

stopContent = stopContent.replace(
  `await supabase.from("watchers").update({
          status: 'stopped',
          stopped_at: new Date().toISOString(),
          ...clearedFields
        }).eq("id", w.id);`,
  `console.log(\`[WATCHER LIFECYCLE] WATCHER UPDATED (status -> stopped) for ID: \${w.id}\`);
        await supabase.from("watchers").update({
          status: 'stopped',
          stopped_at: new Date().toISOString(),
          ...clearedFields
        }).eq("id", w.id);`
);

stopContent = stopContent.replace(
  `await supabase.from("watchers").delete().eq("id", w.id);`,
  `console.log(\`[WATCHER LIFECYCLE] WATCHER DELETED for ID: \${w.id}\`);
        await supabase.from("watchers").delete().eq("id", w.id);`
);

fs.writeFileSync('api/watcher/stop.ts', stopContent);
console.log("Trace added");
