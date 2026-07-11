/** State + pure derivations for the CreateWorktreeDialog (spec PR 5a). Owns the name /
 *  create-branch toggle / base fields; the `.tsx` shell stays a thin presentation layer. */
import { useEffect, useState } from 'react';

import type { CreateWorktreeDialogProps } from './CreateWorktreeDialog.types';

/** A client-side preview of the slug the server will derive from `name` — cosmetic only
 *  (the Rust `slugify` is authoritative). Lowercases, collapses non-alphanumerics to a
 *  single `-`, and trims. */
export function previewSlug(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The dialog's controlled state + handlers, reset each time it opens. */
export function useCreateWorktreeDialog({
  open,
  busy,
  onConfirm,
}: Pick<CreateWorktreeDialogProps, 'open' | 'busy' | 'onConfirm'>) {
  const [name, setName] = useState('');
  const [createBranch, setCreateBranch] = useState(true);
  const [base, setBase] = useState('');

  // Reset the form each time the dialog opens so a prior attempt doesn't linger.
  useEffect(() => {
    if (open) {
      setName('');
      setCreateBranch(true);
      setBase('');
    }
  }, [open]);

  const slug = previewSlug(name);
  // Submittable once the name yields a non-empty slug (matching the server's reject rule)
  // and no create is in flight.
  const canSubmit = slug !== '' && busy !== true;

  const submit = () => {
    if (!canSubmit) return;
    onConfirm({ name, createBranch, base });
  };

  return {
    name,
    setName,
    createBranch,
    setCreateBranch,
    base,
    setBase,
    slug,
    canSubmit,
    submit,
  };
}
