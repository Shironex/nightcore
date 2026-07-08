import { useCallback } from 'react';

import type { ProjectCardProps } from './ProjectCard.types';

/** Stable adapter from the card's menu action to the shared removal request. */
export function useProjectCard({
  project,
  onDelete,
}: Pick<ProjectCardProps, 'project' | 'onDelete'>) {
  const requestRemove = useCallback(() => {
    onDelete?.(project.id);
  }, [onDelete, project.id]);

  return { requestRemove };
}
