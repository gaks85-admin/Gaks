import { createClient } from "@supabase/supabase-js";
const getSupabase = (token) => {
  const url = process.env.VITE_SUPABASE_URL || "https://wkujrqmxivljnuvumfau.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error("Supabase configuration missing (VITE_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required)");
  }
  const headers = {};
  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }
  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    },
    global: { headers }
  });
};
async function handler(req, res) {
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ success: false, error: "Method Not Allowed" });
  }
  try {
    const authHeader = req.headers.authorization || "";
    const token = authHeader.startsWith("Bearer ") ? authHeader.substring(7) : authHeader;
    const supabase = getSupabase(token || void 0);
    let userId = req.body?.userId;
    const watcherId = req.body?.watcherId;
    const selectedPair = req.body?.selected_pair || req.body?.symbol;
    const action = req.body?.action === "delete" ? "delete" : "stop";
    if (token && !userId) {
      const { data: { user }, error: authError } = await supabase.auth.getUser(token);
      if (user) {
        userId = user.id;
      }
    }
    if (!userId && !watcherId) {
      return res.status(400).json({ success: false, error: "Missing userId or watcherId." });
    }
    let query = supabase.from("watchers").select("*");
    if (watcherId) {
      query = query.eq("id", watcherId);
    } else if (userId) {
      query = query.eq("user_id", userId);
    }
    const { data: allWatchers, error: fetchError } = await query;
    if (fetchError) {
      console.error("[Watcher Stop] Error fetching watchers:", fetchError.message);
      return res.status(500).json({ success: false, error: fetchError.message });
    }
    let watchers = allWatchers || [];
    if (selectedPair && !watcherId) {
      const cleanTarget = String(selectedPair).replace(/[^a-zA-Z0-9]/g, "").toUpperCase();
      watchers = watchers.filter((w) => {
        const p = w.selected_pair || w.symbol || "";
        return String(p).replace(/[^a-zA-Z0-9]/g, "").toUpperCase() === cleanTarget;
      });
    }
    if (!watchers || watchers.length === 0) {
      return res.status(200).json({ success: true, message: "No active watchers found to stop." });
    }
    const clearedFields = {
      trade_status: "WAITING",
      entry_price: null,
      stop_loss: null,
      take_profit: null,
      direction: null,
      opened_at: null,
      closed_at: null,
      cooldown_until: null,
      signal_message_id: null,
      last_scan_at: null,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    };
    for (const w of watchers) {
      const previousStatus = w.status || "UNKNOWN";
      if (action === "delete") {
        await supabase.from("watchers").update(clearedFields).eq("id", w.id);
        await supabase.from("watchers").delete().eq("id", w.id);
      } else {
        await supabase.from("watchers").update({
          status: "stopped",
          stopped_at: (/* @__PURE__ */ new Date()).toISOString(),
          ...clearedFields
        }).eq("id", w.id);
      }
      console.log(`
[WATCHER STOPPED]`);
      console.log(`Watcher ID: ${w.id}`);
      console.log(`Pair: ${w.selected_pair || "N/A"}`);
      console.log(`Previous Status: ${previousStatus}`);
      console.log(`Trade state cleared: YES`);
      console.log(`Cron monitoring stopped: YES
`);
    }
    return res.status(200).json({
      success: true,
      message: `Watcher(s) successfully ${action === "delete" ? "deleted" : "stopped"} and trade state cleared.`
    });
  } catch (err) {
    console.error("[Watcher Stop] Unexpected error:", err);
    return res.status(500).json({ success: false, error: err.message || "Internal server error" });
  }
}
export {
  handler as default
};
