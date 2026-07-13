/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import { tokenizeCommand } from './command-parser.js';

describe('tokenizeCommand', () => {
  test('splits on shell operators and strips quotes / env prefixes', () => {
    expect(tokenizeCommand('a && "rm" -rf b')).toEqual(['a', 'rm', '-rf', 'b']);
    expect(tokenizeCommand('FOO=bar rm -rf x')).toEqual(['rm', '-rf', 'x']);
    expect(tokenizeCommand('echo hi | grep h')).toEqual(['echo', 'hi', 'grep', 'h']);
  });

  test('surfaces command words hidden in $()/backticks', () => {
    expect(tokenizeCommand('echo $(rm -rf x)')).toEqual(['echo', 'rm', '-rf', 'x']);
    expect(tokenizeCommand('echo `rm -rf x`')).toEqual(['echo', 'rm', '-rf', 'x']);
    // Nested substitution recurses.
    expect(tokenizeCommand('echo $(echo $(rm -rf x))')).toEqual([
      'echo',
      'echo',
      'rm',
      '-rf',
      'x',
    ]);
  });
});
