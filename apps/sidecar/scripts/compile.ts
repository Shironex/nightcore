#!/usr/bin/env bun
//! Triple-aware sidecar compile step for Tauri's `externalBin`.
//!
//! Tauri resolves a configured `externalBin: ["binaries/nightcore-sidecar"]` to a
//! file named `binaries/nightcore-sidecar-<target-triple>` (`.exe` on Windows), and
//! `tauri_build::build()` (run from `src-tauri/build.rs` on EVERY `cargo build`,
//! including `tauri dev`) hard-errors if that exact file is missing. So this script
//! must emit the triple-suffixed name, not a bare `nightcore-sidecar`.
//!
//! The host triple is read from `rustc -vV`'s `host:` line — the same source the
//! Tauri docs point at — so the artifact name matches whatever Tauri will look for
//! on this host. Cross-compiling to a different triple is out of scope (it would
//! need `--target` plumbed through here and a matching bun cross-compile target).

import { execFileSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const SIDECAR_ROOT = resolve(import.meta.dir, "..");
const ENTRY = join(SIDECAR_ROOT, "src/index.ts");
const OUT_DIR = resolve(SIDECAR_ROOT, "../desktop/src-tauri/binaries");

function hostTargetTriple(): string {
  const rustInfo = execFileSync("rustc", ["-vV"], { encoding: "utf8" });
  const match = /^host:\s*(\S+)$/m.exec(rustInfo);
  if (!match) {
    throw new Error(
      "could not determine host target triple from `rustc -vV` (no `host:` line)",
    );
  }
  return match[1];
}

const triple = hostTargetTriple();
const ext = triple.includes("-windows-") ? ".exe" : "";
const outfile = join(OUT_DIR, `nightcore-sidecar-${triple}${ext}`);

mkdirSync(dirname(outfile), { recursive: true });

console.log(`compiling sidecar → ${outfile}`);
execFileSync(
  "bun",
  ["build", "--compile", "--outfile", outfile, ENTRY],
  { stdio: "inherit", cwd: SIDECAR_ROOT },
);
