/**
 * The sensitive-read rule family (`sensitive-read` rule id): a TARGETED denylist of
 * credential stores and portable secret files a `Read` tool call must never reach
 * OUTSIDE the run roots — NOT blanket read confinement (that deliberate decision,
 * and the exfil threat model it answers, are documented at the facade head).
 * Extracted from `workspace-confinement.ts`; the orchestrator that dispatches to it
 * stays in that facade.
 */
import * as path from 'node:path';

import { HOME_DIR, isWithin } from './paths.js';

/** Stable id surfaced when the READ guard refuses a credential/secret read (kept
 *  distinct from `workspace-confinement` so telemetry can tell "escaped a write"
 *  apart from "tried to read a secret"). */
export const SENSITIVE_READ_RULE_ID = 'sensitive-read';

/** The native read tool whose target path the read guard inspects → its input
 *  key. Only `Read` is covered; `Grep`/`Glob`/`Bash`-based reads are out of scope
 *  (see the module header). */
export const FILE_READ_TARGET_KEY: Record<string, 'file_path'> = { Read: 'file_path' };

/** The reason the agent sees when the READ guard refuses a secret read — names the
 *  target and the working dir so the model understands it must stay in-cwd. */
export function sensitiveReadReason(target: string, cwd: string): string {
  return (
    `Blocked by Nightcore secret-exfiltration guard: reading ${target} is refused ` +
    `because it is a credential/secret store outside this task's working directory ` +
    `(${cwd}). Read only files inside the working directory; SSH/cloud keys, registry ` +
    `tokens, and other projects' .env files are off-limits so a compromised task ` +
    `cannot exfiltrate them.`
  );
}

/** Home-relative credential stores a task must never read (dirs match their whole
 *  subtree; files match exactly). These hold the portable, high-value secrets a
 *  prompt-injected task would exfiltrate — cloud/SSH keys, registry tokens, the
 *  Claude credential file. */
const SENSITIVE_HOME_RELATIVE: readonly string[] = [
  '.aws',
  '.ssh',
  '.gnupg',
  '.azure',
  '.kube',
  '.config/gcloud',
  '.config/gh',
  '.docker/config.json',
  '.netrc',
  '.npmrc',
  '.pypirc',
  '.git-credentials',
  '.claude.json',
  '.claude/.credentials.json',
] as const;

/** SSH/host private-key basenames — secrets regardless of directory, so they are
 *  matched by filename anywhere outside the run roots (a key copied into a repo, a
 *  sibling project's key, etc.). Public `.pub` counterparts are NOT secret. */
const PRIVATE_KEY_BASENAMES: ReadonlySet<string> = new Set([
  'id_rsa',
  'id_dsa',
  'id_ecdsa',
  'id_ed25519',
]);

/** `.env.<suffix>` suffixes that denote a NON-secret template checked into VCS —
 *  reading these is always fine, so they are excluded from the `.env` secret match. */
const ENV_TEMPLATE_SUFFIXES: ReadonlySet<string> = new Set([
  'example',
  'sample',
  'template',
  'dist',
  'defaults',
]);

/** True for a dotenv secret filename: `.env` or `.env.<env>` (e.g. `.env.local`,
 *  `.env.production`), EXCLUDING the non-secret templates (`.env.example`, …). */
function isDotEnvSecret(base: string): boolean {
  if (base === '.env') return true;
  if (!base.startsWith('.env.')) return false;
  return !ENV_TEMPLATE_SUFFIXES.has(base.slice('.env.'.length));
}

/** True when a resolved read target is a known credential store or a portable
 *  secret file — the READ guard's denylist. Callers apply this ONLY to targets
 *  already known to sit outside the run roots (so an in-cwd `.env` still reads). */
export function isSensitiveReadTarget(resolved: string): boolean {
  if (
    HOME_DIR.length > 0 &&
    SENSITIVE_HOME_RELATIVE.some((rel) => isWithin(resolved, path.join(HOME_DIR, rel)))
  ) {
    return true;
  }
  const base = path.basename(resolved);
  return isDotEnvSecret(base) || PRIVATE_KEY_BASENAMES.has(base);
}
