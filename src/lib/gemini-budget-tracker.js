import { ADMIN_EMAIL } from "./auth-admin.js";
function getLagosCalendarDate() {
  try {
    return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Lagos" }).format(/* @__PURE__ */ new Date());
  } catch {
    const d = /* @__PURE__ */ new Date();
    d.setHours(d.getHours() + 1);
    return d.toISOString().split("T")[0];
  }
}
const STRICT_MAX_GEMINI_CALLS_PER_USER_PER_DAY = 10;
const inMemoryDailyUsage = /* @__PURE__ */ new Map();
async function checkAndIncrementGeminiBudget(supabase, userId, userEmail) {
  const dateLagos = getLagosCalendarDate();
  let isAdmin = (userEmail || "").toLowerCase().trim() === ADMIN_EMAIL.toLowerCase().trim();
  if (!isAdmin && userId && supabase) {
    try {
      const { data: adminRecord } = await supabase.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle();
      if (adminRecord) isAdmin = true;
    } catch {
    }
  }
  const maxLimit = STRICT_MAX_GEMINI_CALLS_PER_USER_PER_DAY;
  const usageKey = `${userId}_${dateLagos}`;
  let currentCount = 0;
  try {
    const { data, error } = await supabase.from("gemini_daily_usage").select("request_count").eq("user_id", userId).eq("date_lagos", dateLagos).maybeSingle();
    if (error) {
      const mem = inMemoryDailyUsage.get(usageKey);
      if (mem && mem.date === dateLagos) {
        currentCount = mem.count;
      }
    } else if (data) {
      currentCount = data.request_count || 0;
    }
  } catch {
    const mem = inMemoryDailyUsage.get(usageKey);
    if (mem && mem.date === dateLagos) {
      currentCount = mem.count;
    }
  }
  if (currentCount >= maxLimit) {
    return {
      allowed: false,
      currentCount,
      maxLimit,
      isAdmin,
      dateLagos,
      reason: "GEMINI_DAILY_BUDGET_EXHAUSTED"
    };
  }
  const newCount = currentCount + 1;
  inMemoryDailyUsage.set(usageKey, { count: newCount, date: dateLagos });
  try {
    const { error: upsertErr } = await supabase.from("gemini_daily_usage").upsert({
      user_id: userId,
      date_lagos: dateLagos,
      request_count: newCount,
      updated_at: (/* @__PURE__ */ new Date()).toISOString()
    }, { onConflict: "user_id,date_lagos" });
    if (upsertErr && upsertErr.code !== "PGRST205" && !upsertErr.message?.includes("does not exist")) {
      console.warn("[Gemini Budget Tracker] Upsert warning:", upsertErr.message);
    }
  } catch (err) {
    if (err?.code !== "PGRST205" && !err?.message?.includes("does not exist")) {
      console.warn("[Gemini Budget Tracker] Upsert warning:", err?.message || err);
    }
  }
  return {
    allowed: true,
    currentCount: newCount,
    maxLimit,
    isAdmin,
    dateLagos
  };
}
async function getGeminiBudgetStatus(supabase, userId, userEmail) {
  const dateLagos = getLagosCalendarDate();
  let isAdmin = (userEmail || "").toLowerCase().trim() === ADMIN_EMAIL.toLowerCase().trim();
  if (!isAdmin && userId && supabase) {
    try {
      const { data: adminRecord } = await supabase.from("app_admins").select("user_id").eq("user_id", userId).maybeSingle();
      if (adminRecord) isAdmin = true;
    } catch {
    }
  }
  const maxLimit = STRICT_MAX_GEMINI_CALLS_PER_USER_PER_DAY;
  const usageKey = `${userId}_${dateLagos}`;
  let currentCount = 0;
  try {
    const { data, error } = await supabase.from("gemini_daily_usage").select("request_count").eq("user_id", userId).eq("date_lagos", dateLagos).maybeSingle();
    if (error) {
      const mem = inMemoryDailyUsage.get(usageKey);
      if (mem && mem.date === dateLagos) currentCount = mem.count;
    } else if (data) {
      currentCount = data.request_count || 0;
    }
  } catch {
    const mem = inMemoryDailyUsage.get(usageKey);
    if (mem && mem.date === dateLagos) currentCount = mem.count;
  }
  return { currentCount, maxLimit, isAdmin, dateLagos };
}
export {
  STRICT_MAX_GEMINI_CALLS_PER_USER_PER_DAY,
  checkAndIncrementGeminiBudget,
  getGeminiBudgetStatus,
  getLagosCalendarDate
};
