//! The create-time overrides ([`CreateInputs`]) and the default-stamping task
//! builder ([`build_new_task`]).
//!
//! Split out of [`super::model`] so the settings-resolution / defaults plumbing —
//! and its `SettingsStore`-backed tests — stay out of the `Task` data-model file.
//! Mirrors the existing `settings/{model,patch,store}` split. Everything here is
//! `pub(crate)`: the create path (`commands::task`, `crud::convert_one`) is the only
//! caller.

use super::model::{RunMode, Task, TaskKind};

/// The neutral autonomy string that puts a run in plan-before-code mode. The launch
/// path (`sidecar::resolve_autonomy` → `settings::parse_autonomy`) lowers it to
/// `AutonomyLevel::Plan`, which the Claude provider maps to the SDK `plan` mode.
const PLAN_MODE: &str = "plan";

/// The optional create-time overrides for a new task. Each `None` field falls
/// back to the resolved Settings default (per-project override → global → the
/// engine's `@nightcore/config` default).
#[derive(Debug, Default)]
pub(crate) struct CreateInputs {
    /// M4: the kind picked in the create dialog. `None` ⇒ the `Build` default
    /// (`TaskKind::default()`), preserving the pre-M4 create shape.
    pub(crate) kind: Option<TaskKind>,
    pub(crate) run_mode: Option<RunMode>,
    pub(crate) model: Option<String>,
    /// B5: the provider the picked model belongs to, carried alongside `model` so a
    /// created task round-trips its selection's provider. `None` ⇒ derive from the id.
    pub(crate) provider_id: Option<String>,
    pub(crate) effort: Option<String>,
    pub(crate) permission_mode: Option<String>,
    /// T6 (#147): the per-task "Plan first" toggle. `Some(true)` FORCES plan mode
    /// (any kind), `Some(false)` WAIVES the Build plan-gate default, `None` means
    /// "no per-task signal" — a non-form create path, or the form leaving the toggle
    /// at its resolved default. See [`resolve_plan_mode`].
    pub(crate) plan_first: Option<bool>,
    pub(crate) max_turns: Option<u32>,
    pub(crate) max_budget_usd: Option<f64>,
    /// Worktree branch name chosen in the branch picker (worktree mode). `None` ⇒
    /// the coordinator names it `nc/<taskId>` at submit.
    pub(crate) branch: Option<String>,
    /// Base branch chosen in the branch picker (worktree mode). `None` ⇒ the
    /// project's current branch at allocate/merge time.
    pub(crate) base_branch: Option<String>,
}

/// Build a fresh backlog task, stamping the resolved Settings defaults for any
/// field the create call left unset. Factored out of [`create_task`] so the
/// default-resolution is unit-testable without an `AppHandle`.
///
/// Resolution order per field: explicit create input → Settings (per-project
/// override → global). `model`/`effort`/`run_mode` always end up concrete (Settings
/// has a non-optional default for them). The guardrail ceilings stay `None` when
/// Settings has no value either, so the engine's `@nightcore/config` default
/// (maxTurns 200, budget uncapped) applies at launch.
pub(crate) fn build_new_task(
    settings: &crate::settings::SettingsStore,
    pid: Option<&str>,
    title: String,
    description: String,
    inputs: CreateInputs,
) -> Task {
    let run_mode = inputs
        .run_mode
        .unwrap_or_else(|| settings.default_run_mode(pid));
    let mut task = Task::new(title, description).with_run_mode(run_mode);
    // M4: stamp the picked kind (Build default when the create call omits it) so a
    // Decompose/Research/TDD selection in the dialog survives create — without this,
    // every new task fell back to `TaskKind::default()` regardless of the picker.
    task.kind = inputs.kind.unwrap_or_default();
    // Branch picker (worktree mode only): a chosen branch name / base branch survive
    // create so the coordinator allocates the worktree off the right base under the
    // chosen name. Blank entries fall back to the defaults (`nc/<taskId>` off the
    // project's current branch). Main-mode tasks never carry a worktree branch.
    if run_mode.is_worktree() {
        // A blank picker entry falls back to the default naming; so does one that
        // isn't a legal git ref (e.g. a name git would parse as an OPTION), so a
        // hostile/typo'd branch can never be stored and later spliced into a git
        // argument list. `worktree::allocate_branch`/`merge_branch` re-validate at the
        // call boundary, so this is the ingestion half of a defence-in-depth pair.
        task.branch = inputs
            .branch
            .filter(|b| !b.trim().is_empty())
            .filter(|b| crate::git::validate_ref(b).is_ok());
        task.base_branch = inputs
            .base_branch
            .filter(|b| !b.trim().is_empty())
            .filter(|b| crate::git::validate_ref(b).is_ok());
    }
    // P0: an explicit per-task model/effort wins; absent ⇒ stamp the resolved
    // Settings default (an SDK long id) so changing "Default model" in Settings
    // actually affects new runs. `permission_mode` stays lazily resolved at launch
    // (`resolve_permission_mode`), so `None` here means "inherit".
    //
    // B2 (issue #79/#80): a provider with no curated static catalog resolves to an
    // EMPTY default model (see `settings::default_model_id`). Keep the task's model
    // `None` ("inherit — the provider supplies its own default") in that case rather
    // than stamping `Some("")` onto the wire. Claude always resolves to a real long
    // id, so its path is byte-identical to before.
    task.model = inputs.model.or_else(|| {
        let resolved = settings.default_model(pid);
        (!resolved.trim().is_empty()).then_some(resolved)
    });
    // B5: carry the picker's provider stamp so a saved model round-trips its provider.
    // Only set when the create call supplied one (an explicit model pick); a model
    // inherited from Settings leaves this `None` (derive from the id at read time).
    task.provider_id = inputs.provider_id;
    task.effort = Some(
        inputs
            .effort
            .unwrap_or_else(|| settings.default_effort(pid)),
    );
    // T6 (#147): the plan-approval gate. A `Build` task with no per-task override
    // defaults to `plan` mode (agent plans → parks at `waiting_approval` before it
    // writes code) when the studio-wide `plan_gate_default` is on; the per-task
    // "Plan first" toggle forces or waives it. `None` ⇒ inherit the resolved Settings
    // autonomy at launch, exactly as before this feature. `plan_gate_default` is a
    // global-only stance, so it isn't project-scoped.
    task.permission_mode = resolve_plan_mode(
        task.kind,
        inputs.permission_mode,
        inputs.plan_first,
        settings.plan_gate_default(),
    );
    // SDK-guardrails: an explicit per-task ceiling wins; absent ⇒ stamp the
    // resolved Settings default (per-project override → global), so the Settings
    // "Limits" knob is authoritative for a new task. When Settings has no ceiling
    // either, this stays `None` and the engine's `@nightcore/config` default
    // applies at launch — same resolution shape as `model`/`effort`/`run_mode`.
    task.max_turns = inputs.max_turns.or_else(|| settings.default_max_turns(pid));
    task.max_budget_usd = inputs
        .max_budget_usd
        .or_else(|| settings.default_max_budget_usd(pid));
    task
}

/// Resolve a new task's `permission_mode` under the plan-approval gate (T6, #147).
///
/// The plan gate runs a task in `plan` mode — the agent produces a reviewable plan
/// and parks at `waiting_approval` before writing any code. Precedence:
///
///  - `plan_first == Some(true)` — the per-task "Plan first" toggle FORCES the gate:
///    always `plan`, so ANY kind can be made to plan first.
///  - `plan_first == Some(false)` — the toggle WAIVES the Build default: fall back to
///    the explicit picker value (an explicit `plan` pick is still honoured, but the
///    kind default no longer applies), so a trivial Build task can skip the plan.
///  - `plan_first == None` — no per-task signal (non-form create paths like
///    convert/decompose, or the form leaving the toggle at its resolved default): an
///    explicit picker value wins; otherwise a `Build` task defaults to `plan` iff the
///    studio-wide `plan_gate_default` is on. Non-Build kinds keep their existing
///    default (`None` ⇒ inherit) — this is "default-on for **Build**".
///
/// `None` means "inherit the resolved Settings autonomy at launch" — the unchanged
/// pre-T6 behaviour. Pure (no `SettingsStore`), so the resolution is unit-testable.
fn resolve_plan_mode(
    kind: TaskKind,
    explicit: Option<String>,
    plan_first: Option<bool>,
    plan_gate_default: bool,
) -> Option<String> {
    match plan_first {
        Some(true) => Some(PLAN_MODE.to_string()),
        Some(false) => explicit,
        None => explicit.or_else(|| {
            (kind == TaskKind::Build && plan_gate_default).then(|| PLAN_MODE.to_string())
        }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn build_new_task_inherits_guardrails_from_settings_when_unset() {
        use crate::settings::SettingsStore;
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let settings = SettingsStore::load_from(tmp.path().join("config"));
        // A global Settings ceiling is set; the project has its own tighter override.
        settings
            .update_for_test(
                serde_json::from_str(r#"{"maxTurns":150,"maxBudgetUsd":9.0}"#).unwrap(),
            )
            .expect("global ceiling");
        settings
            .update_for_test(serde_json::from_str(r#"{"projectId":"p1","maxTurns":50}"#).unwrap())
            .expect("project override");

        // No explicit per-task ceilings → stamp the resolved Settings defaults.
        let task = build_new_task(
            &settings,
            Some("p1"),
            "t".into(),
            String::new(),
            CreateInputs::default(),
        );
        assert_eq!(
            task.max_turns,
            Some(50),
            "per-project override wins for max_turns"
        );
        assert_eq!(
            task.max_budget_usd,
            Some(9.0),
            "max_budget_usd has no project override → global"
        );

        // Another project with no override falls back to the global ceiling.
        let other = build_new_task(
            &settings,
            Some("other"),
            "t".into(),
            String::new(),
            CreateInputs::default(),
        );
        assert_eq!(other.max_turns, Some(150));
        assert_eq!(other.max_budget_usd, Some(9.0));
    }

    #[test]
    fn build_new_task_explicit_ceilings_win_over_settings() {
        use crate::settings::SettingsStore;
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let settings = SettingsStore::load_from(tmp.path().join("config"));
        settings
            .update_for_test(
                serde_json::from_str(r#"{"maxTurns":150,"maxBudgetUsd":9.0}"#).unwrap(),
            )
            .expect("global ceiling");

        // An explicit per-task value always overrides the Settings default.
        let task = build_new_task(
            &settings,
            None,
            "t".into(),
            String::new(),
            CreateInputs {
                max_turns: Some(7),
                max_budget_usd: Some(0.5),
                ..Default::default()
            },
        );
        assert_eq!(task.max_turns, Some(7));
        assert_eq!(task.max_budget_usd, Some(0.5));
    }

    #[test]
    fn build_new_task_stamps_the_picked_kind() {
        use crate::settings::SettingsStore;
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let settings = SettingsStore::load_from(tmp.path().join("config"));

        // An explicit kind from the create dialog survives — this is the bug the
        // create path had: `kind` was never threaded, so every new task became Build.
        let task = build_new_task(
            &settings,
            None,
            "t".into(),
            String::new(),
            CreateInputs {
                kind: Some(TaskKind::Decompose),
                ..Default::default()
            },
        );
        assert_eq!(task.kind, TaskKind::Decompose, "the picked kind is stamped");

        // Omitted kind falls back to the Build default (pre-M4 create shape).
        let defaulted = build_new_task(
            &settings,
            None,
            "t".into(),
            String::new(),
            CreateInputs::default(),
        );
        assert_eq!(
            defaulted.kind,
            TaskKind::Build,
            "an omitted kind defaults to Build"
        );
    }

    #[test]
    fn build_new_task_drops_an_invalid_picker_branch_at_ingestion() {
        use crate::settings::SettingsStore;
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let settings = SettingsStore::load_from(tmp.path().join("config"));

        // A picker value git would parse as an OPTION (or is otherwise not a legal
        // ref) is never stored — it falls back to the default naming, so a hostile /
        // typo'd branch can't be persisted and later spliced into a git call.
        let hostile = build_new_task(
            &settings,
            None,
            "t".into(),
            String::new(),
            CreateInputs {
                run_mode: Some(RunMode::Worktree),
                branch: Some("-D".into()),
                base_branch: Some("a b".into()),
                ..Default::default()
            },
        );
        assert!(hostile.branch.is_none(), "an option-like branch is dropped");
        assert!(hostile.base_branch.is_none(), "a malformed base is dropped");

        // A legal picker branch/base survives ingestion unchanged.
        let ok = build_new_task(
            &settings,
            None,
            "t".into(),
            String::new(),
            CreateInputs {
                run_mode: Some(RunMode::Worktree),
                branch: Some("feature/foo".into()),
                base_branch: Some("main".into()),
                ..Default::default()
            },
        );
        assert_eq!(ok.branch.as_deref(), Some("feature/foo"));
        assert_eq!(ok.base_branch.as_deref(), Some("main"));
    }

    #[test]
    fn build_new_task_leaves_guardrails_none_when_settings_unset() {
        use crate::settings::SettingsStore;
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let settings = SettingsStore::load_from(tmp.path().join("config"));
        // No Settings ceiling and no explicit input → None, so the engine's config
        // default (maxTurns 200, budget uncapped) applies at launch.
        let task = build_new_task(
            &settings,
            None,
            "t".into(),
            String::new(),
            CreateInputs::default(),
        );
        assert!(task.max_turns.is_none());
        assert!(task.max_budget_usd.is_none());
        // The P0 model/effort defaults are still stamped concretely.
        assert_eq!(task.model.as_deref(), Some("claude-opus-4-8"));
        assert_eq!(task.effort.as_deref(), Some("medium"));
    }

    #[test]
    fn build_new_task_leaves_model_none_when_default_model_is_empty() {
        use crate::settings::SettingsStore;
        // Legacy/hand-edited settings can still carry an empty default model. A new
        // task must keep `model: None` ("inherit") rather than stamping `Some("")`
        // onto the wire.
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let settings = SettingsStore::load_from(tmp.path().join("config"));
        settings
            .update_for_test(serde_json::from_str(r#"{"defaultModel":""}"#).unwrap())
            .expect("empty default model");
        let task = build_new_task(
            &settings,
            None,
            "t".into(),
            String::new(),
            CreateInputs::default(),
        );
        assert!(
            task.model.is_none(),
            "an empty resolved default must leave the task model None, not Some(\"\")"
        );
    }

    // ── Plan-approval gate (T6, #147) ──────────────────────────────────────────

    #[test]
    fn resolve_plan_mode_defaults_build_to_plan_only_when_gate_on() {
        // Default-on: a Build task with no per-task signal plans first iff the gate is on.
        assert_eq!(
            resolve_plan_mode(TaskKind::Build, None, None, true).as_deref(),
            Some("plan"),
            "Build + gate on + no override ⇒ plan"
        );
        assert_eq!(
            resolve_plan_mode(TaskKind::Build, None, None, false),
            None,
            "Build + gate OFF ⇒ inherit (no plan)"
        );
    }

    #[test]
    fn resolve_plan_mode_only_defaults_build_not_other_kinds() {
        // The default is "default-on for Build" — Research/TDD/Decompose are untouched
        // even with the gate on and no per-task signal.
        for kind in [TaskKind::Research, TaskKind::Tdd, TaskKind::Decompose] {
            assert_eq!(
                resolve_plan_mode(kind, None, None, true),
                None,
                "{kind:?} keeps its default (inherit) even with the gate on"
            );
        }
    }

    #[test]
    fn resolve_plan_mode_per_task_toggle_forces_or_waives() {
        // Toggle ON forces a plan on ANY kind, regardless of the gate default…
        assert_eq!(
            resolve_plan_mode(TaskKind::Research, None, Some(true), false).as_deref(),
            Some("plan"),
            "Plan-first ON forces plan even for a non-Build kind with the gate off"
        );
        // …and OFF waives the Build default (a trivial Build task runs straight through).
        assert_eq!(
            resolve_plan_mode(TaskKind::Build, None, Some(false), true),
            None,
            "Plan-first OFF waives the Build default ⇒ inherit"
        );
    }

    #[test]
    fn resolve_plan_mode_explicit_pick_wins_over_default() {
        // An explicit picker value (e.g. bypass) is honoured over the Build gate default.
        assert_eq!(
            resolve_plan_mode(TaskKind::Build, Some("bypass".into()), None, true).as_deref(),
            Some("bypass"),
            "an explicit permission-mode pick wins over the Build gate default"
        );
        // Waiving the toggle still honours an explicit plan pick (no contradiction).
        assert_eq!(
            resolve_plan_mode(TaskKind::Build, Some("plan".into()), Some(false), true).as_deref(),
            Some("plan"),
            "an explicit plan pick survives a waived toggle"
        );
    }

    #[test]
    fn build_new_task_default_on_plan_gate_for_build() {
        use crate::settings::SettingsStore;
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let settings = SettingsStore::load_from(tmp.path().join("config"));
        // Fresh settings ship with the gate ON. A Build task with no override plans first.
        let build = build_new_task(
            &settings,
            None,
            "t".into(),
            String::new(),
            CreateInputs {
                kind: Some(TaskKind::Build),
                ..Default::default()
            },
        );
        assert_eq!(
            build.permission_mode.as_deref(),
            Some("plan"),
            "a Build task defaults to plan mode when the gate is on"
        );

        // A non-Build kind is unaffected by the default (inherits).
        let research = build_new_task(
            &settings,
            None,
            "t".into(),
            String::new(),
            CreateInputs {
                kind: Some(TaskKind::Research),
                ..Default::default()
            },
        );
        assert!(
            research.permission_mode.is_none(),
            "a Research task is not plan-gated by the Build default"
        );
    }

    #[test]
    fn build_new_task_plan_gate_off_leaves_build_uninherited() {
        use crate::settings::SettingsStore;
        let tmp = tempfile::TempDir::new().expect("temp dir");
        let settings = SettingsStore::load_from(tmp.path().join("config"));
        settings
            .update_for_test(serde_json::from_str(r#"{"planGateDefault":false}"#).unwrap())
            .expect("disable the gate");
        let build = build_new_task(
            &settings,
            None,
            "t".into(),
            String::new(),
            CreateInputs {
                kind: Some(TaskKind::Build),
                ..Default::default()
            },
        );
        assert!(
            build.permission_mode.is_none(),
            "with the gate off, a Build task inherits (no plan) unless per-task forced"
        );

        // …but a per-task toggle can still force the plan with the gate off.
        let forced = build_new_task(
            &settings,
            None,
            "t".into(),
            String::new(),
            CreateInputs {
                kind: Some(TaskKind::Build),
                plan_first: Some(true),
                ..Default::default()
            },
        );
        assert_eq!(
            forced.permission_mode.as_deref(),
            Some("plan"),
            "the per-task toggle forces a plan even with the gate off"
        );
    }
}
