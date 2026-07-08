import { useCallback, useState } from 'react';

import type { Project } from '@/lib/bridge';

/** Shared confirmation state for every project-removal entry point. */
export function useProjectRemoval(
  projects: Project[],
  remove: (id: string) => void,
) {
  const [pending, setPending] = useState<Project | null>(null);

  const request = useCallback(
    (id: string) => {
      const project = projects.find((candidate) => candidate.id === id);
      if (project !== undefined) setPending(project);
    },
    [projects],
  );
  const cancel = useCallback(() => setPending(null), []);
  const confirm = useCallback(() => {
    if (pending === null) return;
    remove(pending.id);
    setPending(null);
  }, [pending, remove]);

  return { pending, request, cancel, confirm };
}
