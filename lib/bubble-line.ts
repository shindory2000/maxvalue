const LINE_USER_ID_PATTERN = /^U[0-9a-fA-F]{20,80}$/;

const LINE_KEY_HINTS = [
  "line_user_id",
  "lineuserid",
  "line user id",
  "line id",
  "lineid",
  "line_uid",
  "line uid",
  "provider_id",
  "providerid",
  "line",
];

function normalizeKey(key: string) {
  return key.replace(/[_\-\s]/g, "").toLowerCase();
}

export function looksLikeLineUserId(value: unknown) {
  return typeof value === "string" && LINE_USER_ID_PATTERN.test(value.trim());
}

function keyLooksRelevant(key: string) {
  const normalized = normalizeKey(key);
  return LINE_KEY_HINTS.some(hint => normalized.includes(normalizeKey(hint)));
}

export function extractBubbleLineUserId(raw: unknown): string | null {
  const seen = new WeakSet<object>();
  const fallback: string[] = [];

  function walk(value: unknown, keyHint = "", depth = 0): string | null {
    if (depth > 7 || value == null) return null;

    if (typeof value === "string") {
      const trimmed = value.trim();
      if (looksLikeLineUserId(trimmed)) {
        if (keyHint && keyLooksRelevant(keyHint)) return trimmed;
        fallback.push(trimmed);
      }
      return null;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        const found = walk(item, keyHint, depth + 1);
        if (found) return found;
      }
      return null;
    }

    if (typeof value === "object") {
      if (seen.has(value)) return null;
      seen.add(value);
      const entries = Object.entries(value as Record<string, unknown>);

      for (const [key, entryValue] of entries) {
        if (keyLooksRelevant(key)) {
          const found = walk(entryValue, key, depth + 1);
          if (found) return found;
        }
      }
      for (const [key, entryValue] of entries) {
        const found = walk(entryValue, key, depth + 1);
        if (found) return found;
      }
    }

    return null;
  }

  return walk(raw) || fallback[0] || null;
}
