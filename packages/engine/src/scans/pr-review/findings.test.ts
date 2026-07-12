/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import type { ReviewFinding, ReviewLens, ReviewSeverity } from '@nightcore/contracts';

import {
  dedupePrReviewFindings,
  findingsFromStructuredOutput,
  groundPrReviewFindings,
  parsePrReviewFindings,
  PR_REVIEW_OUTPUT_FORMAT,
  reviewFingerprint,
  reviewSeverityRank,
} from './findings.js';

describe('parsePrReviewFindings', () => {
  test('coerces a valid array, forces lens, assigns id + fingerprint', () => {
    const raw = JSON.stringify([
      {
        severity: 'high',
        file: './src/a.ts',
        line: 12,
        title: 'Unvalidated input',
        body: 'the handler trusts the body',
        suggestedFix: 'validate with zod',
      },
    ]);
    const { findings, error } = parsePrReviewFindings(raw, 'security');
    expect(error).toBeUndefined();
    expect(findings).toHaveLength(1);
    const f = findings[0] as ReviewFinding;
    expect(f.lens).toBe('security');
    expect(f.severity).toBe('high');
    expect(f.file).toBe('src/a.ts'); // normalized (leading ./ stripped)
    expect(f.line).toBe(12);
    expect(f.suggestedFix).toBe('validate with zod');
    expect(f.id.startsWith('security-')).toBe(true);
    expect(f.fingerprint.length).toBeGreaterThan(0);
  });

  test('accepts an object with a findings array', () => {
    const raw = JSON.stringify({
      findings: [{ file: 'src/x.ts', title: 't', body: 'd' }],
    });
    const { findings } = parsePrReviewFindings(raw, 'logic');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.lens).toBe('logic');
  });

  test('accepts an empty {findings:[]} wrapper as zero findings, no error', () => {
    const { findings, error } = parsePrReviewFindings(
      JSON.stringify({ findings: [] }),
      'tests',
    );
    expect(error).toBeUndefined();
    expect(findings).toHaveLength(0);
  });

  test('accepts "body" via the "description" fallback and a "file:line" string', () => {
    const raw = JSON.stringify([
      { file: 'src/y.ts:9', title: 't', description: 'via description key' },
    ]);
    const { findings } = parsePrReviewFindings(raw, 'structure');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.file).toBe('src/y.ts');
    expect(findings[0]?.line).toBe(9);
    expect(findings[0]?.body).toBe('via description key');
  });

  test('maps synonym severities onto the unified scale', () => {
    const raw = JSON.stringify([
      { severity: 'warning', file: 'src/a.ts', title: 'a', body: 'd' },
      { severity: 'major', file: 'src/a.ts', title: 'b', body: 'd' },
    ]);
    const { findings } = parsePrReviewFindings(raw, 'logic');
    expect(findings[0]?.severity).toBe('low');
    expect(findings[1]?.severity).toBe('high');
  });

  test('drops items missing title/body or a locatable file, keeps valid ones', () => {
    const raw = JSON.stringify([
      { severity: 'low', file: 'src/a.ts', title: 'no body' },
      { title: 'no file', body: 'present' },
      { file: 'src/a.ts', title: 'ok', body: 'present' },
    ]);
    const { findings } = parsePrReviewFindings(raw, 'contracts');
    expect(findings).toHaveLength(1);
    expect(findings[0]?.title).toBe('ok');
  });

  test('drops a non-positive / non-integer line rather than failing the finding', () => {
    const raw = JSON.stringify([
      { file: 'src/a.ts', title: 't', body: 'd', line: 0 },
      { file: 'src/b.ts', title: 't2', body: 'd', line: 3.5 },
    ]);
    const { findings } = parsePrReviewFindings(raw, 'logic');
    expect(findings).toHaveLength(2);
    expect(findings[0]?.line).toBeUndefined();
    expect(findings[1]?.line).toBeUndefined();
  });

  test('reports an error when no JSON is present (drives the corrective retry)', () => {
    const { findings, error } = parsePrReviewFindings('the diff looks fine', 'tests');
    expect(findings).toHaveLength(0);
    expect(error).toBeDefined();
  });

  test('errors on prose whose only JSON is an incidental example (⇒ retry, not silent empty)', () => {
    const raw =
      'The diff looks fine. For reference, a finding would look like:\n' +
      '```json\n{"example": {"file": "src/a.ts", "title": "Sample"}}\n```\n' +
      'but nothing rose to that bar.';
    const { findings, error } = parsePrReviewFindings(raw, 'security');
    expect(findings).toHaveLength(0);
    expect(error).toBeDefined();
  });
});

describe('reviewFingerprint', () => {
  test('is stable across whitespace/case differences in the title', () => {
    const a = reviewFingerprint('security', 'src/a.ts', 'Unvalidated  Input');
    const b = reviewFingerprint('security', 'src/a.ts', 'unvalidated input');
    expect(a).toBe(b);
  });

  test('differs by lens and by file', () => {
    expect(reviewFingerprint('security', 'src/a.ts', 'x')).not.toBe(
      reviewFingerprint('logic', 'src/a.ts', 'x'),
    );
    expect(reviewFingerprint('security', 'src/a.ts', 'x')).not.toBe(
      reviewFingerprint('security', 'src/b.ts', 'x'),
    );
  });
});

describe('groundPrReviewFindings (diff-relative)', () => {
  function finding(over: Partial<ReviewFinding>): ReviewFinding {
    return {
      id: 'id',
      lens: 'security',
      severity: 'medium',
      file: 'src/a.ts',
      title: 't',
      body: 'd',
      fingerprint: 'fp',
      ...over,
    };
  }

  test('keeps a finding whose file is in the PR changed-file set', () => {
    const out = groundPrReviewFindings([finding({ file: 'src/a.ts' })], [
      'src/a.ts',
      'src/b.ts',
    ]);
    expect(out).toHaveLength(1);
  });

  test('drops a finding whose file is NOT a changed file (even if it exists on disk)', () => {
    // Diff-relative: not disk existence. `package.json` surely exists, but it is not
    // in this PR's changed set → dropped.
    const out = groundPrReviewFindings([finding({ file: 'package.json' })], [
      'src/a.ts',
    ]);
    expect(out).toHaveLength(0);
  });

  test('keeps a NEW file that is not on disk but IS in the changed set', () => {
    // A PR that adds `new.rs` has no `new.rs` in the current checkout; disk-grounding
    // would wrongly drop it. Diff-relative grounding keeps it.
    const out = groundPrReviewFindings([finding({ file: 'crates/new.rs' })], [
      'crates/new.rs',
    ]);
    expect(out).toHaveLength(1);
  });

  test('normalizes both sides so ./a and a compare equal', () => {
    const out = groundPrReviewFindings([finding({ file: './src/a.ts' })], [
      'src/a.ts',
    ]);
    expect(out).toHaveLength(1);
  });

  test('handles an empty/missing file field by dropping it (never in the set)', () => {
    const out = groundPrReviewFindings([finding({ file: '' })], ['src/a.ts']);
    expect(out).toHaveLength(0);
  });
});

describe('dedupePrReviewFindings', () => {
  function finding(over: Partial<ReviewFinding>): ReviewFinding {
    return {
      id: 'id',
      lens: 'security',
      severity: 'medium',
      file: 'src/a.ts',
      title: 't',
      body: 'd',
      fingerprint: 'fp',
      ...over,
    };
  }

  test('merges the same fingerprint, keeping the higher-severity instance', () => {
    const out = dedupePrReviewFindings([
      finding({ severity: 'low', fingerprint: 'shared', title: 'Injection', id: 'a' }),
      finding({ severity: 'critical', fingerprint: 'shared', title: 'Injection', id: 'b' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('critical');
  });

  test('does not merge distinct fingerprints and is order-stable', () => {
    const out = dedupePrReviewFindings([
      finding({ title: 'a', fingerprint: 'fp-a' }),
      finding({ title: 'b', fingerprint: 'fp-b' }),
    ]);
    expect(out).toHaveLength(2);
    expect(out.map((f) => f.fingerprint)).toEqual(['fp-a', 'fp-b']);
  });

  test('collapses the same file+title across lenses and records the corroborator', () => {
    const out = dedupePrReviewFindings([
      finding({
        lens: 'logic',
        severity: 'low',
        title: 'Race',
        id: 'logic-1',
        fingerprint: 'l1',
      }),
      finding({
        lens: 'security',
        severity: 'high',
        title: 'Race',
        id: 'sec-1',
        fingerprint: 's1',
      }),
    ]);
    expect(out).toHaveLength(1);
    const survivor = out[0] as ReviewFinding;
    // Higher-severity instance wins the survivor slot…
    expect(survivor.severity).toBe('high');
    expect(survivor.lens).toBe('security');
    // …and the OTHER reporting lens is recorded rather than lost.
    expect(survivor.corroboratedBy).toEqual(['logic']);
    // The survivor keeps its own lens-scoped fingerprint (the dismissed-history key).
    expect(survivor.fingerprint).toBe('s1');
  });

  test('records multiple corroborating lenses, sorted, excluding the survivor lens', () => {
    const out = dedupePrReviewFindings([
      finding({ lens: 'structure', severity: 'critical', title: 'Dup', id: 's', fingerprint: 'a' }),
      finding({ lens: 'tests', severity: 'low', title: 'Dup', id: 't', fingerprint: 'b' }),
      finding({ lens: 'logic', severity: 'medium', title: 'Dup', id: 'l', fingerprint: 'c' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.lens).toBe('structure'); // critical wins
    expect(out[0]?.corroboratedBy).toEqual(['logic', 'tests']); // sorted, minus structure
  });

  test('a same-lens duplicate merges without a corroboratedBy (no other lens)', () => {
    const out = dedupePrReviewFindings([
      finding({ lens: 'security', severity: 'low', title: 'X', id: 'a', fingerprint: 'a' }),
      finding({ lens: 'security', severity: 'high', title: 'X', id: 'b', fingerprint: 'b' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]?.severity).toBe('high');
    expect(out[0]?.corroboratedBy).toBeUndefined();
  });

  test('a lone finding carries no corroboratedBy', () => {
    const out = dedupePrReviewFindings([finding({ title: 'solo' })]);
    expect(out).toHaveLength(1);
    expect(out[0]?.corroboratedBy).toBeUndefined();
  });
});

describe('reviewSeverityRank', () => {
  test('orders info → critical', () => {
    const order: ReviewSeverity[] = ['info', 'low', 'medium', 'high', 'critical'];
    for (let i = 1; i < order.length; i++) {
      expect(reviewSeverityRank(order[i - 1] as ReviewSeverity)).toBeLessThan(
        reviewSeverityRank(order[i] as ReviewSeverity),
      );
    }
  });

  test('every lens resolves to a real fingerprint (sanity over the 5 lenses)', () => {
    const lenses: ReviewLens[] = [
      'security',
      'logic',
      'structure',
      'tests',
      'contracts',
    ];
    for (const lens of lenses) {
      expect(reviewFingerprint(lens, 'src/a.ts', 't').length).toBe(16);
    }
  });
});

describe('findingsFromStructuredOutput (structured-output path)', () => {
  test('coerces a valid { findings } object, forcing lens + id/fingerprint', () => {
    const structured = {
      findings: [
        {
          severity: 'high',
          file: './src/a.ts',
          line: 12,
          title: 'Unvalidated input',
          body: 'the handler trusts the body',
          suggestedFix: 'validate with zod',
        },
      ],
    };
    const out = findingsFromStructuredOutput(structured, 'security');
    expect(out).toBeDefined();
    expect(out).toHaveLength(1);
    const f = (out as ReviewFinding[])[0] as ReviewFinding;
    expect(f.lens).toBe('security');
    expect(f.severity).toBe('high');
    expect(f.line).toBe(12);
    expect(f.id).toBe(`security-${f.fingerprint}`);
  });

  test('drops the strict-schema null line/suggestedFix to absent (not a bad value)', () => {
    // Under strict structured output the model emits every key; optional ones come
    // back as `null` and must coerce to ABSENT rather than an invalid finding.
    const out = findingsFromStructuredOutput(
      {
        findings: [
          {
            severity: 'low',
            file: 'src/a.ts',
            line: null,
            title: 'nit',
            body: 'minor',
            suggestedFix: null,
          },
        ],
      },
      'structure',
    );
    expect(out).toHaveLength(1);
    const f = (out as ReviewFinding[])[0] as ReviewFinding;
    expect(f.line).toBeUndefined();
    expect(f.suggestedFix).toBeUndefined();
  });

  test('skips a malformed item (no title) without failing the batch', () => {
    const out = findingsFromStructuredOutput(
      {
        findings: [
          { severity: 'high', file: 'a.ts', body: 'no title here' },
          { severity: 'low', file: 'a.ts', title: 'ok', body: 'kept' },
        ],
      },
      'logic',
    );
    expect(out).toHaveLength(1);
    expect((out as ReviewFinding[])[0]?.title).toBe('ok');
  });

  test('present-but-empty findings yields [] (a clean lens, not a parse error)', () => {
    expect(findingsFromStructuredOutput({ findings: [] }, 'tests')).toEqual([]);
  });

  test('ABSENT structured output returns undefined (signals text-parse degrade)', () => {
    // undefined ⇒ the SDK returned no `structured_output` (older/degraded run or the
    // Codex path) → the caller falls back to prose-parsing the result text.
    expect(findingsFromStructuredOutput(undefined, 'security')).toBeUndefined();
    expect(findingsFromStructuredOutput(null, 'security')).toBeUndefined();
  });
});

describe('PR_REVIEW_OUTPUT_FORMAT (structured-output schema shape)', () => {
  test('is a strict json_schema whose finding keys are all required + closed', () => {
    expect(PR_REVIEW_OUTPUT_FORMAT.type).toBe('json_schema');
    const schema = PR_REVIEW_OUTPUT_FORMAT.schema as Record<string, unknown>;
    expect(schema.additionalProperties).toBe(false);
    const item = (
      (schema.properties as Record<string, { items: Record<string, unknown> }>).findings
        .items
    );
    // Strict structured output: every property key must appear in `required`, and the
    // object must be closed (`additionalProperties: false`).
    expect(item.additionalProperties).toBe(false);
    expect(new Set(item.required as string[])).toEqual(
      new Set(Object.keys(item.properties as Record<string, unknown>)),
    );
    // Engine-assigned fields must NOT be in the model's schema.
    const keys = Object.keys(item.properties as Record<string, unknown>);
    expect(keys).not.toContain('lens');
    expect(keys).not.toContain('id');
    expect(keys).not.toContain('fingerprint');
  });
});
