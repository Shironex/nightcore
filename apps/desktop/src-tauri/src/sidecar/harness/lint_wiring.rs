//! The plugin-wired preflight for arming a `lint-plugin` gauntlet check (T7).
//!
//! The placebo-gate bug: applying a generated ESLint plugin FILE writes the plugin
//! but does NOT wire it into the project's `eslint.config.*` (that is a separate,
//! human-reviewed `agent-task`). So a user could apply the plugin, arm
//! `npx eslint .`, and get a GREEN check that enforces nothing — the plugin's rules
//! are never loaded. This module verifies, at arm time, that the plugin the user is
//! arming a check FOR is actually referenced by an ESLint config, and refuses the
//! arm (fail-closed) otherwise so the gate can never be a placebo.
//!
//! It is a positive-signal check keyed on the APPLIED artifact's path (`require_wired`
//! on the arm command) — so it only fires on the exact "apply-then-arm" trap it
//! guards, never on a hand-authored command with no plugin identity. Pure detection
//! (over collected config text) so it is unit-testable without a filesystem; the
//! thin collector reads the config files.

use std::path::Path;

/// ESLint flat-config filenames (the modern `eslint.config.*` family).
const ESLINT_FLAT_CONFIGS: &[&str] = &[
    "eslint.config.js",
    "eslint.config.mjs",
    "eslint.config.cjs",
    "eslint.config.ts",
    "eslint.config.mts",
    "eslint.config.cts",
];

/// Legacy `.eslintrc*` config filenames (still resolved by ESLint).
const ESLINT_LEGACY_CONFIGS: &[&str] = &[
    ".eslintrc",
    ".eslintrc.js",
    ".eslintrc.cjs",
    ".eslintrc.json",
    ".eslintrc.yml",
    ".eslintrc.yaml",
];

/// True if `basename` names an ESLint config file (flat or legacy).
fn is_eslint_config_name(basename: &str) -> bool {
    ESLINT_FLAT_CONFIGS.contains(&basename) || ESLINT_LEGACY_CONFIGS.contains(&basename)
}

/// The `(name, contents)` of every ESLint config found at the project root and one
/// level down under `packages/*` and `apps/*` (the common monorepo layouts) — a
/// bounded scan, never a full-tree walk. A config that can't be read is skipped.
fn collect_eslint_configs(project_path: &Path) -> Vec<(String, String)> {
    let mut out = Vec::new();
    let mut scan_dir = |dir: &Path| {
        for name in ESLINT_FLAT_CONFIGS.iter().chain(ESLINT_LEGACY_CONFIGS) {
            let path = dir.join(name);
            if let Ok(contents) = std::fs::read_to_string(&path) {
                out.push((name.to_string(), contents));
            }
        }
    };
    scan_dir(project_path);
    for parent in ["packages", "apps"] {
        let base = project_path.join(parent);
        let Ok(entries) = std::fs::read_dir(&base) else {
            continue;
        };
        for entry in entries.flatten() {
            let child = entry.path();
            if child.is_dir() {
                scan_dir(&child);
            }
        }
    }
    out
}

/// Generic directory / file names that are too common to be a reliable reference
/// signal — matching a config against `src` or `index` would false-positive on
/// almost any config. A needle whose last segment is one of these is dropped.
const GENERIC_SEGMENTS: &[&str] = &[
    "src", "lib", "dist", "build", "out", "app", "apps", "packages", "test", "tests", "index",
    "main", "plugin", "plugins", "rules", "config", "eslint",
];

/// Normalize a repo-relative plugin path (backslashes → `/`, trimmed) and derive the
/// substrings an ESLint config would use to reference it. Only PATH-SHAPED needles
/// are used — the full path, the path without extension, and the parent directory —
/// because a bare basename like `index.js` or a generic dir like `src` appears in
/// nearly every config and would false-positive the gate. A needle whose final
/// segment is generic ([`GENERIC_SEGMENTS`]) or shorter than 3 chars is dropped, so
/// a match means the config genuinely names this plugin's location.
fn wiring_needles(plugin_rel_path: &str) -> Vec<String> {
    let norm = plugin_rel_path.replace('\\', "/");
    let norm = norm.trim_matches('/').trim().to_string();
    let mut needles: Vec<String> = Vec::new();

    /// Append `s` if it is ≥3 chars, unique, and (unless `always`) not a generic
    /// last segment that would false-match almost any config.
    fn push(needles: &mut Vec<String>, s: &str, always: bool) {
        let s = s.trim().trim_matches('/');
        if s.len() < 3 || needles.iter().any(|n| n == s) {
            return;
        }
        if !always {
            let last = s.rsplit('/').next().unwrap_or(s);
            let last_stem = last.split('.').next().unwrap_or(last);
            if GENERIC_SEGMENTS.contains(&last) || GENERIC_SEGMENTS.contains(&last_stem) {
                return;
            }
        }
        needles.push(s.to_string());
    }

    // The full path is always specific enough to keep even if its basename is
    // generic (e.g. `tools/eslint-rules/index.js`).
    push(&mut needles, &norm, true);
    // Path without a trailing file extension (`tools/eslint-rules/index`) — also
    // always kept, so an `import '.../index'` (no `.js`) still matches.
    if let Some(dot) = norm.rfind('.') {
        if norm[dot..].find('/').is_none() {
            push(&mut needles, &norm[..dot], true);
        }
    }
    // The parent directory — a local plugin is often imported by its dir
    // (`import x from './tools/eslint-rules'`) — but only when it is NOT generic.
    if let Some(slash) = norm.rfind('/') {
        push(&mut needles, &norm[..slash], false);
    } else {
        // A depth-1 plugin file (`my-plugin.js`): its basename is the only identity.
        push(&mut needles, &norm, false);
    }
    needles
}

/// True if any collected config's text references the plugin (by any needle).
fn any_config_references(configs: &[(String, String)], needles: &[String]) -> bool {
    configs
        .iter()
        .any(|(_, text)| needles.iter().any(|n| text.contains(n)))
}

/// Pure assessment: given the ESLint configs found and the applied plugin's
/// repo-relative path, decide whether the plugin is wired. `Ok(())` when it IS (an
/// eslint config references it — or the applied artifact IS itself an eslint
/// config); `Err(reason)` when arming would be a placebo. Kept filesystem-free for
/// tests; [`assert_plugin_wired`] is the thin production wrapper.
fn assess_plugin_wiring(configs: &[(String, String)], plugin_rel_path: &str) -> Result<(), String> {
    let norm = plugin_rel_path.replace('\\', "/");
    let basename = norm.trim_matches('/').rsplit('/').next().unwrap_or("");
    // Arming from an applied ESLint CONFIG artifact: the config IS the wiring.
    if is_eslint_config_name(basename) {
        return Ok(());
    }
    if configs.is_empty() {
        return Err(format!(
            "no ESLint config (`eslint.config.*` / `.eslintrc*`) found in this project, so \
             the generated plugin at `{plugin_rel_path}` enforces nothing — arming this check \
             would be a placebo gate. Wire the plugin into an ESLint config first (the \
             \"wire the plugin\" agent task), then arm the check."
        ));
    }
    let needles = wiring_needles(plugin_rel_path);
    if any_config_references(configs, &needles) {
        return Ok(());
    }
    Err(format!(
        "the generated plugin at `{plugin_rel_path}` isn't referenced by any ESLint config yet, \
         so `npx eslint .` would run WITHOUT it — arming this check would be a placebo gate. \
         Wire the plugin into your `eslint.config.*` first, then arm the check."
    ))
}

/// Production entry point: refuse to arm a `lint-plugin` check for `plugin_rel_path`
/// unless it is actually wired into an ESLint config under `project_path`. Reads the
/// bounded config set, then delegates to [`assess_plugin_wiring`].
pub(super) fn assert_plugin_wired(
    project_path: &Path,
    plugin_rel_path: &str,
) -> Result<(), String> {
    let configs = collect_eslint_configs(project_path);
    assess_plugin_wiring(&configs, plugin_rel_path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wiring_needles_are_path_specific_not_generic() {
        let needles = wiring_needles("tools/eslint-rules/index.js");
        // Path-shaped, specific forms are kept.
        for expected in [
            "tools/eslint-rules/index.js",
            "tools/eslint-rules/index",
            "tools/eslint-rules",
        ] {
            assert!(
                needles.iter().any(|n| n == expected),
                "expected needle {expected:?} in {needles:?}"
            );
        }
        // Bare generic segments are NOT needles (they'd match almost any config).
        for generic in ["index", "index.js", "eslint-rules", "js"] {
            assert!(
                !needles.iter().any(|n| n == generic),
                "generic needle {generic:?} must be dropped: {needles:?}"
            );
        }
    }

    #[test]
    fn a_generic_parent_dir_is_not_a_needle() {
        // `src` is too common to be a reliable reference — only the full path forms
        // survive, so a plugin under `src/` matches a config that names the file, not
        // one that merely mentions `src`.
        let needles = wiring_needles("src/index.js");
        assert!(needles.iter().any(|n| n == "src/index.js"));
        assert!(
            !needles.iter().any(|n| n == "src"),
            "generic `src` dropped: {needles:?}"
        );
    }

    #[test]
    fn an_applied_eslint_config_is_inherently_wired() {
        // Arming from an applied `eslint.config.mjs` artifact needs no reference check.
        assert!(assess_plugin_wiring(&[], "eslint.config.mjs").is_ok());
        assert!(assess_plugin_wiring(&[], "apps/web/eslint.config.ts").is_ok());
    }

    #[test]
    fn no_config_at_all_is_a_placebo() {
        let err = assess_plugin_wiring(&[], "tools/eslint-rules/index.js")
            .expect_err("no config ⇒ placebo");
        assert!(err.contains("no ESLint config"), "got: {err}");
    }

    #[test]
    fn a_config_that_references_the_plugin_is_wired() {
        let configs = vec![(
            "eslint.config.mjs".to_string(),
            "import local from './tools/eslint-rules/index.js';\nexport default [local];"
                .to_string(),
        )];
        assert!(assess_plugin_wiring(&configs, "tools/eslint-rules/index.js").is_ok());
    }

    #[test]
    fn a_config_referencing_the_plugin_dir_counts_as_wired() {
        let configs = vec![(
            "eslint.config.mjs".to_string(),
            "import pkg from './tools/eslint-rules';\nexport default [pkg];".to_string(),
        )];
        assert!(assess_plugin_wiring(&configs, "tools/eslint-rules/index.js").is_ok());
    }

    #[test]
    fn a_config_that_does_not_reference_the_plugin_is_a_placebo() {
        // The repo has an ESLint config, but it never wires the new plugin in.
        let configs = vec![(
            "eslint.config.mjs".to_string(),
            "import js from '@eslint/js';\nexport default [js.configs.recommended];".to_string(),
        )];
        let err = assess_plugin_wiring(&configs, "tools/eslint-rules/index.js")
            .expect_err("unreferenced plugin ⇒ placebo");
        assert!(err.contains("isn't referenced"), "got: {err}");
    }

    #[test]
    fn collect_finds_root_and_package_configs() {
        let tmp = tempfile::TempDir::new().expect("temp dir");
        std::fs::write(tmp.path().join("eslint.config.mjs"), "export default [];").expect("root");
        let pkg = tmp.path().join("packages/web");
        std::fs::create_dir_all(&pkg).expect("mkdir pkg");
        std::fs::write(pkg.join("eslint.config.ts"), "export default [];").expect("pkg config");
        let configs = collect_eslint_configs(tmp.path());
        assert_eq!(configs.len(), 2, "root + one package config: {configs:?}");
    }

    #[test]
    fn assert_plugin_wired_reads_the_real_config() {
        let tmp = tempfile::TempDir::new().expect("temp dir");
        std::fs::write(
            tmp.path().join("eslint.config.mjs"),
            "import p from './tools/eslint-rules/index.js';\nexport default [p];",
        )
        .expect("config");
        assert!(assert_plugin_wired(tmp.path(), "tools/eslint-rules/index.js").is_ok());
        // A different, unwired plugin path is refused.
        assert!(assert_plugin_wired(tmp.path(), "other/plugin/index.js").is_err());
    }
}
