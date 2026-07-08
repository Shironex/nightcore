/// <reference types="bun" />
import type { IMetaCtx } from '../../types.ts';

export interface FakeFiles {
  [rel: string]: string | null;
}

export interface CreateFakeCtxOptions {
  files?: FakeFiles;
  root?: string;
}

function matchesGlob(path: string, pattern: string): boolean {
  // Minimal glob support for lint-meta tests: * for segment, ** for any.
  // Sufficient for the patterns used by package-shape, agents-doc-presence, etc.
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const re = '^' + escaped.replace(/\*\*/g, '.*').replace(/\*/g, '[^/]*') + '$';
  return new RegExp(re).test(path);
}

/**
 * In-memory fake IMetaCtx for isolated unit testing of lint-meta rules.
 * Mirrors the shape used by cli.ts but with synthetic file contents.
 */
export function createFakeCtx(opts: CreateFakeCtxOptions = {}): IMetaCtx {
  const fileMap: FakeFiles = opts.files ?? {};
  const root = opts.root ?? '/fake-repo';

  return {
    root,
    read(rel: string): string | null {
      if (rel in fileMap) {
        const v = fileMap[rel];
        return v === null ? null : v;
      }
      return null;
    },
    exists(rel: string): boolean {
      return rel in fileMap && fileMap[rel] !== null;
    },
    glob(pattern: string): string[] {
      return Object.keys(fileMap).filter((p) => matchesGlob(p, pattern));
    },
    exec() {
      return { code: 0, stdout: '', stderr: '' };
    },
  };
}
