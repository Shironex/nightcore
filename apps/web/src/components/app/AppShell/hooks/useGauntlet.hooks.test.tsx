import { useEffect } from 'react';
import { afterEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';

import type { ToastApi } from '@/components/ui';
import type { GauntletResult, ProjectEnvelope } from '@/lib/bridge';

// Mock the bridge seam so `runGauntlet` is controllable per test and the
// `nc:project` subscription handler is captured for driving activated/deleted
// resets — mirrors the `useBlockedIds` handler-capture pattern in this dir.
const runGauntlet = vi.fn<(id: string) => Promise<GauntletResult>>();
let projectHandler: ((e: ProjectEnvelope) => void) | undefined;
const onProjectEvent = vi.fn((h: (e: ProjectEnvelope) => void) => {
  projectHandler = h;
  return Promise.resolve(() => {});
});
vi.mock('@/lib/bridge', () => ({
  runGauntlet: (id: string) => runGauntlet(id),
  onProjectEvent: (h: (e: ProjectEnvelope) => void) => onProjectEvent(h),
}));

import { useGauntlet } from './useGauntlet.hooks';

afterEach(() => {
  runGauntlet.mockReset();
  onProjectEvent.mockClear();
  projectHandler = undefined;
});

/** A promise plus its external resolver/rejecter, for pinning the in-flight
 *  gauntlet open until the test drives its outcome. */
function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
  reject: (e: unknown) => void;
} {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function fakeToast(): ToastApi {
  return { toasts: [], push: vi.fn(() => 1), error: vi.fn(() => 1), dismiss: vi.fn() };
}

type Gauntlet = ReturnType<typeof useGauntlet>;

/** Render `useGauntlet` and hand the latest hook value back each render. */
function Harness({ toast, sink }: { toast: ToastApi; sink: (g: Gauntlet) => void }) {
  const gauntlet = useGauntlet(toast);
  useEffect(() => {
    sink(gauntlet);
  });
  return null;
}

function renderGauntlet(toast: ToastApi): () => Gauntlet {
  let latest: Gauntlet | undefined;
  render(<Harness toast={toast} sink={(g) => (latest = g)} />);
  return () => {
    if (!latest) throw new Error('useGauntlet has not rendered yet');
    return latest;
  };
}

test('a runGauntlet rejection yields a fail-closed result and clears running in finally', async () => {
  // Pin the run open so `running` is observable before the outcome lands.
  const d = deferred<GauntletResult>();
  runGauntlet.mockReturnValue(d.promise);
  const toast = fakeToast();
  const get = renderGauntlet(toast);
  await vi.waitFor(() => expect(get().run).toBeTypeOf('function'));

  get().run('t1');
  // The in-flight task is tracked immediately (stable while the promise is pending).
  await vi.waitFor(() => expect(get().running.has('t1')).toBe(true));

  // The gauntlet crashes. The merge gate MUST stay closed: the `.catch` surfaces a
  // synthetic FAILED result rather than a silent no-op that would let a broken
  // gauntlet merge. A regression to `passed: true` here is the whole point of the test.
  d.reject(new Error('gauntlet crashed'));
  await vi.waitFor(() =>
    expect(get().results['t1']).toEqual({
      passed: false,
      steps: [],
      failedStep: 'Checks could not run',
    }),
  );
  // `finally` clears the in-flight flag even on the error path.
  await vi.waitFor(() => expect(get().running.has('t1')).toBe(false));
  expect(toast.error).toHaveBeenCalledWith(
    'Could not run the readiness checks',
    expect.anything(),
  );
});

test.each(['activated', 'deleted'] as const)(
  'a %s project event clears results and running (the board re-seeds)',
  async (type) => {
    // First run resolves (seeds a passing result); a second run stays pending so
    // `running` is non-empty when the reset fires — proving BOTH maps clear.
    runGauntlet.mockResolvedValueOnce({ passed: true, steps: [] });
    const toast = fakeToast();
    const get = renderGauntlet(toast);
    await vi.waitFor(() => expect(projectHandler).toBeDefined());

    get().run('t1');
    await vi.waitFor(() => expect(get().results['t1']?.passed).toBe(true));

    const pending = deferred<GauntletResult>();
    runGauntlet.mockReturnValueOnce(pending.promise);
    get().run('t2');
    await vi.waitFor(() => expect(get().running.has('t2')).toBe(true));

    projectHandler!({ type, project: null, projects: [] });

    await vi.waitFor(() => {
      expect(get().results).toEqual({});
      expect(get().running.size).toBe(0);
    });
  },
);
