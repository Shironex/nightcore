/**
 * A safe default deny list for catastrophic tool calls, enforced through the
 * SDK's `PreToolUse` hook (see {@link HookBus}). The hook fires **regardless of
 * `permissionMode`** — including `bypassPermissions`, where `canUseTool` is never
 * consulted — so this is the one guardrail that bites under the studio's default
 * unattended config.
 *
 * SCOPE & LIMITS — read before extending. This is a *defense-in-depth heuristic*,
 * not a sandbox. Shell is adversarial: a determined prompt-injection can evade a
 * string matcher (base64-decode-then-exec, a `bash -c "…"` arg string, exotic
 * interpreters, renamed binaries — command substitution `$(…)`/backticks ARE now
 * parsed, so a command word wrapped in one is still checked). The goal here is to
 * stop the *obvious, irreversible or
 * exfiltrating* footguns — `rm -rf`, `sudo`, `curl | sh`, force-push, hard-reset,
 * disk wipes, and outbound data uploads (`curl -d @secret`, `… | nc host`) — that
 * account for the worst accidental blast radius, NOT to be a complete containment
 * boundary. Real containment is the workspace-trust gate + OS sandbox. Keep the
 * rule set tight and well-tested: every false positive blocks legitimate agent
 * work, so we deny only forms that are essentially never the right call inside an
 * autonomous coding run.
 *
 * Command-line parsing (quotes, operators, `$(…)`/backtick substitution) lives in
 * `./command-parser.js`. The outbound-data-transfer rule — what it covers, its
 * deliberate blind spots, and how it relates to the WebFetch/WebSearch egress
 * channel — lives in `./network-exfiltration.js`; see that module's header for the
 * full EGRESS rationale.
 */
import { basename, type CommandMatchContext, parseCommandLine } from './command-parser.js';
import { isNetworkExfiltration } from './network-exfiltration.js';

export type { CommandMatchContext } from './command-parser.js';
export { parseCommandLine, tokenizeCommand } from './command-parser.js';

/** The bash tool name the rules below inspect. */
export const BASH_TOOL = 'Bash';

/**
 * One deny rule. `matches` receives the parsed command context and returns true
 * to BLOCK. A rule is intentionally conservative — it should fire only on a
 * clearly destructive form.
 */
export interface ToolDenyRule {
  /** Stable id for logging / telemetry. */
  id: string;
  /** Human-readable reason surfaced back to the agent on denial. */
  reason: string;
  /** Tool names this rule applies to. */
  tools: readonly string[];
  /** True ⇒ block. */
  matches: (ctx: CommandMatchContext) => boolean;
}

/** The result of evaluating a tool call against the policy. */
export interface ToolDenyVerdict {
  denied: boolean;
  ruleId?: string;
  reason?: string;
}

/** Collect the flags that immediately follow an `rm` token (until a non-flag
 *  operand), lowercased and joined, so `-rf`, `-fr`, `-r -f`, and
 *  `--recursive --force` all surface their letters/words. */
function rmFlagsAfter(tokens: readonly string[], rmIndex: number): string {
  const flags: string[] = [];
  for (let i = rmIndex + 1; i < tokens.length; i += 1) {
    const t = tokens[i]!;
    if (t.startsWith('-')) flags.push(t.toLowerCase());
    else break;
  }
  return flags.join(' ');
}

/** True if an `rm` token carries BOTH a recursive and a force flag — the
 *  irreversible form. Scans every `rm` token (not just a command word) so
 *  `find … -exec rm -rf {}` and `xargs rm -rf` are caught too. */
function hasDestructiveRm(tokens: readonly string[]): boolean {
  for (let i = 0; i < tokens.length; i += 1) {
    if (basename(tokens[i]!) !== 'rm') continue;
    const flags = rmFlagsAfter(tokens, i);
    const recursive = /--recursive(\s|$)/.test(flags) || /-\w*r/.test(flags);
    const force = /--force(\s|$)/.test(flags) || /-\w*f/.test(flags);
    if (recursive && force) return true;
  }
  return false;
}

const PRIVILEGE_WORDS = new Set(['sudo', 'doas', 'su', 'pkexec']);

/** True if any simple command's COMMAND WORD (first token) is a
 *  privilege-escalation binary. */
function isPrivilegeEscalation(commands: readonly (readonly string[])[]): boolean {
  return commands.some(
    (cmd) => cmd.length > 0 && PRIVILEGE_WORDS.has(basename(cmd[0]!)),
  );
}

/** True if a single command is a `git … push …` with a plain force flag
 *  (`-f` / `--force`), excluding the safer `--force-with-lease`. */
function isForcePush(cmd: readonly string[]): boolean {
  const isGit = cmd.some((t) => basename(t) === 'git');
  if (!isGit || !cmd.includes('push')) return false;
  if (cmd.includes('--force-with-lease')) return false;
  return cmd.some((t) => t === '--force' || t === '-f');
}

/** True if a single command is a `git … reset --hard …`. */
function isHardReset(cmd: readonly string[]): boolean {
  const isGit = cmd.some((t) => basename(t) === 'git');
  return isGit && cmd.includes('reset') && cmd.includes('--hard');
}

/** True for piping a network download straight into an interpreter
 *  (`curl … | sh`, `wget … | bash`, `… | sudo bash`). Matched on the RAW line
 *  because the pipe is the signal. */
function isPipeToShell(raw: string): boolean {
  return /\b(?:curl|wget|fetch)\b[^\n|]*\|\s*(?:sudo\s+)?(?:sh|bash|zsh|ksh|dash|fish|python3?|perl|ruby|node)\b/i.test(
    raw,
  );
}

/** True for a disk-destroying command in a single simple command (`mkfs*`,
 *  `wipefs`, `dd of=/dev/…`) or a redirect into a block device on the raw line.
 *  Never a legitimate move inside a coding run. */
function isDiskDestroy(cmd: readonly string[]): boolean {
  const mkfs = cmd.some((t) => basename(t).startsWith('mkfs'));
  const wipefs = cmd.some((t) => basename(t) === 'wipefs');
  const ddToDevice =
    cmd.some((t) => basename(t) === 'dd') &&
    cmd.some((t) => /^of=\/dev\//.test(t));
  return mkfs || wipefs || ddToDevice;
}

/** Redirect into a raw block device (`> /dev/sda`), checked on the raw line so
 *  the redirect operator survives. */
function redirectsToDevice(raw: string): boolean {
  return /[>]\s*\/dev\/(?:sd|nvme|disk|vd|hd|mmcblk)/i.test(raw);
}

/**
 * The studio's safe default destructive-command deny set. Tight by design (see
 * the module header): each rule blocks a form that is essentially never the right
 * call in an autonomous coding run, and is independently unit-tested. Order
 * matters only for which `ruleId` is reported when a command matches several;
 * the more descriptive rule (e.g. pipe-to-shell over the incidental `sudo`) wins.
 */
export const DEFAULT_DESTRUCTIVE_RULES: readonly ToolDenyRule[] = [
  {
    id: 'rm-recursive-force',
    reason:
      'Blocked by Nightcore safety policy: recursive force-delete (rm -rf) is irreversible. Delete specific paths without -rf, or ask the user.',
    tools: [BASH_TOOL],
    matches: (ctx) => hasDestructiveRm(ctx.tokens),
  },
  {
    id: 'pipe-to-shell',
    reason:
      'Blocked by Nightcore safety policy: piping a network download into a shell (curl|sh) executes unreviewed remote code. Download, inspect, then run.',
    tools: [BASH_TOOL],
    matches: (ctx) => isPipeToShell(ctx.raw),
  },
  {
    id: 'network-exfiltration',
    reason:
      'Blocked by Nightcore safety policy: this looks like an outbound data transfer (uploading local data via curl/wget, a raw socket, scp/rsync, an inline interpreter network call, or git push to an inline URL/host), which could exfiltrate secrets from this machine. Fetch-only requests and pushes to a configured named remote (e.g. origin) are fine; to SEND data to an ad-hoc endpoint, ask the user.',
    tools: [BASH_TOOL],
    matches: isNetworkExfiltration,
  },
  {
    id: 'privilege-escalation',
    reason:
      'Blocked by Nightcore safety policy: privilege escalation (sudo/su/doas/pkexec) is not permitted in an autonomous run.',
    tools: [BASH_TOOL],
    matches: (ctx) => isPrivilegeEscalation(ctx.commands),
  },
  {
    id: 'git-force-push',
    reason:
      'Blocked by Nightcore safety policy: force-push rewrites remote history. Use --force-with-lease only with explicit user approval.',
    tools: [BASH_TOOL],
    matches: (ctx) => ctx.commands.some(isForcePush),
  },
  {
    id: 'git-reset-hard',
    reason:
      'Blocked by Nightcore safety policy: git reset --hard discards uncommitted work irreversibly. Use git restore/checkout for specific paths.',
    tools: [BASH_TOOL],
    matches: (ctx) => ctx.commands.some(isHardReset),
  },
  {
    id: 'disk-destroy',
    reason:
      'Blocked by Nightcore safety policy: writing to a raw block device or creating a filesystem (mkfs/dd of=/dev/…) destroys data.',
    tools: [BASH_TOOL],
    matches: (ctx) => ctx.commands.some(isDiskDestroy) || redirectsToDevice(ctx.raw),
  },
];

/**
 * Extract the bash command string from a `PreToolUse` `tool_input`, or undefined
 * when the tool carries no inspectable command. Defensive: `tool_input` is
 * `unknown` at the SDK boundary.
 */
function bashCommandOf(toolInput: unknown): string | undefined {
  if (toolInput === null || typeof toolInput !== 'object') return undefined;
  const command = (toolInput as { command?: unknown }).command;
  return typeof command === 'string' ? command : undefined;
}

/**
 * Evaluate a single tool call against the deny policy. Returns `{ denied: false }`
 * for any tool/input the rules don't cover (the common path) so the caller can
 * fall through to its normal allow. Only `Bash` calls with a string `command`
 * are inspected today.
 */
export function evaluateToolDeny(
  toolName: string,
  toolInput: unknown,
  rules: readonly ToolDenyRule[] = DEFAULT_DESTRUCTIVE_RULES,
): ToolDenyVerdict {
  if (toolName !== BASH_TOOL) return { denied: false };
  const raw = bashCommandOf(toolInput);
  if (raw === undefined || raw.trim().length === 0) return { denied: false };

  const commands = parseCommandLine(raw);
  const ctx: CommandMatchContext = { commands, tokens: commands.flat(), raw };
  for (const rule of rules) {
    if (!rule.tools.includes(toolName)) continue;
    if (rule.matches(ctx)) {
      return { denied: true, ruleId: rule.id, reason: rule.reason };
    }
  }
  return { denied: false };
}
