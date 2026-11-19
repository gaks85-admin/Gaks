import { normalizeZoneTimeframe } from "../zone-engine.js";
function getActiveSessionsUtc(date) {
  const hour = date.getUTCHours();
  const active = [];
  if (hour >= 7 && hour < 16) active.push("London");
  if (hour >= 12 && hour < 21) active.push("New York");
  if (hour >= 12 && hour < 16) active.push("Overlap");
  if (hour >= 0 && hour < 9) active.push("Asian", "Tokyo");
  if (hour >= 21 || hour < 6) active.push("Sydney");
  return active;
}
const SessionModule = {
  id: "session",
  name: "Session Filter",
  category: "FILTER",
  aliases: ["session", "session_filter"],
  requiresSwings: false,
  requiresAtr: false,
  execute: (ctx) => {
    const allowed = Array.isArray(ctx.moduleSpec.params?.sessions) ? ctx.moduleSpec.params.sessions : ctx.compiledRules.session || [];
    const refDate = ctx.now || (ctx.latestCandle?.timestamp ? new Date(ctx.latestCandle.timestamp) : /* @__PURE__ */ new Date());
    const validDate = isNaN(refDate.getTime()) ? /* @__PURE__ */ new Date() : refDate;
    const activeSessions = getActiveSessionsUtc(validDate);
    const activeLabel = activeSessions.length > 0 ? activeSessions.join("/") : "Off-Hours";
    const matched = allowed.length === 0 || allowed.some(
      (req) => activeSessions.some((act) => act.toLowerCase().includes(req.toLowerCase()) || req.toLowerCase().includes(act.toLowerCase()))
    );
    return {
      moduleId: "session",
      moduleName: "Session Filter",
      category: "FILTER",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10: matched ? 10 : 0,
      direction: "NEUTRAL",
      reason: matched ? `UTC Session [${activeLabel}] matches configured sessions (${allowed.join(", ") || "Any"}).` : `UTC Session [${activeLabel}] is outside allowed sessions (${allowed.join(", ")}).`,
      evidence: [`UTC Hour: ${validDate.getUTCHours()}:00`, `Active: ${activeLabel}`],
      metrics: { utcHour: validDate.getUTCHours(), activeSessions, allowedSessions: allowed },
      structurePatch: { session: activeLabel, sessions: activeSessions }
    };
  }
};
const TimeframeModule = {
  id: "timeframes",
  name: "Timeframe Filter",
  category: "FILTER",
  aliases: ["timeframes", "timeframe"],
  requiresSwings: false,
  requiresAtr: false,
  execute: (ctx) => {
    const allowed = Array.isArray(ctx.moduleSpec.params?.timeframes) ? ctx.moduleSpec.params.timeframes : ctx.compiledRules.timeframes || [];
    const currentTf = normalizeZoneTimeframe(ctx.timeframe || ctx.marketStructure.timeframe);
    const matched = allowed.length === 0 || !currentTf || allowed.some((tf) => {
      const normAllowed = normalizeZoneTimeframe(tf);
      return normAllowed === currentTf || tf.toLowerCase().includes(currentTf.toLowerCase());
    });
    return {
      moduleId: "timeframes",
      moduleName: "Timeframe Filter",
      category: "FILTER",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10: matched ? 10 : 0,
      direction: "NEUTRAL",
      reason: matched ? `Active timeframe ${currentTf || "N/A"} aligns with strategy timeframes (${allowed.join(", ") || "Any"}).` : `Active timeframe ${currentTf} is not in allowed strategy timeframes (${allowed.join(", ")}).`,
      evidence: [`Timeframe: ${currentTf || "Unknown"}`],
      metrics: { currentTimeframe: currentTf, allowedTimeframes: allowed }
    };
  }
};
const RiskRewardModule = {
  id: "risk_reward",
  name: "Risk Reward",
  category: "RISK",
  aliases: ["risk_reward", "rr"],
  requiresSwings: false,
  requiresAtr: true,
  execute: (ctx) => {
    const minRatio = ctx.moduleSpec.params?.min_ratio ?? ctx.compiledRules.risk_reward?.min_ratio ?? 2;
    const existingRatio = ctx.marketStructure.risk_reward_ratio ?? ctx.marketStructure.rr;
    let ratio = typeof existingRatio === "number" ? existingRatio : minRatio;
    const zone = ctx.marketStructure.markedZone;
    if (typeof existingRatio !== "number" && zone && zone.invalidationLevel && ctx.atr > 0) {
      const stopDist = Math.abs(ctx.currentPrice - zone.invalidationLevel);
      if (stopDist > 0) {
        const defaultTpDist = Math.max(stopDist * minRatio, ctx.atr * 2.5);
        ratio = Number((defaultTpDist / stopDist).toFixed(2));
      }
    }
    const matched = ratio >= minRatio;
    return {
      moduleId: "risk_reward",
      moduleName: "Risk Reward",
      category: "RISK",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10: matched ? 10 : 0,
      direction: "NEUTRAL",
      reason: matched ? `Risk-to-Reward ratio ${ratio}:1 meets minimum required ${minRatio}:1.` : `Risk-to-Reward ratio ${ratio}:1 is below minimum required ${minRatio}:1.`,
      evidence: [`R:R ${ratio}:1 (min ${minRatio}:1)`],
      metrics: { ratio, minRatio },
      structurePatch: { risk_reward_ratio: ratio }
    };
  }
};
const TapAndRejectionModule = {
  id: "tap_and_rejection",
  name: "Tap and Rejection",
  category: "PRICE_ACTION",
  aliases: ["tap_and_rejection"],
  requiresSwings: false,
  requiresAtr: false,
  execute: (ctx) => {
    const ms = ctx.marketStructure;
    const isRejected = ms.zone_rejected === true || ms.rejectionConfirmed === true;
    const isTapped = ms.zone_tapped === true || ms.zone_status === "ZONE_TAPPED" || ms.zone_status === "CONFIRMED" || Array.isArray(ms.orderBlocks) && ms.orderBlocks.some((ob) => ob.isTappedNow);
    const matched = isRejected || isTapped;
    const scoreOutOf10 = isRejected && isTapped ? 10 : isTapped ? 9 : 0;
    return {
      moduleId: "tap_and_rejection",
      moduleName: "Tap and Rejection",
      category: "PRICE_ACTION",
      activated: true,
      executed: true,
      matched,
      scoreOutOf10,
      direction: "NEUTRAL",
      reason: matched ? `Zone tap${isRejected ? " and rejection" : ""} confirmed.` : "Waiting for price to tap and reject marked zone.",
      evidence: [matched ? "Zone tap confirmed" : "Awaiting zone tap"],
      metrics: { isTapped, isRejected }
    };
  }
};
export {
  RiskRewardModule,
  SessionModule,
  TapAndRejectionModule,
  TimeframeModule
};
