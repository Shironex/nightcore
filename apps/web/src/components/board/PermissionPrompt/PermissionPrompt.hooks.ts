/** Render a tool input object as a compact one-line summary for the prompt.
 *  Prefers the most telling field (a shell `command`, a file `path`/`file_path`,
 *  or a `url`); falls back to a truncated JSON of the whole input. Pure — never
 *  logs the input (it may contain paths/commands surfaced only to the UI). */
export function summarizeInput(input: Record<string, unknown>): string {
  const PREFERRED = ['command', 'file_path', 'path', 'url', 'pattern'];
  for (const key of PREFERRED) {
    const value = input[key];
    if (typeof value === 'string' && value.trim().length > 0) {
      return truncate(value, 160);
    }
  }
  const keys = Object.keys(input);
  if (keys.length === 0) return '(no input)';
  return truncate(JSON.stringify(input), 160);
}

/** Truncate `text` to `max` chars with an ellipsis. */
export function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
