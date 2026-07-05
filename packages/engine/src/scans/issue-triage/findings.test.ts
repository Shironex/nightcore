/// <reference types="bun" />
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterAll, beforeAll, describe, expect, test } from 'bun:test';

import type { IssueValidationResult } from '@nightcore/contracts';

import { groundIssueVerdict, parseIssueVerdict } from './findings.js';

/** A full, well-formed verdict object the model is asked to emit. */
const FULL_VERDICT = {
  issueKind: 'bug_report',
  verdict: 'valid',
  confidence: 'high',
  reasoning: 'The empty-project guard renders after the crash path.',
  bugConfirmed: true,
  relatedFiles: ['apps/web/src/App.tsx'],
  estimatedComplexity: 'simple',
  proposedPlan: '1. Guard the empty state.\n2. Render the projects view.',
  missingInfo: [],
  prAnalysis: {
    hasOpenPr: true,
    prNumber: 130,
    prFixesIssue: true,
    prSummary: 'PR #130 adds the missing guard.',
    recommendation: 'wait_for_merge',
  },
};

describe('parseIssueVerdict — the strict single-object contract', () => {
  test('parses one clean verdict object', () => {
    const { verdict, error } = parseIssueVerdict(JSON.stringify(FULL_VERDICT));
    expect(error).toBeUndefined();
    expect(verdict?.verdict).toBe('valid');
    expect(verdict?.issueKind).toBe('bug_report');
    expect(verdict?.confidence).toBe('high');
    expect(verdict?.bugConfirmed).toBe(true);
    expect(verdict?.relatedFiles).toEqual(['apps/web/src/App.tsx']);
    expect(verdict?.prAnalysis?.recommendation).toBe('wait_for_merge');
  });

  test('tolerates a one-element array wrapper (the scorecard tolerance)', () => {
    const { verdict, error } = parseIssueVerdict(
      JSON.stringify([FULL_VERDICT]),
    );
    expect(error).toBeUndefined();
    expect(verdict?.verdict).toBe('valid');
  });

  test('tolerates a ```json fenced object with surrounding prose', () => {
    const raw = `Here is my verdict:\n\`\`\`json\n${JSON.stringify(
      FULL_VERDICT,
    )}\n\`\`\`\nDone.`;
    const { verdict, error } = parseIssueVerdict(raw);
    expect(error).toBeUndefined();
    expect(verdict?.issueKind).toBe('bug_report');
  });

  test('returns an error when there is no JSON at all (⇒ corrective retry)', () => {
    const { verdict, error } = parseIssueVerdict('I could not find anything.');
    expect(verdict).toBeUndefined();
    expect(error).toBeDefined();
  });

  test('errors on an off-contract verdict value (must not be fabricated)', () => {
    const { verdict, error } = parseIssueVerdict(
      JSON.stringify({ ...FULL_VERDICT, verdict: 'maybe' }),
    );
    expect(verdict).toBeUndefined();
    expect(error).toContain('verdict');
  });

  test('errors when reasoning is missing/empty (the other non-fabricatable field)', () => {
    const { verdict, error } = parseIssueVerdict(
      JSON.stringify({ ...FULL_VERDICT, reasoning: '   ' }),
    );
    expect(verdict).toBeUndefined();
    expect(error).toBeDefined();
  });

  test('coerces an unrecognized issueKind to the honest "unknown" (never errors)', () => {
    const { verdict } = parseIssueVerdict(
      JSON.stringify({ ...FULL_VERDICT, issueKind: 'incident', prAnalysis: undefined }),
    );
    expect(verdict?.issueKind).toBe('unknown');
  });

  test('maps common kind synonyms (bug → bug_report, feature → feature_request)', () => {
    expect(
      parseIssueVerdict(JSON.stringify({ ...FULL_VERDICT, issueKind: 'bug' }))
        .verdict?.issueKind,
    ).toBe('bug_report');
    expect(
      parseIssueVerdict(
        JSON.stringify({ ...FULL_VERDICT, issueKind: 'feature' }),
      ).verdict?.issueKind,
    ).toBe('feature_request');
  });

  test('coerces a missing/odd confidence to "low" rather than losing the verdict', () => {
    const { verdict } = parseIssueVerdict(
      JSON.stringify({ ...FULL_VERDICT, confidence: 'unsure' }),
    );
    expect(verdict?.confidence).toBe('low');
  });

  test('drops an off-scale estimatedComplexity (optional, never faked)', () => {
    const { verdict } = parseIssueVerdict(
      JSON.stringify({ ...FULL_VERDICT, estimatedComplexity: 'epic' }),
    );
    expect(verdict?.estimatedComplexity).toBeUndefined();
    expect(verdict?.verdict).toBe('valid');
  });

  test('derives an off-contract PR recommendation from the authoritative hasOpenPr', () => {
    const withOpenPr = parseIssueVerdict(
      JSON.stringify({
        ...FULL_VERDICT,
        prAnalysis: { hasOpenPr: true, recommendation: 'close_it' },
      }),
    ).verdict;
    expect(withOpenPr?.prAnalysis?.recommendation).toBe('pr_needs_work');

    const noPr = parseIssueVerdict(
      JSON.stringify({
        ...FULL_VERDICT,
        prAnalysis: { hasOpenPr: false, recommendation: 'nonsense' },
      }),
    ).verdict;
    expect(noPr?.prAnalysis?.recommendation).toBe('no_pr');
  });

  test('drops a malformed prAnalysis but keeps the rest of the verdict', () => {
    const { verdict } = parseIssueVerdict(
      JSON.stringify({ ...FULL_VERDICT, prAnalysis: 'not an object' }),
    );
    expect(verdict?.prAnalysis).toBeUndefined();
    expect(verdict?.verdict).toBe('valid');
  });

  test('normalizes relatedFiles paths (strips ./, drops empties) at parse time', () => {
    const { verdict } = parseIssueVerdict(
      JSON.stringify({
        ...FULL_VERDICT,
        relatedFiles: ['./apps/web/src/App.tsx', '', 'src/a.ts'],
      }),
    );
    expect(verdict?.relatedFiles).toEqual(['apps/web/src/App.tsx', 'src/a.ts']);
  });
});

describe('groundIssueVerdict — drop hallucinated relatedFiles', () => {
  let dir: string;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'issue-triage-ground-'));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'real.ts'), 'a\nb\nc\n');
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const base: IssueValidationResult = {
    issueKind: 'bug_report',
    verdict: 'valid',
    confidence: 'high',
    reasoning: 'ok',
    relatedFiles: [],
    missingInfo: [],
  };

  test('keeps existing paths and drops the ones that do not resolve', () => {
    const grounded = groundIssueVerdict(
      { ...base, relatedFiles: ['src/real.ts', 'src/ghost.ts'] },
      dir,
    );
    expect(grounded.relatedFiles).toEqual(['src/real.ts']);
  });

  test('drops a path escaping the project root (containment)', () => {
    const grounded = groundIssueVerdict(
      { ...base, relatedFiles: ['../secret.ts', 'src/real.ts'] },
      dir,
    );
    expect(grounded.relatedFiles).toEqual(['src/real.ts']);
  });

  test('never fails the verdict — an all-hallucinated list just empties out', () => {
    const grounded = groundIssueVerdict(
      { ...base, relatedFiles: ['nope/a.ts', 'nope/b.ts'] },
      dir,
    );
    expect(grounded.relatedFiles).toEqual([]);
    expect(grounded.verdict).toBe('valid');
  });
});
