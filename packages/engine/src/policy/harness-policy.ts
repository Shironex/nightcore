/**
 * The harness runtime policy gate (hardening module #3: protected paths +
 * bypass-flag denial) — the third PreToolUse evaluator in {@link HookBus}, after
 * the destructive deny list and workspace confinement. Like both siblings it
 * fires **regardless of `permissionMode`** — including `bypassPermissions`, where
 * `canUseTool` is never consulted — so a project's declared rails hold under the
 * studio's default unattended config.
 *
 * WHY THIS EXISTS. The Structure-Lock gauntlet catches a degraded codebase AFTER
 * the agent finishes; this gate stops the highest-signal degradations AT THE TOOL
 * CALL: editing lockfiles, migrations, or generated code the project declared
 * off-limits (`protectedPaths`), and Bash escape hatches that weaken the gates
 * themselves (`denyBashPatterns`, e.g. `--no-verify`). The rules come from the
 * `policy` key of the project's `.nightcore/harness.json` — project-authored (or
 * Rust-written) config resolved by the Rust core at dispatch and carried on
 * `start-session`; NEVER model output.
 *
 * SELF-PROTECTION. Whenever the policy layer is armed, `.nightcore/**` is
 * IMPLICITLY protected ({@link MANIFEST_PROTECTED_PATTERN}): the manifest drives
 * both this gate and the gauntlet, so an agent must not be able to edit the
 * enforcement config that gates it (weaken checks, drop the policy) and then walk
 * through the hole. The Rust core arms the layer for ANY manifest — even one with
 * no `policy` key — precisely so this floor exists for every project with an
 * armed check. In worktree mode the real manifest sits OUTSIDE the run cwd
 * (`.nightcore/` is gitignored), where workspace confinement already denies the
 * write; this pattern closes the main-mode path (cwd = project root).
 *
 * SCOPE & LIMITS — read before extending. Protected paths cover the path-bearing
 * native mutation tools (`Write`/`Edit`/`MultiEdit`/`NotebookEdit`) with the same
 * LEXICAL resolution as workspace confinement (shared helpers; symlinks are not
 * followed). Bash write vectors (`> file`, `tee`, `sed -i`, `mv`) are NOT
 * path-checked — expressing those rails is what `denyBashPatterns` is for, and
 * real containment remains the OS sandbox (the tiered-sandbox roadmap). Path
 * matching is case-INSENSITIVE: on a case-insensitive filesystem (macOS) a
 * case-variant write lands in the protected file, so folding case only ever
 * STRENGTHENS protection (a Linux false positive blocks a legitimately distinct
 * case-variant path — rare, accepted). Bash patterns are project-authored
 * regexes matched against the RAW command line, case-sensitive (predictable for
 * pattern authors); an invalid regex is warn-and-skipped at compile so one typo
 * never bricks the layer, and a matcher this simple is heuristic, not a parser —
 * an agent can compose an evasive command (`printf`-built, base64) exactly as it
 * can against the destructive deny list.
 *
 * FAIL-OPEN/CLOSED POSTURE. A mutation-tool call whose target can't be read is
 * left alone here — workspace confinement runs FIRST in {@link HookBus} and
 * already fail-CLOSES that exact shape (deny on unreadable target), so this gate
 * never sees it un-denied in a real session; not re-implementing the denial keeps
 * one owner for that decision. Targets that resolve OUTSIDE the run cwd are also
 * left alone (confinement's jurisdiction — deny or the temp-dir allowance);
 * protected patterns are meaningful only as repo-relative paths.
 *
 * GLOB SEMANTICS (documented on the wire schema, tested here):
 *   - `*` matches within a path segment, `**` matches zero or more segments.
 *   - A pattern containing `/` is ANCHORED at the run cwd (repo root).
 *   - A pattern without `/` FLOATS: it matches its segment at any depth
 *     (`*.lock` ⇒ any lockfile anywhere, gitignore-style).
 *   - A matched PREFIX protects the whole subtree (`migrations` ⇒ every file
 *     under `migrations/`), so non-glob patterns read naturally.
 */
import type { HarnessPolicy } from '@nightcore/contracts';
import type { Logger } from '@nightcore/shared';
import * as path from 'node:path';
import {
  BASH_TOOL,
  type ToolDenyVerdict,
} from './tool-deny-policy.js';
import {
  FILE_MUTATION_TARGET_KEY,
  isWithin,
  resolveAgainst,
  targetUnderKey,
} from './workspace-confinement.js';

/** Stable id surfaced in logs/telemetry when a protected-path rule denies. */
export const HARNESS_PROTECTED_PATH_RULE_ID = 'harness-protected-path';

/** Stable id surfaced when a project Bash deny pattern matches. */
export const HARNESS_BASH_DENY_RULE_ID = 'harness-bash-deny';

/** The implicit self-protection pattern — see the module header. `.nightcore/`
 *  holds the harness manifest, the task store, and future enforcement state
 *  (ratchet baselines); none of it is ever an agent's legitimate write target. */
export const MANIFEST_PROTECTED_PATTERN = '.nightcore/**';

/** One compiled protected-path rule: the original pattern (for the deny reason)
 *  plus its segment matchers (`'**'` sentinel | a per-segment regex). */
interface CompiledPathRule {
  pattern: string;
  segments: (RegExp | '**')[];
  /** True for a pattern without `/` — matched at any depth (gitignore-style). */
  floating: boolean;
}

/** One compiled Bash deny rule: the original pattern text + its regex. */
interface CompiledBashRule {
  pattern: string;
  regex: RegExp;
}

/** The compiled form {@link HookBus} holds for the session's lifetime — compile
 *  once at construction, evaluate per tool call. */
export interface CompiledHarnessPolicy {
  pathRules: readonly CompiledPathRule[];
  bashRules: readonly CompiledBashRule[];
}

/** Escape regex metacharacters, then translate `*` → "any run of non-separator
 *  characters". Case-insensitive (see the module header). */
function segmentToRegex(segment: string): RegExp {
  const escaped = segment.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^${escaped.replace(/\\\*/g, '[^/\\\\]*')}$`, 'i');
}

/** Compile one protected-path pattern, or undefined for an unusable (empty)
 *  one. Leading `./`/`/` and a trailing `/` are tolerated author sugar. */
function compilePathRule(raw: string): CompiledPathRule | undefined {
  const trimmed = raw.trim().replace(/^\.?\//, '').replace(/\/+$/, '');
  if (trimmed.length === 0) return undefined;
  const parts = trimmed.split('/').filter((p) => p.length > 0);
  if (parts.length === 0) return undefined;
  return {
    pattern: raw,
    segments: parts.map((p) => (p === '**' ? '**' : segmentToRegex(p))),
    floating: !trimmed.includes('/'),
  };
}

/**
 * Compile the wire policy into per-session matchers. Invalid entries are
 * warn-and-skipped (one typo must never brick the layer — the valid rules still
 * enforce). The implicit self-protection pattern is ALWAYS prepended: an armed
 * policy layer protects its own manifest before anything else.
 */
export function compileHarnessPolicy(
  policy: HarnessPolicy,
  logger?: Logger,
): CompiledHarnessPolicy {
  const pathRules: CompiledPathRule[] = [];
  for (const pattern of [MANIFEST_PROTECTED_PATTERN, ...policy.protectedPaths]) {
    const rule = compilePathRule(pattern);
    if (rule === undefined) {
      logger?.warn('skipping empty harness protectedPaths pattern');
      continue;
    }
    pathRules.push(rule);
  }

  const bashRules: CompiledBashRule[] = [];
  for (const pattern of policy.denyBashPatterns) {
    try {
      bashRules.push({ pattern, regex: new RegExp(pattern) });
    } catch (error) {
      logger?.warn('skipping invalid harness denyBashPatterns regex', {
        pattern,
        error,
      });
    }
  }

  return { pathRules, bashRules };
}

/** True when `rule` matches a prefix of `segments` starting at `from` — a full
 *  match protects the file, a prefix match protects the subtree beneath it. */
function matchesFrom(
  rule: CompiledPathRule,
  segments: readonly string[],
  from: number,
): boolean {
  const walk = (pi: number, si: number): boolean => {
    // Pattern exhausted ⇒ the consumed prefix matched (file itself or subtree).
    if (pi === rule.segments.length) return true;
    const part = rule.segments[pi]!;
    if (part === '**') {
      // `**` matches zero or more whole segments.
      for (let k = si; k <= segments.length; k += 1) {
        if (walk(pi + 1, k)) return true;
      }
      return false;
    }
    if (si >= segments.length) return false;
    return part.test(segments[si]!) && walk(pi + 1, si + 1);
  };
  return walk(0, from);
}

/** True when `rule` protects the cwd-relative path split into `segments`. An
 *  anchored rule matches from the root only; a floating rule from any depth. */
function ruleProtects(rule: CompiledPathRule, segments: readonly string[]): boolean {
  if (!rule.floating) return matchesFrom(rule, segments, 0);
  for (let i = 0; i < segments.length; i += 1) {
    if (matchesFrom(rule, segments, i)) return true;
  }
  return false;
}

/** The deny reason for a protected-path match — names the target AND the pattern
 *  so the model understands the rail rather than retrying variants, and points it
 *  at the honest escalation path (report to the user). */
function protectedPathReason(target: string, pattern: string): string {
  return (
    `Blocked by this project's harness policy: ${target} matches the protected ` +
    `pattern "${pattern}" and must not be modified in an autonomous run. Protected ` +
    `paths are enforcement config or machine-owned files (lockfiles, migrations, ` +
    `generated code, the .nightcore manifest). If the task genuinely requires ` +
    `changing this file, stop and report that to the user instead of working ` +
    `around the protection.`
  );
}

/** The deny reason for a Bash deny-pattern match. */
function bashDenyReason(pattern: string): string {
  return (
    `Blocked by this project's harness policy: this command matches the project's ` +
    `deny pattern "${pattern}". The project forbids this command form in autonomous ` +
    `runs (typically because it bypasses hooks, verification, or dependency ` +
    `integrity). Accomplish the task without it, or stop and report to the user.`
  );
}

/**
 * Evaluate a single tool call against the compiled harness policy. Returns
 * `{ denied: false }` for everything the policy doesn't cover (the common path).
 * `cwd` may be undefined (probes/tests): path rules are then skipped — a
 * repo-relative pattern is meaningless without a root — but Bash rules still
 * enforce (they match the raw command, no root needed).
 */
export function evaluateHarnessPolicy(
  toolName: string,
  toolInput: unknown,
  policy: CompiledHarnessPolicy,
  cwd: string | undefined,
): ToolDenyVerdict {
  const key = FILE_MUTATION_TARGET_KEY[toolName];
  if (key !== undefined) {
    if (cwd === undefined || cwd.length === 0 || policy.pathRules.length === 0) {
      return { denied: false };
    }
    const target = targetUnderKey(toolInput, key);
    // Unreadable target: workspace confinement (which runs FIRST) fail-closes
    // this exact shape, so leaving it alone here never allows it in a session.
    if (target === undefined) return { denied: false };
    const resolvedCwd = path.resolve(cwd);
    const resolved = resolveAgainst(cwd, target);
    // Outside the run cwd ⇒ confinement's jurisdiction, not a repo-relative path.
    if (!isWithin(resolved, resolvedCwd)) return { denied: false };
    const rel = path.relative(resolvedCwd, resolved);
    if (rel.length === 0) return { denied: false };
    const segments = rel.split(/[\\/]/).filter((s) => s.length > 0);
    for (const rule of policy.pathRules) {
      if (ruleProtects(rule, segments)) {
        return {
          denied: true,
          ruleId: HARNESS_PROTECTED_PATH_RULE_ID,
          reason: protectedPathReason(resolved, rule.pattern),
        };
      }
    }
    return { denied: false };
  }

  if (toolName === BASH_TOOL && policy.bashRules.length > 0) {
    const command = targetUnderKey(toolInput, 'command');
    if (command === undefined) return { denied: false };
    for (const rule of policy.bashRules) {
      if (rule.regex.test(command)) {
        return {
          denied: true,
          ruleId: HARNESS_BASH_DENY_RULE_ID,
          reason: bashDenyReason(rule.pattern),
        };
      }
    }
  }

  return { denied: false };
}
