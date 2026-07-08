// @ts-check

/** Repo-relative path with forward slashes (lint-meta internal convention). */
export function toPosixRel(rel: string): string {
  return rel.replace(/\\/g, '/');
}

/** Normalize text read from disk so line-based rules match CI (LF-only). */
export function normalizeText(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}
