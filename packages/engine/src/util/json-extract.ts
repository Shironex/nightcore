/**
 * Generic JSON-extraction utilities for parsing a model's free-text answer —
 * tolerant of prose framing and ```json fences, strict about the expected shape.
 * Neutral home (no scans/session imports) so BOTH the scan pipelines and the
 * session pipeline (decompose) can share them without a `session/ → scans/`
 * folder dependency.
 */

/**
 * Pull the first JSON array (or object) out of a model result that may be wrapped
 * in prose or ```json fences. Returns the parsed value, or `undefined` if no
 * valid JSON array/object can be located. Tolerant by design — the model is
 * instructed to return bare JSON but sometimes adds a sentence or a fence.
 */
export function extractJson(raw: string): unknown {
  const trimmed = raw.trim();
  // 1) Whole string is JSON.
  const whole = tryParse(trimmed);
  if (whole !== undefined) return whole;
  // 2) Fenced ```json … ``` block.
  const fence = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  if (fence?.[1] !== undefined) {
    const fenced = tryParse(fence[1].trim());
    if (fenced !== undefined) return fenced;
  }
  // 3) First balanced [...] or {...} span.
  for (const [open, close] of [
    ['[', ']'],
    ['{', '}'],
  ] as const) {
    const start = trimmed.indexOf(open);
    const end = trimmed.lastIndexOf(close);
    if (start !== -1 && end > start) {
      const span = tryParse(trimmed.slice(start, end + 1));
      if (span !== undefined) return span;
    }
  }
  return undefined;
}

function tryParse(s: string): unknown {
  try {
    return JSON.parse(s) as unknown;
  } catch {
    return undefined;
  }
}

/** The model's raw output is a bare array, or an object wrapping the array under a
 *  known key (`findings` / `artifacts` / `subtasks`). Normalize to an array. Shared
 *  by every scan + session pipeline; the wrapper key is passed by the caller so the
 *  single helper serves all of them. */
export function toRawArray(parsed: unknown, key: string): unknown[] {
  if (Array.isArray(parsed)) return parsed;
  if (parsed !== null && typeof parsed === 'object') {
    const nested = (parsed as Record<string, unknown>)[key];
    if (Array.isArray(nested)) return nested;
  }
  return [];
}

/** Whether extracted JSON has the expected top-level shape for a findings-style
 *  parse: a bare array, or an object exposing an array under the wrapper `key`.
 *  Anything else — typically an *incidental* JSON example embedded in a prose
 *  answer, which `extractJson`'s balanced-span scan happily parses — is
 *  off-contract and must set a parse `error` rather than silently normalize to an
 *  empty list, so the orchestrator's corrective retry + WARN path fires instead of
 *  the pass reading as a legitimately clean result. Shared by every array-shaped
 *  scan parser (Insight / Harness / PR-review). */
export function isRawArrayShape(parsed: unknown, key: string): boolean {
  if (Array.isArray(parsed)) return true;
  if (parsed !== null && typeof parsed === 'object') {
    return Array.isArray((parsed as Record<string, unknown>)[key]);
  }
  return false;
}

/** The outcome of a {@link parseItems} template run: the coerced survivors, plus an
 *  `error` when the answer was off-contract (no JSON at all, or JSON of the wrong
 *  shape) — the signal that drives the caller's single corrective retry. */
export interface ParseItemsResult<T> {
  items: T[];
  error?: string;
}

/**
 * The shared parse template for an array-shaped model answer, used by every scan
 * findings parser (Insight / Harness / PR-review / Harness artifacts). Tolerant:
 * malformed ITEMS are skipped (`coerce` returns `undefined`), not fatal. Strict
 * about the envelope:
 *
 * - no JSON at all → `{ items: [], error: noJsonError }`
 * - JSON that is neither an array nor an object exposing a `key` array (an
 *   incidental JSON example in a prose answer) → `{ items: [], error }`
 * - otherwise → each raw item coerced, invalid ones skipped, no error.
 */
export function parseItems<T>(
  raw: string,
  key: string,
  coerce: (item: unknown) => T | undefined,
  noJsonError: string,
): ParseItemsResult<T> {
  const parsed = extractJson(raw);
  if (parsed === undefined) {
    return { items: [], error: noJsonError };
  }
  if (!isRawArrayShape(parsed, key)) {
    return {
      items: [],
      error: `model output JSON is not a ${key} array (nor an object with a "${key}" array)`,
    };
  }
  const items: T[] = [];
  for (const item of toRawArray(parsed, key)) {
    const coerced = coerce(item);
    if (coerced !== undefined) items.push(coerced);
  }
  return { items };
}
