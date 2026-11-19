import {
  ALL_CONCEPT_MODULES,
  buildStrategyBlueprint,
  executeStrategyBlueprint,
  resolveConceptModuleId
} from "./strategy-modules/index.js";
function emptyMarketStructure() {
  return {
    trend: "SIDEWAYS",
    swingHighs: [],
    swingLows: [],
    supportZones: [],
    resistanceZones: [],
    fairValueGaps: [],
    orderBlocks: [],
    BOS: [],
    CHOCH: [],
    liquiditySweeps: [],
    candlePatterns: [],
    volumeInformation: { averageVolume: 0, latestVolume: 0, volumeSpike: false },
    volatilityInformation: { atr: 0, volatilityLevel: "NORMAL" },
    latestCandles: [],
    activatedModules: []
  };
}
function extractMarketStructure(candles, blueprintOrDetectors) {
  if (!candles || candles.length < 5) {
    return emptyMarketStructure();
  }
  let blueprint;
  let overrideModuleIds;
  if (!blueprintOrDetectors) {
    const allIds = ALL_CONCEPT_MODULES.map((m) => m.id);
    blueprint = {
      version: "1.0",
      activatedModuleIds: allIds,
      mandatoryModuleIds: [],
      optionalModuleIds: allIds,
      modules: [],
      preferredHtf: "H4",
      strategyMode: "RULE_ONLY",
      executionMode: "RULE_ONLY"
    };
    overrideModuleIds = [
      "bos",
      "choch",
      "fair_value_gap",
      "order_block",
      "liquidity_sweep",
      "support",
      "resistance",
      "trendline_breakout",
      "break_and_retest",
      "confirmation_candle",
      "atr",
      "volume_confirmation"
    ];
  } else if (Array.isArray(blueprintOrDetectors)) {
    const resolved = blueprintOrDetectors.map((id) => resolveConceptModuleId(id)).filter((id) => id !== null);
    const deduped = [...new Set(resolved)];
    blueprint = {
      version: "1.0",
      activatedModuleIds: deduped,
      mandatoryModuleIds: [],
      optionalModuleIds: deduped,
      modules: [],
      preferredHtf: "H4",
      strategyMode: "RULE_ONLY",
      executionMode: "RULE_ONLY"
    };
    overrideModuleIds = deduped;
  } else if ("compiled_rules" in blueprintOrDetectors) {
    blueprint = blueprintOrDetectors.blueprint || buildStrategyBlueprint(blueprintOrDetectors);
    overrideModuleIds = blueprint.activatedModuleIds;
  } else {
    blueprint = blueprintOrDetectors;
    overrideModuleIds = blueprint.activatedModuleIds;
  }
  const report = executeStrategyBlueprint(blueprint, candles, { overrideModuleIds });
  return report.marketStructure;
}
export {
  extractMarketStructure
};
