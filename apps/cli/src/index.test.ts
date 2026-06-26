import { describe, expect, it } from 'bun:test';
import { parseArgs } from './index';

describe('parseArgs', () => {
  it('parses a bare prompt', () => {
    const result = parseArgs(['hello']);
    expect(result.prompt).toBe('hello');
    expect(result.model).toBeUndefined();
    expect(result.help).toBe(false);
  });

  it('joins multi-word positional args', () => {
    const result = parseArgs(['do', 'something', 'cool']);
    expect(result.prompt).toBe('do something cool');
  });

  it('captures -m flag', () => {
    const result = parseArgs(['-m', 'claude-3-5-sonnet-20241022', 'fix', 'the', 'bug']);
    expect(result.model).toBe('claude-3-5-sonnet-20241022');
    expect(result.prompt).toBe('fix the bug');
  });

  it('captures --model flag', () => {
    const result = parseArgs(['--model', 'claude-opus-4-5', 'summarize']);
    expect(result.model).toBe('claude-opus-4-5');
    expect(result.prompt).toBe('summarize');
  });

  it('sets help=true for -h', () => {
    const result = parseArgs(['-h']);
    expect(result.help).toBe(true);
  });

  it('sets help=true for --help', () => {
    const result = parseArgs(['--help']);
    expect(result.help).toBe(true);
  });

  it('handles flags mixed with positionals', () => {
    const result = parseArgs(['write', '-m', 'claude-opus-4-5', 'tests']);
    expect(result.prompt).toBe('write tests');
    expect(result.model).toBe('claude-opus-4-5');
    expect(result.help).toBe(false);
  });

  it('returns empty prompt for empty argv', () => {
    const result = parseArgs([]);
    expect(result.prompt).toBe('');
    expect(result.model).toBeUndefined();
    expect(result.help).toBe(false);
  });
});
