import { useEffect } from 'react';
import { expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import { type ScanRunApi, type ScanRunConfig, useScanRun } from './useScanRun';

// Minimal stand-ins for a scan family's event / run / stream triple. The hook is
// generic over these, and takes its bridge seams as an injected config, so a test
// can drive the whole lifecycle without mocking `@/lib/bridge` — it just hands in
// controllable `vi.fn` seams the way each real family (Insight/Harness/Scorecard/
// PR-Review) hands in its own.
interface TestRun {
  id: string;
}
interface TestStream {
  runId: string | null;
  label: string;
}
interface TestEvent {
  runId: string;
  kind: string;
}
type TestApi = ScanRunApi<TestRun, TestStream>;
type TestConfig = ScanRunConfig<TestEvent, TestRun, TestStream>;

const EMPTY: TestStream = { runId: null, label: 'idle' };

/** A default config with controllable seams; every field is overridable per test.
 *  `listRuns` defaults to empty so the initial-load effect leaves the idle stream
 *  in place (tests that assert on `stream` aren't clobbered by a newest-run swap). */
function makeConfig(overrides: Partial<TestConfig> = {}): TestConfig {
  return {
    emptyStream: EMPTY,
    listRuns: vi.fn(async () => [] as TestRun[]),
    getRun: vi.fn(async (id: string) => ({ id })),
    streamFromRun: (run) => ({ runId: run.id, label: `projected:${run.id}` }),
    cancelRun: vi.fn(async () => {}),
    subscribe: vi.fn(async () => () => {}),
    onEvent: vi.fn(),
    ...overrides,
  };
}

/** Render `useScanRun` and report the returned api after every commit. */
function Harness({ config, sink }: { config: TestConfig; sink: (api: TestApi) => void }) {
  const api = useScanRun(config);
  useEffect(() => {
    sink(api);
  });
  return null;
}

/** Mount the hook and wait until its api is available; returns a `get` for the
 *  latest api snapshot plus the render handle (for `unmount`). */
async function mount(config: TestConfig) {
  let latest: TestApi | undefined;
  const view = render(<Harness config={config} sink={(api) => (latest = api)} />);
  await vi.waitFor(() => expect(latest).toBeDefined());
  return { get: () => latest!, view };
}

test('two synchronous runStart calls mint only one run (re-entrancy guard)', async () => {
  const { get } = await mount(makeConfig());

  let minted = 0;
  const launch = vi.fn(async () => {
    minted += 1;
    const runId = `run-${minted}`;
    return { runId, optimistic: { runId, label: 'running' } };
  });

  // Fire two starts in the SAME synchronous tick — the render gap before the
  // disabled button / optimistic state lands. `runStart` flips `inFlight` before
  // its first await, so the second dispatch must guard out (return false) and NOT
  // launch a second paid run.
  const [r1, r2] = await Promise.all([
    get().runStart(true, launch),
    get().runStart(true, launch),
  ]);

  expect(r1).toBe(true);
  expect(r2).toBe(false);
  expect(launch).toHaveBeenCalledTimes(1);
  expect(minted).toBe(1);
  expect(get().activeRunId.current).toBe('run-1');
  await vi.waitFor(() => expect(get().stream.label).toBe('running'));
});

test('runStart records startError and clears inFlight so a retry can launch', async () => {
  const { get } = await mount(makeConfig());

  const r1 = await get().runStart(true, () => Promise.reject(new Error('launch failed')));
  expect(r1).toBe(false);
  await vi.waitFor(() => expect(get().startError).toBe('launch failed'));

  // The failed launch cleared `inFlight` in its finally block, so a retry is not a
  // no-op: it launches and clears the prior error.
  const launch = vi.fn(async () => ({ runId: 'run-1', optimistic: { runId: 'run-1', label: 'running' } }));
  const r2 = await get().runStart(true, launch);
  expect(r2).toBe(true);
  expect(launch).toHaveBeenCalledTimes(1);
  await vi.waitFor(() => expect(get().startError).toBeNull());
});

test('reconcile honors a reconcileStream override over the default projection', async () => {
  const config = makeConfig({
    getRun: vi.fn(async (id: string) => ({ id })),
    streamFromRun: (run) => ({ runId: run.id, label: 'default-projection' }),
    // Threads the prior stream through — Harness relies on this to preserve the
    // live fold's failure reason on reconcile.
    reconcileStream: (run, prev) => ({ runId: run.id, label: `reconciled-from-${prev.label}` }),
  });
  const { get } = await mount(config);

  await get().reconcile('run-x');

  // The override wins (and received the previous idle stream), so we see the
  // reconciled label rather than `default-projection`.
  await vi.waitFor(() => expect(get().stream.label).toBe('reconciled-from-idle'));
  expect(get().stream.runId).toBe('run-x');
});

test('reconcile falls back to streamFromRun when no override is given', async () => {
  const config = makeConfig({
    getRun: vi.fn(async (id: string) => ({ id })),
    streamFromRun: (run) => ({ runId: run.id, label: 'default-projection' }),
  });
  const { get } = await mount(config);

  await get().reconcile('run-y');

  await vi.waitFor(() => expect(get().stream.label).toBe('default-projection'));
  expect(get().stream.runId).toBe('run-y');
});

test('unmount unsubscribes so a late event never reaches onEvent', async () => {
  // A live emitter whose `unlisten` removes the handler — the same contract as the
  // real bridge, where a torn-down listener stops receiving engine events.
  const handlers = new Set<(event: TestEvent) => void>();
  const onEvent = vi.fn();
  const config = makeConfig({
    subscribe: vi.fn(async (handler: (event: TestEvent) => void) => {
      handlers.add(handler);
      return () => {
        handlers.delete(handler);
      };
    }),
    onEvent,
  });

  const { view } = await mount(config);
  await vi.waitFor(() => expect(handlers.size).toBe(1));

  // While mounted, a live event folds through onEvent.
  handlers.forEach((handler) => handler({ runId: 'r1', kind: 'live' }));
  expect(onEvent).toHaveBeenCalledTimes(1);

  // Unmount must run the subscribe effect's cleanup, which calls the unlisten fn.
  view.unmount();
  await vi.waitFor(() => expect(handlers.size).toBe(0));

  // The engine has nothing to deliver a late event to — onEvent stays at one call.
  expect(onEvent).toHaveBeenCalledTimes(1);
});
