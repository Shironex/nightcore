/**
 * A cheap, bounded top-level map of the repo, injected into each scan pass's prompt
 * so the model starts from a known structure instead of re-discovering the tree.
 * Split out of the {@link ScanManager} base class as its own filesystem concern.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Conventional source dirs worth a shallow peek in the repo inventory. */
const INVENTORY_PEEK_DIRS = [
  'src',
  'app',
  'apps',
  'packages',
  'lib',
  'crates',
  'server',
];
/** Cap per listing so a pathological dir can't flood the prompt. */
const INVENTORY_MAX_ENTRIES = 60;
/** Dirs never worth listing (build output / vendored deps / vcs). */
const INVENTORY_SKIP_DIRS = new Set(['node_modules', 'target', 'dist', '.git']);

/**
 * A cheap, bounded top-level map of the repo: the root dir/file names plus a shallow
 * peek into a few conventional source dirs. Injected into each pass's prompt so the
 * model starts from a known structure instead of burning turns re-discovering the
 * tree on every pass — the dominant source of wasted exploration in a multi-pass
 * scan. Pure synchronous fs; never throws.
 */
export function buildRepoInventory(projectPath: string): string {
  const root = path.resolve(projectPath);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root, { withFileTypes: true });
  } catch {
    return '(repo inventory unavailable)';
  }
  const skip = (name: string): boolean =>
    name.startsWith('.') || INVENTORY_SKIP_DIRS.has(name);
  const dirs = entries
    .filter((e) => e.isDirectory() && !skip(e.name))
    .map((e) => e.name)
    .sort()
    .slice(0, INVENTORY_MAX_ENTRIES);
  const files = entries
    .filter((e) => e.isFile() && !e.name.startsWith('.'))
    .map((e) => e.name)
    .sort()
    .slice(0, INVENTORY_MAX_ENTRIES);
  const lines = [
    `top-level dirs: ${dirs.join(', ') || '(none)'}`,
    `top-level files: ${files.join(', ') || '(none)'}`,
  ];
  for (const dir of INVENTORY_PEEK_DIRS) {
    if (!dirs.includes(dir)) continue;
    try {
      const children = fs
        .readdirSync(path.join(root, dir), { withFileTypes: true })
        .filter((e) => !skip(e.name))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort()
        .slice(0, INVENTORY_MAX_ENTRIES);
      if (children.length > 0) lines.push(`${dir}/: ${children.join(', ')}`);
    } catch {
      /* unreadable dir — skip it, never throw */
    }
  }
  return lines.join('\n');
}
