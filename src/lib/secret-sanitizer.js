const SECRET_KEY_NAME_REGEX = /^(?:api_?key|secret|token|password|passwd|authorization|connection_token|service_role_key|cron_secret|private_key|client_secret|access_token|refresh_token)$/i;
const SENSITIVE_SUBKEY_REGEX = /secret|password|passwd|api_?key|connection_token|service_role|bot_token|client_secret/i;
function redactSecretsInText(input) {
  if (input === null || input === void 0) return "";
  const text = typeof input === "string" ? input : String(input);
  if (!text) return "";
  return text.replace(/AIza[A-Za-z0-9_-]{20,}/g, "[REDACTED_GEMINI_KEY]").replace(/\bAQ\.[A-Za-z0-9_-]{10,}/g, "[REDACTED_GEMINI_KEY]").replace(/\bAQ[A-Za-z0-9_-]{16,}/g, "[REDACTED_GEMINI_KEY]").replace(/(https?:\/\/api\.telegram\.org\/)bot\d+:[A-Za-z0-9_-]+/gi, "$1bot[REDACTED_TELEGRAM_TOKEN]").replace(/\bbot\d{6,14}:[A-Za-z0-9_-]{20,}\b/g, "bot[REDACTED_TELEGRAM_TOKEN]").replace(/\b\d{7,14}:[A-Za-z0-9_-]{25,}\b/g, "[REDACTED_TELEGRAM_TOKEN]").replace(/\bre_[A-Za-z0-9_]{16,}\b/g, "[REDACTED_API_KEY]").replace(/\bSG\.[A-Za-z0-9_-]{16,}(?:\.[A-Za-z0-9_-]+)?/g, "[REDACTED_API_KEY]").replace(/\bsk-(?:proj-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g, "[REDACTED_API_KEY]").replace(/([?&](?:apikey|api_key|token|secret|access_token|refresh_token|password|passwd|connection_token|bot_token|client_secret)=)[^&\s"'`<>]+/gi, "$1[REDACTED]").replace(/(Authorization\s*[:=]\s*(?:Bearer|apikey|Basic|Token)\s+)[^\s"',;}\]]+/gi, "$1[REDACTED]").replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED]").replace(/\b(apikey\s+)[A-Za-z0-9._~+/=-]{12,}/gi, "$1[REDACTED]").replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, "[REDACTED_JWT]");
}
function sanitizeUrl(url) {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    const sensitiveParams = /* @__PURE__ */ new Set([
      "apikey",
      "api_key",
      "token",
      "secret",
      "access_token",
      "refresh_token",
      "password",
      "passwd",
      "connection_token",
      "bot_token",
      "client_secret"
    ]);
    for (const key of Array.from(parsed.searchParams.keys())) {
      if (sensitiveParams.has(key.toLowerCase())) {
        parsed.searchParams.set(key, "REDACTED");
      }
    }
    return redactSecretsInText(parsed.toString());
  } catch {
    return redactSecretsInText(url);
  }
}
function sanitizeErrorMessage(err, fallback = "Internal server error") {
  if (!err) return fallback;
  let raw = "";
  if (typeof err === "string") {
    raw = err;
  } else if (err instanceof Error) {
    raw = err.message || fallback;
  } else if (typeof err === "object") {
    const anyErr = err;
    raw = anyErr.message || anyErr.error_description || anyErr.error || fallback;
  } else {
    raw = String(err);
  }
  const cleaned = redactSecretsInText(raw).trim();
  return cleaned || fallback;
}
function maskTokenPrefix(token, visibleChars = 4) {
  if (!token) return "[NONE]";
  const trimmed = String(token).trim();
  if (trimmed.length <= visibleChars + 2) return "[REDACTED]";
  return `${trimmed.slice(0, visibleChars)}...`;
}
function sanitizeObjectForLog(value, depth = 0) {
  if (value === null || value === void 0) return value;
  if (typeof value === "string") return redactSecretsInText(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: sanitizeErrorMessage(value)
    };
  }
  if (depth >= 5) {
    return "[TRUNCATED]";
  }
  if (Array.isArray(value)) {
    return value.map((item) => sanitizeObjectForLog(item, depth + 1));
  }
  if (typeof value === "object") {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY_NAME_REGEX.test(k) || SENSITIVE_SUBKEY_REGEX.test(k)) {
        out[k] = v ? "[REDACTED]" : null;
      } else {
        out[k] = sanitizeObjectForLog(v, depth + 1);
      }
    }
    return out;
  }
  return redactSecretsInText(String(value));
}
export {
  maskTokenPrefix,
  redactSecretsInText,
  sanitizeErrorMessage,
  sanitizeObjectForLog,
  sanitizeUrl
};
