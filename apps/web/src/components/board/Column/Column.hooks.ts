import { useCallback, useState, type DragEvent } from 'react';
import type { Task } from '@/lib/bridge';

/** The MIME-ish key a dragged card carries its task id under. */
export const DRAG_TASK_ID = 'application/x-nc-task-id';

export interface ColumnDrop {
  /** True while a draggable card hovers a droppable column (drop-zone glow). */
  isOver: boolean;
  /** Whether this column accepts drops (In Progress never does). */
  droppable: boolean;
  /** Spread onto the column's drop container. No-op when not droppable. */
  dropProps: {
    onDragOver?: (e: DragEvent) => void;
    onDragLeave?: () => void;
    onDrop?: (e: DragEvent) => void;
  };
}

/** Drop-target behavior for a board column. A column whose `dropStatus` is
 *  `in_progress` (or unset, or without a handler) is inert — the backend rejects
 *  manual moves into In Progress, so we surface it as not-allowed and never call
 *  `onMoveTask`. Other columns accept a dropped card and move it to their status. */
export function useColumnDrop(
  dropStatus: Task['status'] | undefined,
  onMoveTask: ((id: string, status: Task['status']) => void) | undefined,
): ColumnDrop {
  const [isOver, setIsOver] = useState(false);
  const droppable =
    dropStatus !== undefined && dropStatus !== 'in_progress' && onMoveTask !== undefined;

  const onDragOver = useCallback(
    (e: DragEvent) => {
      if (!droppable) {
        e.dataTransfer.dropEffect = 'none';
        return;
      }
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setIsOver(true);
    },
    [droppable],
  );

  const onDragLeave = useCallback(() => setIsOver(false), []);

  const onDrop = useCallback(
    (e: DragEvent) => {
      setIsOver(false);
      if (!droppable || dropStatus === undefined || onMoveTask === undefined) return;
      e.preventDefault();
      const id = e.dataTransfer.getData(DRAG_TASK_ID);
      if (id !== '') onMoveTask(id, dropStatus);
    },
    [droppable, dropStatus, onMoveTask],
  );

  return {
    isOver,
    droppable,
    dropProps: droppable ? { onDragOver, onDragLeave, onDrop } : { onDragOver },
  };
}
