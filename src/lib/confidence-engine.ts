export type ConfidenceType = 'strategy_compilation' | 'rule_score' | 'gemini' | 'final_trade';

export interface ConfidenceRecord {
  raw: any;
  normalized: number;
  formatted: string;
  source: string;
  type: ConfidenceType;
}

export function normalizeConfidence(
  val: number | string | null | undefined,
  type: ConfidenceType,
  sourceLabel: string = 'Engine'
): ConfidenceRecord {
  if (val === null || val === undefined) {
    const record: ConfidenceRecord = { raw: val, normalized: 0, formatted: '0%', source: sourceLabel, type };
    logConfidence(record);
    return record;
  }

  const num = typeof val === 'number' ? val : parseFloat(String(val));
  if (isNaN(num)) {
    const record: ConfidenceRecord = { raw: val, normalized: 0, formatted: '0%', source: sourceLabel, type };
    logConfidence(record);
    return record;
  }

  let normalized = 0;
  if (num > 0 && num <= 1.0) {
    normalized = Math.round(num * 100);
  } else {
    normalized = Math.round(num);
  }

  // Cap between 0 and 100
  normalized = Math.max(0, Math.min(100, normalized));

  const record: ConfidenceRecord = {
    raw: val,
    normalized,
    formatted: `${normalized}%`,
    source: sourceLabel,
    type
  };

  logConfidence(record);
  return record;
}

function logConfidence(rec: ConfidenceRecord) {
  console.log(`[Confidence]
Raw: ${rec.raw}
Normalized: ${rec.normalized}%
Source: ${rec.source}
Type: ${rec.type}`.trim());
}
