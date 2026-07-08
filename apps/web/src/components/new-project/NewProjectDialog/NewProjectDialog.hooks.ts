/** Form state and create logic for the new-project dialog. */
import { useCallback, useEffect, useRef, useState } from 'react';

import { ACCEPTED_IMAGE_LABEL, fileToProjectIcon } from '@/lib/attachments';

import type { NewProjectDialogProps } from './NewProjectDialog.types';

/** Derive a repository display name from either Windows or POSIX paths. */
export function projectNameFromPath(path: string): string {
  const segments = path.split(/[\\/]+/).filter(Boolean);
  if (segments.at(-1)?.toLowerCase() === '.git') segments.pop();
  return segments.at(-1) ?? '';
}

/** Form values, derived flags, and setters returned by `useNewProjectDialog`. */
export interface NewProjectDialogState {
  name: string;
  model: string;
  concurrency: number;
  icon: string | null;
  pendingImage: {
    format: string;
    data: string;
    filename: string;
    preview: string;
  } | null;
  error: string | null;
  fileRef: React.RefObject<HTMLInputElement | null>;
  acceptedLabel: string;
  canCreate: boolean;
  /** True while a create is in flight — disables the button to block double-submit. */
  busy: boolean;
  setName: (value: string) => void;
  setModel: (value: string) => void;
  setConcurrency: (value: number) => void;
  setIcon: (value: string | null) => void;
  setPendingImage: (value: NewProjectDialogState['pendingImage']) => void;
  handleUpload: (file: File) => Promise<void>;
  create: () => void;
}

type UseNewProjectDialogArgs = Pick<
  NewProjectDialogProps,
  'open' | 'models' | 'onCreate' | 'folder' | 'gitState'
>;

/** Form state and the create handler for the new-project dialog. Creation is
 *  gated on a chosen folder, a non-empty name, and a valid git repo. */
export function useNewProjectDialog({
  open,
  models,
  onCreate,
  folder = null,
  gitState = 'unknown',
}: UseNewProjectDialogArgs): NewProjectDialogState {
  const [name, setName] = useState('');
  const [model, setModel] = useState(models[0] ?? '');
  const [concurrency, setConcurrency] = useState(3);
  const [icon, setIcon] = useState<string | null>(null);
  const [pendingImage, setPendingImage] =
    useState<NewProjectDialogState['pendingImage']>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameEditedRef = useRef(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // The dialog now stays mounted across close so its exit can animate — reset the
  // form each time it opens, otherwise a cancelled draft would reappear on reopen.
  useEffect(() => {
    if (!open) return;
    setName('');
    nameEditedRef.current = false;
    setModel(models[0] ?? '');
    setConcurrency(3);
    setIcon(null);
    setPendingImage(null);
    setError(null);
    if (fileRef.current) fileRef.current.value = '';
  }, [open, models]);

  useEffect(() => {
    if (!open || folder === null || nameEditedRef.current) return;
    setName(projectNameFromPath(folder));
  }, [folder, open]);

  const updateName = useCallback((value: string) => {
    nameEditedRef.current = true;
    setName(value);
  }, []);

  const handleUpload = useCallback(async (file: File) => {
    try {
      const payload = await fileToProjectIcon(file);
      setPendingImage({
        ...payload,
        preview: `data:image/${payload.format};base64,${payload.data}`,
      });
      setIcon(null);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read image.');
    }
  }, []);

  // Esc / click-outside (suppressed while busy) and the focus trap live in the
  // shared `<Modal>` the dialog renders through — the double-submit guard is
  // preserved by passing a no-op close while a create is in flight.
  const canCreate =
    folder !== null && name.trim().length > 0 && gitState === 'valid' && !busy;

  const create = useCallback(() => {
    // Guard against a double-submit: re-entry while a create is already in flight
    // is a no-op (the second click would register a duplicate project).
    if (!canCreate || busy) return;
    setBusy(true);
    void Promise.resolve(
      onCreate({
        folder,
        name: name.trim(),
        model,
        concurrency,
        icon: pendingImage === null ? icon : null,
        customImage: pendingImage,
      }),
    ).finally(() => setBusy(false));
  }, [canCreate, busy, folder, name, model, concurrency, icon, pendingImage, onCreate]);

  return {
    name,
    model,
    concurrency,
    icon,
    pendingImage,
    error,
    fileRef,
    acceptedLabel: ACCEPTED_IMAGE_LABEL,
    canCreate,
    busy,
    setName: updateName,
    setModel,
    setConcurrency,
    setIcon,
    setPendingImage,
    handleUpload,
    create,
  };
}
