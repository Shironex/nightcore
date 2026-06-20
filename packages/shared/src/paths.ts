import * as os from 'node:os';
import * as path from 'node:path';

/** The global Nightcore home directory: `~/.nightcore`. */
export function nightcoreHome(): string {
  return path.join(os.homedir(), '.nightcore');
}

/** The session-metadata directory under the home dir. */
export function sessionsDir(home = nightcoreHome()): string {
  return path.join(home, 'sessions');
}

/** The per-project `.nightcore` directory for a given project root. */
export function projectDir(projectRoot: string): string {
  return path.join(projectRoot, '.nightcore');
}

/** Expand a leading `~` to the user's home directory. */
export function expandHome(p: string): string {
  if (p === '~') return os.homedir();
  if (p.startsWith('~/')) return path.join(os.homedir(), p.slice(2));
  return p;
}
