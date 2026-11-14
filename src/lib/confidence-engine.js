function normalizeConfidence(val, type, sourceLabel = "Engine") {
  if (val === null || val === void 0) {
    const record2 = { raw: val, normalized: 0, formatted: "0%", source: sourceLabel, type };
    logConfidence(record2);
    return record2;
  }
  const num = typeof val === "number" ? val : parseFloat(String(val));
  if (isNaN(num)) {
    const record2 = { raw: val, normalized: 0, formatted: "0%", source: sourceLabel, type };
    logConfidence(record2);
    return record2;
  }
  let normalized = 0;
  if (num > 0 && num <= 1) {
    normalized = Math.round(num * 100);
  } else {
    normalized = Math.round(num);
  }
  normalized = Math.max(0, Math.min(100, normalized));
  const record = {
    raw: val,
    normalized,
    formatted: `${normalized}%`,
    source: sourceLabel,
    type
  };
  logConfidence(record);
  return record;
}
function logConfidence(rec) {
  console.log(`[Confidence]
Raw: ${rec.raw}
Normalized: ${rec.normalized}%
Source: ${rec.source}
Type: ${rec.type}`.trim());
}
export {
  normalizeConfidence
};
