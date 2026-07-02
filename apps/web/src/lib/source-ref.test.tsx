import { expect, test } from 'vitest';

import { parseSourceRef, sourceRefLabel } from './source-ref';

test('parses each known scheme to its owning view and selection channel', () => {
  expect(parseSourceRef('insight:run-1:finding-9')).toEqual({
    view: 'insight',
    kind: 'finding',
    runId: 'run-1',
    itemId: 'finding-9',
  });
  expect(parseSourceRef('scorecard:run-2:reading-3')).toEqual({
    view: 'scorecard',
    kind: 'reading',
    runId: 'run-2',
    itemId: 'reading-3',
  });
  expect(parseSourceRef('harness:run-4:conv-1')).toEqual({
    view: 'harness',
    kind: 'finding',
    runId: 'run-4',
    itemId: 'conv-1',
  });
  expect(parseSourceRef('harness-proposal:run-4:prop-2')).toEqual({
    view: 'harness',
    kind: 'proposal',
    runId: 'run-4',
    itemId: 'prop-2',
  });
});

test('keeps colons inside the item id — only the first two separators are structural', () => {
  expect(parseSourceRef('insight:run-1:file.ts:12')).toEqual({
    view: 'insight',
    kind: 'finding',
    runId: 'run-1',
    itemId: 'file.ts:12',
  });
});

test('returns null for unknown schemes and malformed tokens', () => {
  expect(parseSourceRef('mystery:run:item')).toBeNull();
  expect(parseSourceRef('insight')).toBeNull();
  expect(parseSourceRef('insight:run-only')).toBeNull();
  expect(parseSourceRef('insight::item')).toBeNull();
  expect(parseSourceRef('insight:run:')).toBeNull();
  expect(parseSourceRef('')).toBeNull();
});

test('labels known schemes and degrades unknown/absent ones to null', () => {
  expect(sourceRefLabel('insight:r:i')).toBe('Insight finding');
  expect(sourceRefLabel('scorecard:r:i')).toBe('Scorecard reading');
  expect(sourceRefLabel('harness:r:i')).toBe('Harness convention');
  expect(sourceRefLabel('harness-proposal:r:i')).toBe('Harness proposal');
  expect(sourceRefLabel('mystery:r:i')).toBeNull();
  expect(sourceRefLabel(null)).toBeNull();
});
