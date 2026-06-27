/**
 * Pure helpers for the Readiness Scorecard pipeline — the parse → ground steps that
 * turn a dimension pass's free-text result into a single validated, grounded
 * {@link ScorecardReading}. Kept pure (only `fs`/`crypto`, no SDK, no emitter) so
 * every step is unit-testable in isolation. Mirrors `analysis-findings.ts`, reusing
 * {@link extractJson} + {@link fingerprintOf} VERBATIM (imported, not re-declared)
 * so the JSON extraction and fingerprint key can never diverge from Insight's.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  ScorecardReadingSchema,
  type ScorecardDimension,
  type ScorecardEvidence,
  type ScorecardGrade,
  type ScorecardReading,
} from '@nightcore/contracts';
import { extractJson, fingerprintOf } from '../shared/findings.js';
import { getNumber, getString, getStringArray } from '../../util/field-extract.js';

/** The valid grade letters, for coercion. */
const GRADES: readonly ScorecardGrade[] = ['A', 'B', 'C', 'D', 'E', 'F'];

/** Normalize a repo-relative path (strip leading `./`, backslashes → `/`). */
function normalizeFile(file: string | undefined): string {
  if (file === undefined) return '';
  return file.replace(/\\/g, '/').replace(/^\.\//, '').trim();
}

/** Coerce a raw grade value to a valid letter, defaulting to `C` (the neutral
 *  "adequate but gaps" midpoint) when the model returns something off-scale — a
 *  reading must always carry a letter, so an unknown value degrades, never drops. */
function coerceGrade(raw: unknown): ScorecardGrade {
  const v = String(raw).trim().toUpperCase();
  return (GRADES as readonly string[]).includes(v) ? (v as ScorecardGrade) : 'C';
}

/** Coerce a raw `location` (nested object or "file:line" string) to the contract
 *  shape, mirroring `analysis-findings.ts`'s `coerceLocation`. */
function coerceLocation(raw: unknown): ScorecardReading['location'] {
  if (typeof raw === 'string') {
    const m = /^(.+?):(\d+)(?:-(\d+))?$/.exec(raw.trim());
    if (m) {
      return {
        file: normalizeFile(m[1]),
        startLine: Number(m[2]),
        ...(m[3] !== undefined ? { endLine: Number(m[3]) } : {}),
      };
    }
    return raw.trim().length > 0 ? { file: normalizeFile(raw) } : undefined;
  }
  if (raw !== null && typeof raw === 'object') {
    const o = raw as Record<string, unknown>;
    const rawFile = getString(o, 'file');
    if (rawFile === undefined) return undefined;
    const startLine = getNumber(o, 'startLine') ?? getNumber(o, 'line');
    const endLine = getNumber(o, 'endLine');
    const symbol = getString(o, 'symbol');
    return {
      file: normalizeFile(rawFile),
      ...(startLine !== undefined ? { startLine } : {}),
      ...(endLine !== undefined ? { endLine } : {}),
      ...(symbol !== undefined ? { symbol } : {}),
    };
  }
  return undefined;
}

/** Coerce one raw evidence item into a contract {@link ScorecardEvidence}. Returns
 *  `undefined` when it has no `detail`. */
function coerceEvidence(raw: unknown): ScorecardEvidence | undefined {
  if (raw === null || typeof raw !== 'object') return undefined;
  const r = raw as Record<string, unknown>;
  const detail = getString(r, 'detail') ?? getString(r, 'description');
  if (detail === undefined) return undefined;
  const location = coerceLocation(r.location ?? r.file);
  return { detail, ...(location !== undefined ? { location } : {}) };
}

/** Pull the evidence array out of a raw reading object (`findings` or `evidence`). */
function evidenceArray(r: Record<string, unknown>): unknown[] {
  const f = r.findings ?? r.evidence;
  return Array.isArray(f) ? f : [];
}

/**
 * Parse a dimension pass's raw result text into ONE validated {@link ScorecardReading},
 * forcing `dimension` (the pass owns it, not the model) and assigning a stable id +
 * fingerprint. Tolerant: a malformed evidence item is skipped, not fatal. Returns
 * `{ reading }` on success or `{ error }` when no JSON object could be extracted at
 * all (so the orchestrator can mark the dimension errored vs legitimately ungraded).
 */
export function parseReading(
  raw: string,
  dimension: ScorecardDimension,
): { reading?: ScorecardReading; error?: string } {
  const parsed = extractJson(raw);
  if (parsed === undefined) {
    return { error: 'no JSON reading object in model output' };
  }
  // The model is asked for a single object; tolerate a one-element array wrapper.
  const obj = Array.isArray(parsed) ? parsed[0] : parsed;
  if (obj === null || typeof obj !== 'object') {
    return { error: 'model output was not a reading object' };
  }
  const r = obj as Record<string, unknown>;

  const title = getString(r, 'title');
  const summary = getString(r, 'summary') ?? getString(r, 'description');
  if (title === undefined || summary === undefined) {
    return { error: 'reading missing title/summary' };
  }

  const fingerprint = fingerprintOf(dimension, title);
  const location = coerceLocation(r.location ?? r.file);
  const findings: ScorecardEvidence[] = [];
  for (const item of evidenceArray(r)) {
    const ev = coerceEvidence(item);
    if (ev !== undefined) findings.push(ev);
  }

  const rationale = getString(r, 'rationale');
  const suggestion = getString(r, 'suggestion');
  const confidence = getNumber(r, 'confidence');

  const candidate: Record<string, unknown> = {
    id: `${dimension}-${fingerprint}`,
    dimension,
    grade: coerceGrade(r.grade),
    title,
    summary,
    ...(rationale !== undefined ? { rationale } : {}),
    ...(location !== undefined ? { location } : {}),
    ...(suggestion !== undefined ? { suggestion } : {}),
    affectedFiles: getStringArray(r, 'affectedFiles').map(normalizeFile),
    tags: getStringArray(r, 'tags'),
    findings,
    ...(confidence !== undefined ? { confidence } : {}),
    fingerprint,
  };

  const result = ScorecardReadingSchema.safeParse(candidate);
  return result.success ? { reading: result.data } : { error: 'reading failed schema validation' };
}

/** Count lines in a file, cheaply. Returns 0 when unreadable. */
function lineCount(absPath: string): number {
  try {
    const content = fs.readFileSync(absPath, 'utf8');
    if (content.length === 0) return 0;
    let n = 1;
    for (let i = 0; i < content.length; i++) {
      if (content.charCodeAt(i) === 10) n++;
    }
    return n;
  } catch {
    return 0;
  }
}

/** Whether a repo-relative path exists as a file under the project root (no `../`
 *  escape). Mirrors `analysis-findings.ts`. */
function fileExists(projectPath: string, rel: string): boolean {
  if (rel.length === 0) return false;
  const abs = path.resolve(projectPath, rel);
  const root = path.resolve(projectPath);
  if (abs !== root && !abs.startsWith(root + path.sep)) return false;
  try {
    return fs.statSync(abs).isFile();
  } catch {
    return false;
  }
}

function clampLocation(
  projectPath: string,
  loc: NonNullable<ScorecardReading['location']>,
): NonNullable<ScorecardReading['location']> | undefined {
  if (!fileExists(projectPath, loc.file)) return undefined;
  const max = Math.max(lineCount(path.resolve(projectPath, loc.file)), 1);
  const clamp = (n: number | undefined): number | undefined =>
    n === undefined ? undefined : Math.min(Math.max(1, n), max);
  const startLine = clamp(loc.startLine);
  let endLine = clamp(loc.endLine);
  if (startLine !== undefined && endLine !== undefined && endLine < startLine) {
    endLine = startLine;
  }
  return {
    file: loc.file,
    ...(startLine !== undefined ? { startLine } : {}),
    ...(endLine !== undefined ? { endLine } : {}),
    ...(loc.symbol !== undefined ? { symbol: loc.symbol } : {}),
  };
}

/**
 * Ground a reading against the real tree. Unlike `groundFindings` (which DROPS a
 * finding whose location is hallucinated), a reading is NEVER dropped — every
 * graded dimension must survive — so a hallucinated `location` is stripped to
 * fileless, `affectedFiles` is filtered to existing paths, line numbers are clamped
 * to the real file length, and each evidence item's location is grounded the same
 * way (stripped when its file does not exist). This is the production fix over a
 * model that deep-links to files it never read.
 */
export function groundReading(
  reading: ScorecardReading,
  projectPath: string,
): ScorecardReading {
  const location =
    reading.location !== undefined
      ? clampLocation(projectPath, reading.location)
      : undefined;
  const findings: ScorecardEvidence[] = reading.findings.map((ev) => {
    const loc =
      ev.location !== undefined
        ? clampLocation(projectPath, ev.location)
        : undefined;
    return { detail: ev.detail, ...(loc !== undefined ? { location: loc } : {}) };
  });
  return {
    ...reading,
    ...(location !== undefined ? { location } : { location: undefined }),
    affectedFiles: reading.affectedFiles.filter((f) => fileExists(projectPath, f)),
    findings,
  };
}
