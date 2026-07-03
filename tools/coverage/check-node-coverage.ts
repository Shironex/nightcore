/**
 * Coverage floor for the `test:node` suite (apps/sidecar + packages/* +
 * tools/codegen). Runs the suite under Bun's coverage collector, prints the
 * per-file table for per-PR visibility, then enforces a modest line/function
 * floor on real source — excluding node_modules and the built /dist/ duplicates
 * that Bun instruments when a package is imported through its compiled barrel.
 *
 * Why a script and not bunfig `coverageThreshold`: Bun 1.3.x reads that key but
 * does not fail the run on it, so the floor would be silently unenforced. The
 * floor is deliberately conservative (well under today's ~89% line / ~85%
 * function on src) — a safety net against a new module or public method shipping
 * with zero tests, not a ceiling. Tighten it over time, ratchet-style
 * (cf. apps/desktop/src-tauri/src/workflow/ratchet.rs for the Rust-side pattern).
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';

const ROOT = path.resolve(import.meta.dir, '..', '..');

// Mirrors the `test:node` path list in package.json.
const SUITE = [
  'apps/sidecar',
  'packages/config',
  'packages/contracts',
  'packages/engine',
  'packages/session-fold',
  'packages/shared',
  'packages/storage',
  'tools/codegen',
];

const FLOOR = { lines: 0.8, functions: 0.75 };

const covDir = mkdtempSync(path.join(tmpdir(), 'nc-node-cov-'));

const run = spawnSync(
  'bun',
  [
    'test',
    ...SUITE,
    '--coverage',
    '--coverage-reporter=text',
    '--coverage-reporter=lcov',
    `--coverage-dir=${covDir}`,
  ],
  { cwd: ROOT, stdio: 'inherit' },
);

// A failing/errored test run is surfaced as-is; coverage is moot until it passes.
if (run.status !== 0) {
  process.exit(run.status ?? 1);
}

const lcov = readFileSync(path.join(covDir, 'lcov.info'), 'utf8');

let linesFound = 0;
let linesHit = 0;
let fnFound = 0;
let fnHit = 0;
let include = true;

for (const raw of lcov.split('\n')) {
  if (raw.startsWith('SF:')) {
    const file = raw.slice(3);
    include = !file.includes('node_modules') && !file.includes('/dist/');
    continue;
  }
  if (!include) continue;
  if (raw.startsWith('LF:')) linesFound += Number(raw.slice(3));
  else if (raw.startsWith('LH:')) linesHit += Number(raw.slice(3));
  else if (raw.startsWith('FNF:')) fnFound += Number(raw.slice(4));
  else if (raw.startsWith('FNH:')) fnHit += Number(raw.slice(4));
}

const lines = linesFound === 0 ? 1 : linesHit / linesFound;
const functions = fnFound === 0 ? 1 : fnHit / fnFound;

const pct = (n: number) => `${(n * 100).toFixed(2)}%`;

const failures: string[] = [];
if (lines < FLOOR.lines) failures.push(`lines ${pct(lines)} < floor ${pct(FLOOR.lines)}`);
if (functions < FLOOR.functions) {
  failures.push(`functions ${pct(functions)} < floor ${pct(FLOOR.functions)}`);
}

console.log(
  `\nnode coverage (src, excl. dist): lines ${pct(lines)} (floor ${pct(FLOOR.lines)}), ` +
    `functions ${pct(functions)} (floor ${pct(FLOOR.functions)})`,
);

if (failures.length > 0) {
  console.error(`✖ node coverage floor not met: ${failures.join('; ')}`);
  process.exit(1);
}

console.log('✔ node coverage floor met');
