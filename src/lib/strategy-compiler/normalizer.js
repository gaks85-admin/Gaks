import { isNegativeOrExclusionContext, matchPhraseWithBoundaries, escapeRegExp } from './utils.js';
export function normalizeText(text) {
    if (!text)
        return "";
    let normalized = text.toLowerCase();
    normalized = normalized.replace(/\bs\/r\b|\bs&r\b|\bsubport\b/g, 'support resistance');
    normalized = normalized.replace(/\bt\/l\b/g, 'trendline');
    normalized = normalized.replace(/\br\/r\b|\br:r\b/g, 'risk reward');
    normalized = normalized.replace(/\brisk\s*(?:to|&|and|-)\s*reward\b/g, 'risk reward');
    normalized = normalized.replace(/\b(?:\d+\s*:\s*\d+\s*)?(?:rr|r:r|r\/r)\b/g, 'risk reward');
    normalized = normalized.replace(/\bsupply\s*(?:&|\/|and)\s*demand\b/g, 'supply and demand');
    normalized = normalized.replace(/\bs&d\b/g, 'supply and demand');
    normalized = normalized.replace(/\border\s*blocks?\b/g, 'order block');
    normalized = normalized.replace(/\bfvg\b/g, 'fair value gap');
    normalized = normalized.replace(/\bbos\b/g, 'break of structure');
    normalized = normalized.replace(/\bchoch\b/g, 'change of character');
    normalized = normalized.replace(/\bma\b/g, 'moving average');
    normalized = normalized.replace(/\bema\b/g, 'exponential moving average');
    normalized = normalized.replace(/\bmacd\b/g, 'moving average convergence divergence');
    normalized = normalized.replace(/\brsi\b/g, 'relative strength index');
    normalized = normalized.replace(/\batr\b/g, 'average true range');
    normalized = normalized.replace(/[^a-z0-9\s]/g, ' ');
    normalized = normalized.replace(/\btrend\s+line\b/g, 'trendline');
    normalized = normalized.replace(/\btrendlines\b/g, 'trendline');
    normalized = normalized.replace(/\bcandles\b/g, 'candle');
    normalized = normalized.replace(/\bsessions\b/g, 'session');
    normalized = normalized.replace(/\bvolumes\b/g, 'volume');
    normalized = normalized.replace(/\bimbalances\b/g, 'imbalance');
    normalized = normalized.replace(/\bbreakouts\b/g, 'breakout');
    normalized = normalized.replace(/\blevels\b/g, 'level');
    normalized = normalized.replace(/\brejections\b/g, 'rejection');
    normalized = normalized.replace(/\bsweeps\b/g, 'sweep');
    normalized = normalized.replace(/\bgaps\b/g, 'gap');
    normalized = normalized.replace(/\s+/g, ' ').trim();
    return normalized;
}
export function findSynonymMatch(originalText, synonyms, canonicalRule, defaultConfidence = 0.95) {
    for (const synonym of synonyms) {
        if (matchPhraseWithBoundaries(originalText, synonym)) {
            if (isNegativeOrExclusionContext(originalText, synonym)) {
                continue;
            }
            return {
                matched: true,
                matchedPhrase: synonym,
                canonicalRule,
                confidence: defaultConfidence
            };
        }
    }
    return {
        matched: false,
        matchedPhrase: "",
        canonicalRule,
        confidence: 0.0
    };
}
export function extractDedicatedMandatorySection(text) {
    if (!text)
        return null;
    const lines = text.split('\n');
    let inMandatorySection = false;
    const dedicatedHeaderLines = [];
    const labeledItemLines = [];
    for (let i = 0; i < lines.length; i++) {
        const rawLine = lines[i];
        const trimmed = rawLine.trim().toLowerCase();
        const isSectionHeader = /^(?:(?:mandatory|madoratory)\s+rules?|core\s+mandatory\s+rules?)\s*[:;=-]*$/i.test(trimmed) ||
            /^(?:core\s+entry\s+rules|entry\s+rules)\s*\((?:mandatory|madoratory)\)\s*[:;=-]*$/i.test(trimmed);
        if (isSectionHeader) {
            inMandatorySection = true;
            dedicatedHeaderLines.length = 0;
            continue;
        }
        if (inMandatorySection) {
            const isNewSection = /^[a-z][a-z0-9\s]{2,}\s*[:;=-]$/i.test(trimmed) &&
                !/^\d+[\.\)]/.test(trimmed) &&
                !trimmed.startsWith('-') &&
                !trimmed.startsWith('*');
            if (isNewSection) {
                inMandatorySection = false;
                continue;
            }
            if (trimmed.length > 0) {
                dedicatedHeaderLines.push(trimmed);
            }
        }
        else {
            if (/^\d+[\.\)]\s*.*\((?:mandatory|madoratory)\)/i.test(trimmed)) {
                labeledItemLines.push(trimmed);
            }
        }
    }
    if (dedicatedHeaderLines.length > 0) {
        return dedicatedHeaderLines;
    }
    if (labeledItemLines.length > 0) {
        return labeledItemLines;
    }
    return null;
}
export function isMandatory(originalText, matchedPhrase) {
    if (!matchedPhrase || !matchedPhrase.trim())
        return false;
    if (isNegativeOrExclusionContext(originalText, matchedPhrase)) {
        return false;
    }
    const normalizedPhrase = normalizeText(matchedPhrase);
    const mandatoryKeywords = ['must', 'required', 'mandatory', 'madoratory', 'strictly'];
    const optionalKeywords = ['optional', 'confirmation', 'extra', 'additional', 'if possible', 'weighted', 'filter out', 'ignore', 'avoid'];
    const dedicatedSectionLines = extractDedicatedMandatorySection(originalText);
    if (dedicatedSectionLines) {
        return dedicatedSectionLines.some(line => {
            if (isNegativeOrExclusionContext(line, matchedPhrase))
                return false;
            const normalizedLine = normalizeText(line);
            const isSupplyDemandLine = normalizedLine.includes('supply and demand');
            if (isSupplyDemandLine && (matchedPhrase === 'support' || matchedPhrase === 'resistance')) {
                return false;
            }
            if ((normalizedLine.includes('unmitigated') || normalizedLine.includes('order block')) &&
                (matchedPhrase === 'order block' || matchedPhrase === 'unmitigated zone' || matchedPhrase === 'order blocks' || matchedPhrase === 'unmitigated' || matchedPhrase === 'unmitigated order block')) {
                return true;
            }
            if (normalizedPhrase === 'risk reward' && (normalizedLine.includes('risk reward') || normalizedLine.includes('rr'))) {
                return true;
            }
            return matchPhraseWithBoundaries(line, matchedPhrase) || normalizedLine.includes(normalizedPhrase);
        });
    }
    const clauses = originalText.toLowerCase().split(/[\n.;,]|\b(?:whereas|however|although|while|but)\b|\b(?:and)\s+(?=[a-z0-9_\s]+\s+(?:is|are|must be)\s+(?:optional|mandatory|required|must))\b/i);
    for (const clauseRaw of clauses) {
        if (!matchPhraseWithBoundaries(clauseRaw, matchedPhrase) && !normalizeText(clauseRaw).includes(normalizedPhrase)) {
            continue;
        }
        if (isNegativeOrExclusionContext(clauseRaw, matchedPhrase)) {
            continue;
        }
        const targetClause = normalizeText(clauseRaw);
        const isOptionalClause = optionalKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(targetClause));
        const isMandatoryExplicit = mandatoryKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(targetClause));
        if (isOptionalClause)
            continue;
        if (isMandatoryExplicit)
            return true;
    }
    const lines = originalText.split('\n');
    for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const currentLine = lines[lineIdx].trim().toLowerCase();
        if (!matchPhraseWithBoundaries(currentLine, matchedPhrase) && !normalizeText(currentLine).includes(normalizedPhrase)) {
            continue;
        }
        if (isNegativeOrExclusionContext(currentLine, matchedPhrase)) {
            continue;
        }
        const orPattern = new RegExp(`\\b${escapeRegExp(matchedPhrase.toLowerCase())}\\b\\s+or\\b|\\bor\\s+\\b${escapeRegExp(matchedPhrase.toLowerCase())}\\b`, 'i');
        if (orPattern.test(currentLine)) {
            continue;
        }
        const pastContextPattern = new RegExp(`\\b(that created|which created|created a|forming a|after a|prior to)\\b.*\\b${escapeRegExp(matchedPhrase.toLowerCase())}\\b`, 'i');
        if (pastContextPattern.test(currentLine)) {
            continue;
        }
        const colonIdx = currentLine.indexOf(':');
        const itemLabel = colonIdx !== -1 ? currentLine.slice(0, colonIdx) : currentLine;
        const isLabelMatch = matchPhraseWithBoundaries(itemLabel, matchedPhrase) || normalizeText(itemLabel).includes(normalizedPhrase);
        const lineMandatory = mandatoryKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(currentLine));
        const lineOptional = optionalKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(currentLine));
        if (lineOptional)
            continue;
        if (lineMandatory && (isLabelMatch || !colonIdx || colonIdx === -1))
            return true;
        for (let i = lineIdx - 1; i >= 0; i--) {
            const prevLine = lines[i].trim().toLowerCase();
            if (prevLine.endsWith(':') || prevLine.startsWith('#') || prevLine.startsWith('==') || /^\d+\.\s+/.test(prevLine)) {
                const hasMandatoryHeader = mandatoryKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(prevLine));
                const hasOptionalHeader = optionalKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(prevLine));
                if (hasOptionalHeader)
                    break;
                if (hasMandatoryHeader) {
                    if (isLabelMatch) {
                        return true;
                    }
                    if (matchPhraseWithBoundaries(prevLine, matchedPhrase) || normalizeText(prevLine).includes(normalizedPhrase)) {
                        return true;
                    }
                }
                break;
            }
        }
    }
    return false;
}
export function isOptional(originalText, matchedPhrase) {
    if (!matchedPhrase || !matchedPhrase.trim())
        return false;
    if (isNegativeOrExclusionContext(originalText, matchedPhrase))
        return false;
    const normalizedPhrase = normalizeText(matchedPhrase);
    const optionalKeywords = ['optional', 'if possible', 'secondary', 'nice to have', 'extra', 'additional', 'optionally', 'preferred'];
    const lines = originalText.split('\n');
    let inOptionalSection = false;
    for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim().toLowerCase();
        const isOptionalHeader = /^(?:optional\s+rules?|secondary\s+rules?|optional)\s*[:;=-]*$/i.test(trimmed);
        if (isOptionalHeader) {
            inOptionalSection = true;
            continue;
        }
        if (inOptionalSection) {
            const isNewSection = /^[a-z][a-z0-9\s]{2,}\s*[:;=-]$/i.test(trimmed) &&
                !/^\d+[\.\)]/.test(trimmed) &&
                !trimmed.startsWith('-') &&
                !trimmed.startsWith('*');
            if (isNewSection) {
                inOptionalSection = false;
            }
            else if (matchPhraseWithBoundaries(trimmed, matchedPhrase) || normalizeText(trimmed).includes(normalizedPhrase)) {
                return true;
            }
        }
    }
    const clauses = originalText.toLowerCase().split(/[\n.;,]|\b(?:whereas|however|although|while|but)\b/i);
    for (const clauseRaw of clauses) {
        if (!matchPhraseWithBoundaries(clauseRaw, matchedPhrase) && !normalizeText(clauseRaw).includes(normalizedPhrase)) {
            continue;
        }
        if (isNegativeOrExclusionContext(clauseRaw, matchedPhrase))
            continue;
        const targetClause = normalizeText(clauseRaw);
        const hasOptional = optionalKeywords.some(k => new RegExp(`\\b${escapeRegExp(k)}\\b`, 'i').test(targetClause));
        if (hasOptional)
            return true;
    }
    return false;
}
export function normalizeRuleId(rawRuleId) {
    if (!rawRuleId)
        return "";
    const clean = rawRuleId.toLowerCase().trim().replace(/[\s\-_]+/g, '_');
    if (clean === 'trendline' || clean === 'trendline_breakout')
        return 'trendline_breakout';
    if (clean === 'retest' || clean === 'break_and_retest')
        return 'break_and_retest';
    if (clean === 'bos' || clean === 'break_of_structure')
        return 'bos';
    if (clean === 'choch' || clean === 'change_of_character')
        return 'choch';
    if (clean === 'confirmation_candle' || clean === 'confirmation')
        return 'confirmation_candle';
    if (clean === 'liquidity_sweep' || clean === 'liquidity')
        return 'liquidity_sweep';
    if (clean === 'fair_value_gap' || clean === 'fvg')
        return 'fair_value_gap';
    if (clean === 'order_block' || clean === 'orderblock' || clean === 'ob' || clean === 'obs')
        return 'order_block';
    if (clean === 'supply_demand' || clean === 'supply_and_demand' || clean === 's_d')
        return 'supply_demand';
    if (clean === 'unmitigated_zone' || clean === 'unmitigated' || clean === 'unmitigated_order_block')
        return 'unmitigated_zone';
    if (clean === 'demand_zone' || clean === 'demand')
        return 'demand_zone';
    if (clean === 'supply_zone' || clean === 'supply')
        return 'supply_zone';
    if (clean === 'support' || clean === 'support_zone')
        return 'support';
    if (clean === 'resistance' || clean === 'resistance_zone')
        return 'resistance';
    if (clean === 'support_rejection')
        return 'support_rejection';
    if (clean === 'resistance_rejection')
        return 'resistance_rejection';
    if (clean === 'support_resistance' || clean === 's_r')
        return 'support';
    if (clean === 'ema' || clean === 'ema_alignment')
        return 'ema';
    if (clean === 'rsi' || clean === 'rsi_filter')
        return 'rsi';
    if (clean === 'macd' || clean === 'macd_filter')
        return 'macd';
    if (clean === 'atr' || clean === 'atr_volatility_filter')
        return 'atr';
    if (clean === 'volume_confirmation' || clean === 'volume')
        return 'volume_confirmation';
    if (clean === 'session' || clean === 'session_filter')
        return 'session';
    if (clean === 'timeframes' || clean === 'timeframe' || clean === 'timeframe_filter')
        return 'timeframes';
    if (clean === 'risk_reward' || clean === 'r_r')
        return 'risk_reward';
    return clean;
}
