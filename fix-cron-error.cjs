const fs = require('fs');

let content = fs.readFileSync('api/cron/market-watcher.ts', 'utf8');

// The generic error catch block:
// } catch (err) {
//   const totalTime = Date.now() - startTime;
//   console.error("[Market Watcher Cron] Fatal Error:", err.message || err);
//
// Change it to catch (err: any) and log the stack.
// Also check for Gemini errors.

content = content.replace(/} catch \(err\) {[\s\S]*?return res\.status\(500\)\.json\({ success: false, error: "Internal Server Error" }\);\n  }/, `} catch (err: any) {
    const totalTime = Date.now() - startTime;
    console.error("[Market Watcher Cron] Fatal Error Stack:", err.stack || err);
    
    let errorMsg = err.message || "Unknown error";
    if (errorMsg.includes("Gemini") || (err.stack && err.stack.includes("Gemini")) || errorMsg.includes("API key not valid") || errorMsg.includes("fetch failed")) {
       errorMsg = "Cron failed because Gemini request failed.";
    } else if (err.status && typeof err.status === 'number' && (err.status >= 400 && err.status < 600)) {
       errorMsg = "Cron failed because Gemini request failed.";
    }

    console.log(JSON.stringify({
      event: "cycle_complete",
      status: "fatal_error",
      error: errorMsg,
      totalWatchers: 0,
      processedCount: watchersProcessedCount,
      skippedCount: watchersSkippedCount,
      geminiAnalysesCount: watchersProcessedCount,
      telegramMessagesSentCount: telegramMessagesSentCount,
      executionTimeMs: totalTime
    }));

    return res.status(500).json({ success: false, error: errorMsg });
  }`);

fs.writeFileSync('api/cron/market-watcher.ts', content);
