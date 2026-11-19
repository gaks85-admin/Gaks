import { normalizeRuleId } from "../strategy-compiler/normalizer.js";
import { RULE_WEIGHTS } from "../rule-weight-engine.js";
import {
  computeAtr,
  detectFractalSwings,
  sortCandlesChronological
} from "./primitives.js";
import {
  DemandZoneModule,
  OrderBlockModule,
  SupplyDemandModule,
  SupplyZoneModule,
  UnmitigatedZoneModule
} from "./order-block.js";
import { LiquiditySweepModule } from "./liquidity-sweep.js";
import { FairValueGapModule } from "./fair-value-gap.js";
import { BosModule, ChochModule } from "./market-structure.js";
import {
  ResistanceModule,
  ResistanceRejectionModule,
  SupportModule,
  SupportRejectionModule
} from "./support-resistance.js";
import { BreakAndRetestModule, TrendlineBreakoutModule } from "./trendline.js";
import { ConfirmationCandleModule } from "./confirmation-candle.js";
import { AtrModule, EmaModule, MacdModule, RsiModule, VolumeModule } from "./indicators.js";
import { RiskRewardModule, SessionModule, TapAndRejectionModule, TimeframeModule } from "./filters.js";
const ALL_CONCEPT_MODULES = [
  // Structural breaks & trendlines (ordered before zone modules so OB checks can inspect BOS/FVG confluence)
  BosModule,
  ChochModule,
  FairValueGapModule,
  OrderBlockModule,
  SupplyDemandModule,
  UnmitigatedZoneModule,
  DemandZoneModule,
  SupplyZoneModule,
  LiquiditySweepModule,
  SupportModule,
  ResistanceModule,
  SupportRejectionModule,
  ResistanceRejectionModule,
  TrendlineBreakoutModule,
  BreakAndRetestModule,
  ConfirmationCandleModule,
  EmaModule,
  RsiModule,
  MacdModule,
  AtrModule,
  VolumeModule,
  SessionModule,
  TimeframeModule,
  RiskRewardModule,
  TapAndRejectionModule
];
const CONCEPT_MODULE_REGISTRY = new Map(
  ALL_CONCEPT_MODULES.map((m) => [m.id, m])
);
const ALIAS_TO_MODULE_ID = /* @__PURE__ */ new Map();
for (const mod of ALL_CONCEPT_MODULES) {
  ALIAS_TO_MODULE_ID.set(mod.id, mod.id);
  for (const alias of mod.aliases) {
    ALIAS_TO_MODULE_ID.set(alias.toLowerCase(), mod.id);
  }
}
function resolveConceptModuleId(rawId) {
  if (!rawId) return null;
  const normalized = normalizeRuleId(rawId);
  return ALIAS_TO_MODULE_ID.get(normalized) || ALIAS_TO_MODULE_ID.get(rawId.toLowerCase().trim()) || null;
}
function isCompiledRuleActive(ruleId, rules) {
  if (!rules) return false;
  switch (ruleId) {
    case "ema":
      return Boolean(rules.ema?.enabled);
    case "rsi":
      return Boolean(rules.rsi?.enabled);
    case "macd":
      return Boolean(rules.macd?.enabled);
    case "atr":
      return Boolean(rules.atr?.enabled);
    case "session":
      return Array.isArray(rules.session) && rules.session.length > 0;
    case "timeframes":
      return Array.isArray(rules.timeframes) && rules.timeframes.length > 0;
    case "risk_reward":
      return Boolean(rules.risk_reward && rules.risk_reward.min_ratio !== void 0);
    default:
      return Boolean(rules[ruleId] === true);
  }
}
function extractModuleParams(ruleId, rules) {
  switch (ruleId) {
    case "ema":
      return { periods: rules.ema?.periods || [20, 50], type: rules.ema?.type || "EMA" };
    case "rsi":
      return { overbought: rules.rsi?.overbought ?? 70, oversold: rules.rsi?.oversold ?? 30 };
    case "risk_reward":
      return { min_ratio: rules.risk_reward?.min_ratio ?? 2 };
    case "session":
      return { sessions: rules.session || [] };
    case "timeframes":
      return { timeframes: rules.timeframes || [] };
    case "order_block":
    case "supply_demand":
    case "unmitigated_zone":
      return { enforceUnmitigated: rules.unmitigated_zone !== false };
    default:
      return {};
  }
}
function buildStrategyBlueprint(compiled) {
  const rules = compiled.compiled_rules || {};
  const mandatorySet = new Set(
    (compiled.canonical_rule_set?.mandatory_rule_ids || compiled.mandatory_rules || []).map((id) => resolveConceptModuleId(id)).filter((id) => id !== null)
  );
  const moduleSpecs = [];
  const seen = /* @__PURE__ */ new Set();
  for (const mod of ALL_CONCEPT_MODULES) {
    if (!isCompiledRuleActive(mod.id, rules)) continue;
    if (seen.has(mod.id)) continue;
    seen.add(mod.id);
    const isMandatory = mandatorySet.has(mod.id);
    const weightKey = mod.id === "timeframes" ? "timeframe" : mod.id;
    const weight = RULE_WEIGHTS[weightKey] ?? 10;
    moduleSpecs.push({
      id: mod.id,
      name: mod.name,
      category: mod.category,
      mandatory: isMandatory,
      weight,
      params: extractModuleParams(mod.id, rules)
    });
  }
  if (moduleSpecs.length === 0 && Array.isArray(compiled.canonical_rules)) {
    for (const rawId of compiled.canonical_rules) {
      const modId = resolveConceptModuleId(rawId);
      if (!modId || seen.has(modId)) continue;
      const mod = CONCEPT_MODULE_REGISTRY.get(modId);
      if (!mod) continue;
      seen.add(modId);
      const weightKey = modId === "timeframes" ? "timeframe" : modId;
      moduleSpecs.push({
        id: modId,
        name: mod.name,
        category: mod.category,
        mandatory: mandatorySet.has(modId),
        weight: RULE_WEIGHTS[weightKey] ?? 10,
        params: extractModuleParams(modId, rules)
      });
    }
  }
  const activatedModuleIds = moduleSpecs.map((m) => m.id);
  const mandatoryModuleIds = moduleSpecs.filter((m) => m.mandatory).map((m) => m.id);
  const optionalModuleIds = moduleSpecs.filter((m) => !m.mandatory).map((m) => m.id);
  return {
    version: "1.0",
    activatedModuleIds,
    mandatoryModuleIds,
    optionalModuleIds,
    modules: moduleSpecs,
    preferredHtf: rules.preferred_htf || "H4",
    strategyMode: compiled.strategy_mode || "RULE_ONLY",
    executionMode: compiled.canonical_rule_set?.execution_mode || compiled.strategy_mode || "RULE_ONLY"
  };
}
function executeStrategyBlueprint(compiledOrBlueprint, candles, options = {}) {
  const isCompilerOutput = "compiled_rules" in compiledOrBlueprint;
  const blueprint = isCompilerOutput ? compiledOrBlueprint.blueprint || buildStrategyBlueprint(compiledOrBlueprint) : compiledOrBlueprint;
  const compiledRules = isCompilerOutput ? compiledOrBlueprint.compiled_rules || {} : {};
  const compiledStrategy = isCompilerOutput ? compiledOrBlueprint : void 0;
  const targetIds = options.overrideModuleIds ? [...new Set(options.overrideModuleIds)] : blueprint.activatedModuleIds;
  const sortedCandles = sortCandlesChronological(candles);
  const latestCandle = sortedCandles[sortedCandles.length - 1] || {
    timestamp: (/* @__PURE__ */ new Date()).toISOString(),
    open: 0,
    high: 0,
    low: 0,
    close: 0,
    volume: 0
  };
  const currentPrice = Number(latestCandle.close || 0);
  const activeModuleObjects = targetIds.map((id) => CONCEPT_MODULE_REGISTRY.get(id)).filter((m) => Boolean(m));
  const needsAtr = activeModuleObjects.some((m) => m.requiresAtr !== false);
  const needsSwings = activeModuleObjects.some((m) => m.requiresSwings === true);
  const atr = sortedCandles.length >= 2 && needsAtr ? computeAtr(sortedCandles, 14) : 0;
  let swingHighs = [];
  let swingLows = [];
  if (sortedCandles.length >= 5 && needsSwings) {
    const swings = detectFractalSwings(sortedCandles, 2);
    swingHighs = swings.swingHighs;
    swingLows = swings.swingLows;
  }
  const volumes = sortedCandles.map((c) => Number(c.volume || 0));
  const avgVol = volumes.length > 0 ? volumes.reduce((a, b) => a + b, 0) / volumes.length : 0;
  const latestVol = volumes.length > 0 ? volumes[volumes.length - 1] : 0;
  const marketStructure = {
    pair: options.pair || options.existingMarketStructure?.pair,
    timeframe: options.timeframe || options.existingMarketStructure?.timeframe,
    trend: options.existingMarketStructure?.trend || "SIDEWAYS",
    swingHighs,
    swingLows,
    supportZones: [],
    resistanceZones: [],
    fairValueGaps: [],
    orderBlocks: [],
    BOS: [],
    CHOCH: [],
    liquiditySweeps: [],
    candlePatterns: [],
    volumeInformation: {
      averageVolume: avgVol,
      latestVolume: latestVol,
      volumeSpike: avgVol > 0 && latestVol > avgVol * 1.5
    },
    volatilityInformation: {
      atr,
      volatilityLevel: currentPrice > 0 && atr > currentPrice * 0.02 ? "HIGH" : "NORMAL"
    },
    latestCandles: sortedCandles.slice(-20),
    ...options.existingMarketStructure || {}
  };
  if (!options.existingMarketStructure?.swingHighs?.length) marketStructure.swingHighs = swingHighs;
  if (!options.existingMarketStructure?.swingLows?.length) marketStructure.swingLows = swingLows;
  const resultsByModule = {};
  const executedModules = [];
  const passedModules = [];
  const failedModules = [];
  for (const mod of activeModuleObjects) {
    const spec = blueprint.modules.find((m) => m.id === mod.id) || {
      id: mod.id,
      name: mod.name,
      category: mod.category,
      mandatory: blueprint.mandatoryModuleIds.includes(mod.id),
      weight: RULE_WEIGHTS[mod.id] ?? 10,
      params: extractModuleParams(mod.id, compiledRules)
    };
    const ctx = {
      sortedCandles,
      latestCandle,
      currentPrice,
      atr,
      swingHighs: marketStructure.swingHighs,
      swingLows: marketStructure.swingLows,
      pair: options.pair || marketStructure.pair,
      timeframe: options.timeframe || marketStructure.timeframe,
      compiledRules,
      compiledStrategy,
      moduleSpec: spec,
      marketStructure,
      now: options.now
    };
    const result = mod.execute(ctx);
    resultsByModule[mod.id] = result;
    executedModules.push(mod.id);
    if (result.matched) passedModules.push(mod.id);
    else failedModules.push(mod.id);
    if (result.structurePatch) {
      Object.assign(marketStructure, result.structurePatch);
    }
  }
  if (marketStructure.trend === "SIDEWAYS" && !executedModules.includes("bos") && !executedModules.includes("choch")) {
    const emaResult = resultsByModule["ema"];
    if (emaResult?.direction === "BULLISH" || emaResult?.direction === "BEARISH") {
      marketStructure.trend = emaResult.direction;
    } else if (sortedCandles.length >= 2) {
      const firstClose = sortedCandles[Math.max(0, sortedCandles.length - 10)].close;
      if (currentPrice > firstClose * 1.0005) marketStructure.trend = "BULLISH";
      else if (currentPrice < firstClose * 0.9995) marketStructure.trend = "BEARISH";
    }
  }
  delete marketStructure._detectedOrderBlocks;
  delete marketStructure._structureBreakAnalysis;
  delete marketStructure._bosComputed;
  delete marketStructure._chochComputed;
  delete marketStructure._srAnalysis;
  delete marketStructure._trendlineAnalysis;
  marketStructure.activatedModules = executedModules;
  marketStructure.moduleResults = resultsByModule;
  const skippedModules = ALL_CONCEPT_MODULES.map((m) => m.id).filter((id) => !executedModules.includes(id));
  let totalWeight = 0;
  let earnedWeight = 0;
  let mandatoryPassed = true;
  for (const modId of executedModules) {
    const res = resultsByModule[modId];
    const spec = blueprint.modules.find((m) => m.id === modId);
    const weight = spec?.weight ?? 10;
    totalWeight += weight;
    earnedWeight += res.scoreOutOf10 / 10 * weight;
    if (spec?.mandatory && !res.matched) {
      mandatoryPassed = false;
    }
  }
  const score = totalWeight > 0 ? Math.round(earnedWeight / totalWeight * 100) : 0;
  const passed = mandatoryPassed && executedModules.length > 0 && score >= 50;
  return {
    blueprint,
    activatedModules: targetIds,
    executedModules,
    skippedModules,
    passedModules,
    failedModules,
    resultsByModule,
    marketStructure,
    score,
    mandatoryPassed,
    passed
  };
}
export {
  ALL_CONCEPT_MODULES,
  CONCEPT_MODULE_REGISTRY,
  buildStrategyBlueprint,
  executeStrategyBlueprint,
  isCompiledRuleActive,
  resolveConceptModuleId
};
