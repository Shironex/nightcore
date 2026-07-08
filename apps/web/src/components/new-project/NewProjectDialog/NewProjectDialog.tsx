/** "New project" dialog: pick a git repo folder, name it, and create a project. */
import {
  Button,
  CloseIcon,
  FolderIcon,
  IconButton,
  IconPicker,
  IconTile,
  Modal,
  ProjectIcon,
  Spinner,
  UploadIcon,
} from '@/components/ui';

import { useNewProjectDialog } from './NewProjectDialog.hooks';
import type { NewProjectDialogProps } from './NewProjectDialog.types';

const FIELD_LABEL =
  'mb-1.5 block text-[11.5px] font-semibold text-muted-foreground';
const FIELD_INPUT =
  'w-full rounded-[10px] border border-border bg-black/20 px-3 py-2.5 text-sm text-foreground outline-none focus:border-primary';

/** Text colour class per git-detection state, applied to the status row. */
const GIT_ROW: Record<'valid' | 'invalid' | 'checking', string> = {
  valid: 'text-success',
  invalid: 'text-warning',
  checking: 'text-muted-foreground',
};
/** Status message shown for each git-detection state of the chosen folder. */
const GIT_TEXT: Record<'valid' | 'invalid' | 'checking', string> = {
  valid: '✓ Git repository detected.',
  invalid: 'Not a git repository.',
  checking: 'Checking…',
};

/**
 * Modal for creating a project from a git repository. Lets the user choose a
 * folder, name the project, pick a default model, and set concurrency. Create is
 * gated until a folder is chosen, a name is entered, and the folder is a valid
 * git repo; when it isn't, a `git init` action is offered. Concurrency is
 * collected here but badged as a not-yet-built affordance.
 */
export function NewProjectDialog({
  open,
  models,
  onChooseFolder,
  onCreate,
  onClose,
  folder = null,
  gitState = 'unknown',
  onInitGit,
}: NewProjectDialogProps) {
  const dialog = useNewProjectDialog({ open, models, onCreate, folder, gitState });
  const {
    name,
    model,
    concurrency,
    canCreate,
    busy,
    setName,
    setModel,
    setConcurrency,
    create,
  } = dialog;

  // Esc / click-outside close — but never while a create is in flight, to guard
  // against double-submit. The shared Modal adds the focus trap + restore.
  const close = busy ? () => {} : onClose;

  return (
    <Modal
      open={open}
      label="New project"
      onClose={close}
      overlayClassName="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-6 backdrop-blur-sm"
      panelClassName="flex max-h-[calc(100vh-3rem)] w-[520px] max-w-full flex-col overflow-hidden rounded-2xl border border-border bg-popover shadow-2xl"
    >
        <div className="flex items-center gap-3 border-b border-border px-5 py-4">
          <IconTile size="sm">
            <FolderIcon size={16} />
          </IconTile>
          <div className="flex-1">
            <div className="text-base font-semibold">New project</div>
            <div className="text-xs text-muted-foreground">
              Point Nightcore at a git repo to begin.
            </div>
          </div>
          <IconButton label="Close dialog" onClick={close}>
            <CloseIcon size={16} />
          </IconButton>
        </div>

        <div className="flex flex-col gap-4 overflow-y-auto p-5">
          <div>
            <label className={FIELD_LABEL} htmlFor="np-folder">
              Repository folder
            </label>
            <button
              id="np-folder"
              type="button"
              aria-label="Choose repository folder"
              onClick={() => void onChooseFolder()}
              className={`flex w-full items-center gap-2.5 rounded-[10px] border border-dashed bg-white/[0.02] px-3 py-2.5 text-left ${folder !== null ? 'border-border' : 'border-primary/50'}`}
            >
              <FolderIcon size={16} className="text-muted-foreground" />
              <span
                className={`flex-1 truncate font-mono text-[13px] ${folder !== null ? 'text-foreground' : 'text-muted-foreground'}`}
              >
                {folder ?? 'No folder selected'}
              </span>
              <span className="text-sm font-semibold text-primary">Choose…</span>
            </button>
            {folder !== null && gitState !== 'unknown' && gitState !== 'valid' && (
              <div
                className={`mt-2.5 flex items-center gap-2 font-mono text-[12px] ${GIT_ROW[gitState]}`}
              >
                <span>{GIT_TEXT[gitState]}</span>
                {gitState === 'invalid' && onInitGit !== undefined && (
                  <button
                    type="button"
                    onClick={() => void onInitGit()}
                    className="ml-auto font-semibold text-primary"
                  >
                    git init
                  </button>
                )}
              </div>
            )}
            {folder !== null && gitState === 'valid' && (
              <div className={`mt-2.5 flex items-center gap-2 font-mono text-[12px] ${GIT_ROW.valid}`}>
                <span>{GIT_TEXT.valid}</span>
              </div>
            )}
          </div>

          <div>
            <label className={FIELD_LABEL} htmlFor="np-name">
              Project name
            </label>
            <input
              id="np-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-project"
              className={FIELD_INPUT}
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className={FIELD_LABEL} htmlFor="np-model">
                Default model
              </label>
              <select
                id="np-model"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                className={`${FIELD_INPUT} cursor-pointer appearance-none`}
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </select>
            </div>
            <div className="w-[120px]">
              <label
                htmlFor="np-concurrency"
                className="mb-1.5 block text-[11.5px] font-semibold text-muted-foreground"
              >
                Concurrency
              </label>
              <input
                id="np-concurrency"
                type="number"
                min={1}
                max={6}
                value={concurrency}
                onChange={(e) => setConcurrency(Number(e.target.value))}
                className={`${FIELD_INPUT} font-mono`}
              />
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className={FIELD_LABEL}>Project icon</span>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-[10px] border border-border bg-white/[0.03]">
                <ProjectIcon
                  icon={dialog.pendingImage !== null ? null : dialog.icon}
                  imageUrl={dialog.pendingImage?.preview ?? null}
                  size={28}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="ghost"
                  type="button"
                  onClick={() => dialog.fileRef.current?.click()}
                >
                  <UploadIcon size={14} />
                  Upload
                </Button>
                {dialog.pendingImage !== null && (
                  <Button
                    variant="ghost"
                    type="button"
                    onClick={() => {
                      dialog.setPendingImage(null);
                      if (dialog.fileRef.current) dialog.fileRef.current.value = '';
                    }}
                  >
                    <CloseIcon size={14} />
                    Remove image
                  </Button>
                )}
              </div>
              <input
                ref={dialog.fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp,image/gif"
                className="hidden"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void dialog.handleUpload(file);
                }}
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {dialog.acceptedLabel} · max 5 MB
            </p>
            <IconPicker
              selectedIcon={dialog.pendingImage !== null ? null : dialog.icon}
              onSelectIcon={(next) => {
                dialog.setIcon(next);
                dialog.setPendingImage(null);
                if (dialog.fileRef.current) dialog.fileRef.current.value = '';
              }}
            />
            {dialog.error !== null && (
              <p className="text-[12.5px] text-destructive" role="alert">
                {dialog.error}
              </p>
            )}
          </div>
        </div>

        <div className="flex justify-end gap-2.5 border-t border-border bg-black/15 px-5 py-3.5">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={create} disabled={!canCreate} aria-busy={busy}>
            {busy ? <Spinner /> : null}
            {busy ? 'Creating…' : 'Create project'}
          </Button>
        </div>
    </Modal>
  );
}
