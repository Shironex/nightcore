/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import {
  type AutonomyLevel,
  type Config,
  ConfigSchema,
  type HarnessPolicy,
  type PermissionMode,
  type ProviderCapabilities,
} from '@nightcore/contracts';

import {
  assertGovernanceInvariant,
  assertHooksInvariant,
  AutonomyNotPermittedError,
  GovernanceNotSupportedError,
  harnessPolicyHasRules,
} from './agent-provider.js';
import {
  CLAUDE_CAPABILITIES,
  permissionModeToAutonomy,
} from './claude/capabilities.js';
import { ClaudeAgentProvider } from './claude/claude-agent-provider.js';
import { CODEX_CAPABILITIES } from './codex/capabilities.js';

/** A fake provider descriptor with the ONLY difference that matters to the gate:
 *  it cannot enforce PreToolUse hooks (no workspace confinement / deny-ask tiers). */
const DEGRADED: ProviderCapabilities = {
  ...CLAUDE_CAPABILITIES,
  id: 'fake',
  label: 'Fake',
  supportsHooks: false,
};

/** A fake provider that cannot enforce Harness governance policy — otherwise
 *  identical to Claude (mirrors `CODEX_CAPABILITIES`'s shape without hardcoding
 *  the real Codex descriptor into this gate battery). */
const UNGOVERNED: ProviderCapabilities = {
  ...CLAUDE_CAPABILITIES,
  id: 'fake-ungoverned',
  label: 'FakeUngoverned',
  supportsHarnessPolicy: false,
  supportsLedger: false,
};

/** A PRESENT-BUT-EMPTY Harness policy — mirrors what the Rust `read_policy`
 *  resolver arms when `.nightcore/harness.json` exists (e.g. only armed
 *  Structure-Lock gauntlet checks) but declares no `policy` rules of its own. The
 *  engine still arms this for its IMPLICIT `.nightcore/**` self-protection, but it
 *  must NOT trip the governance refusal (#296's fix — see `harnessPolicyHasRules`). */
const EMPTY_POLICY: HarnessPolicy = {
  protectedPaths: [],
  denyBashPatterns: [],
  denyReadPaths: [],
  disallowedTools: [],
  allowTools: [],
  askTools: [],
  allowExecSinks: [],
};

/** An ARMED Harness policy — present AND carrying an actual rule, matching the
 *  spike's Option C scoping (`docs/research/2026-07-12-codex-governance-feasibility.md`). */
const ARMED_POLICY: HarnessPolicy = {
  ...EMPTY_POLICY,
  protectedPaths: ['bun.lock'],
};

// ---------------------------------------------------------------------------
// The fail-closed hooks invariant (the security crux, issue #18)
// ---------------------------------------------------------------------------

describe('assertHooksInvariant', () => {
  test('REFUSES elevated autonomy when hooks are unsupported and unsandboxed', () => {
    for (const autonomy of ['bypass', 'auto-accept'] as const) {
      expect(() =>
        assertHooksInvariant(DEGRADED, autonomy, { osSandboxed: false }),
      ).toThrow(AutonomyNotPermittedError);
    }
  });

  test('permits elevated autonomy when the OS sandbox compensates', () => {
    for (const autonomy of ['auto-accept'] as const) {
      expect(() =>
        assertHooksInvariant(DEGRADED, autonomy, { osSandboxed: true }),
      ).not.toThrow();
    }
  });

  test('bypass remains refused without explicit uncontained opt-in', () => {
    expect(() =>
      assertHooksInvariant(DEGRADED, 'bypass', { osSandboxed: false }),
    ).toThrow(AutonomyNotPermittedError);
    expect(() =>
      assertHooksInvariant(DEGRADED, 'bypass', {
        osSandboxed: false,
        uncontainedBypassOptIn: true,
      }),
    ).not.toThrow();
  });

  test('never refuses non-elevated autonomy, even without hooks or a sandbox', () => {
    for (const autonomy of ['ask', 'plan'] as const) {
      expect(() =>
        assertHooksInvariant(DEGRADED, autonomy, { osSandboxed: false }),
      ).not.toThrow();
    }
  });

  test('a hooks-capable provider is never refused, at any autonomy', () => {
    const levels: AutonomyLevel[] = ['bypass', 'auto-accept', 'ask', 'plan'];
    for (const autonomy of levels) {
      expect(() =>
        assertHooksInvariant(CLAUDE_CAPABILITIES, autonomy, {
          osSandboxed: false,
        }),
      ).not.toThrow();
    }
  });

  test('the refusal names the offending provider and autonomy', () => {
    let caught: unknown;
    try {
      assertHooksInvariant(DEGRADED, 'bypass', { osSandboxed: false });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AutonomyNotPermittedError);
    const err = caught as AutonomyNotPermittedError;
    expect(err.providerId).toBe('fake');
    expect(err.autonomy).toBe('bypass');
    expect(err.message).toContain('hooks');
  });
});

// ---------------------------------------------------------------------------
// The fail-closed governance invariant (issue #296)
// ---------------------------------------------------------------------------

describe('assertGovernanceInvariant', () => {
  test('REFUSES a run with an ARMED (non-empty) Harness policy on an ungoverned provider', () => {
    expect(() =>
      assertGovernanceInvariant(UNGOVERNED, { harnessPolicy: ARMED_POLICY }),
    ).toThrow(GovernanceNotSupportedError);
  });

  test('permits a PRESENT-BUT-EMPTY policy — a self-protection-only manifest never refuses', () => {
    // `read_policy` (Rust) arms `Some(empty policy)` when `.nightcore/harness.json`
    // exists for another reason (e.g. armed gauntlet checks) with no `policy` block
    // of its own. That's not a rule set worth refusing Codex over.
    expect(() =>
      assertGovernanceInvariant(UNGOVERNED, { harnessPolicy: EMPTY_POLICY }),
    ).not.toThrow();
  });

  test('permits a run whose ledger path is set but has NO armed Harness policy — the production path (#296 regression)', () => {
    // THE bug this regression test pins: the Rust core sets `ledgerPath`
    // UNCONDITIONALLY for every project-scoped run (`build_guardrails` in
    // `sidecar/commands.rs`), never gated on an "armed" signal the way
    // `harnessPolicy` is. Simulates that real production params shape — a Codex
    // run in a project with no Harness policy armed — which MUST proceed;
    // refusing here silently disables Codex for all real (project-scoped) use.
    expect(() =>
      assertGovernanceInvariant(UNGOVERNED, {
        ledgerPath: '/proj/.nightcore/ledger/task-1.ndjson',
      }),
    ).not.toThrow();
  });

  test('permits a run with NO policy or ledger at all, even on an ungoverned provider', () => {
    expect(() => assertGovernanceInvariant(UNGOVERNED, {})).not.toThrow();
  });

  test('a governance-capable provider is never refused, even with an armed policy', () => {
    expect(() =>
      assertGovernanceInvariant(CLAUDE_CAPABILITIES, { harnessPolicy: ARMED_POLICY }),
    ).not.toThrow();
  });

  test('is driven by the capability descriptor, not the provider id', () => {
    // A provider named "codex" that DID advertise support is never refused; a
    // provider named anything else that does NOT advertise support IS refused —
    // proving the gate reads `capabilities.supportsHarnessPolicy`, never `id`.
    const governedCodex: ProviderCapabilities = {
      ...UNGOVERNED,
      id: 'codex',
      supportsHarnessPolicy: true,
    };
    expect(() =>
      assertGovernanceInvariant(governedCodex, { harnessPolicy: ARMED_POLICY }),
    ).not.toThrow();

    const ungovernedOther: ProviderCapabilities = { ...UNGOVERNED, id: 'some-future-provider' };
    expect(() =>
      assertGovernanceInvariant(ungovernedOther, { harnessPolicy: ARMED_POLICY }),
    ).toThrow(GovernanceNotSupportedError);
  });

  test('the refusal names the offending provider', () => {
    let caught: unknown;
    try {
      assertGovernanceInvariant(UNGOVERNED, { harnessPolicy: ARMED_POLICY });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GovernanceNotSupportedError);
    const err = caught as GovernanceNotSupportedError;
    expect(err.providerId).toBe('fake-ungoverned');
    expect(err.message).toContain('fake-ungoverned');
    expect(err.message).toContain('Harness governance policy');
  });

  test('CODEX_CAPABILITIES honestly declares no governance support', () => {
    expect(CODEX_CAPABILITIES.supportsHarnessPolicy).toBe(false);
    expect(CODEX_CAPABILITIES.supportsLedger).toBe(false);
  });

  test('CLAUDE_CAPABILITIES declares full governance support', () => {
    expect(CLAUDE_CAPABILITIES.supportsHarnessPolicy).toBe(true);
    expect(CLAUDE_CAPABILITIES.supportsLedger).toBe(true);
  });
});

describe('harnessPolicyHasRules', () => {
  test('false for an all-empty (present-but-unarmed) policy', () => {
    expect(harnessPolicyHasRules(EMPTY_POLICY)).toBe(false);
  });

  test('true when any single field carries a rule', () => {
    const fields: Array<keyof HarnessPolicy> = [
      'protectedPaths',
      'denyBashPatterns',
      'denyReadPaths',
      'disallowedTools',
      'allowTools',
      'askTools',
      'allowExecSinks',
    ];
    for (const field of fields) {
      expect(harnessPolicyHasRules({ ...EMPTY_POLICY, [field]: ['x'] })).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// The Claude-internal PermissionMode → AutonomyLevel bridge
// ---------------------------------------------------------------------------

describe('permissionModeToAutonomy', () => {
  const cases: ReadonlyArray<readonly [PermissionMode, AutonomyLevel]> = [
    ['bypassPermissions', 'bypass'],
    ['acceptEdits', 'auto-accept'],
    ['dontAsk', 'auto-accept'],
    ['auto', 'auto-accept'],
    ['plan', 'plan'],
    ['default', 'ask'],
  ];
  test.each(cases)('maps %s → %s', (mode, autonomy) => {
    expect(permissionModeToAutonomy(mode)).toBe(autonomy);
  });

  test('the never-prompt modes land in the elevated set the gate guards', () => {
    // dontAsk/auto act without a per-tool prompt, so a no-hooks provider running
    // them unsandboxed must be refused (fail-closed).
    for (const mode of ['dontAsk', 'auto'] as const) {
      expect(() =>
        assertHooksInvariant(DEGRADED, permissionModeToAutonomy(mode), {
          osSandboxed: false,
        }),
      ).toThrow(AutonomyNotPermittedError);
    }
  });
});

// ---------------------------------------------------------------------------
// ClaudeAgentProvider (the one implementation behind the seam)
// ---------------------------------------------------------------------------

const CONFIG: Config = ConfigSchema.parse({
  paths: { home: '/tmp/nc-home', sessions: '/tmp/nc-home/sessions' },
});

describe('ClaudeAgentProvider', () => {
  const provider = new ClaudeAgentProvider(CONFIG, { apiKeyFallback: false });

  test('advertises the truthful Claude capability matrix', () => {
    const caps = provider.capabilities();
    expect(caps.id).toBe('claude');
    expect(caps.supportsHooks).toBe(true);
    expect(caps.providesOwnWriteContainment).toBe(false);
    expect(caps.supportsMcp).toBe(true);
    expect(caps.supportsPlanMode).toBe(true);
    expect(caps.supportsStructuredOutput).toBe(true);
    expect(caps.supportsSessionResume).toBe(true);
    expect(caps.supportsFileCheckpointing).toBe(true);
    expect(caps.supportsAskUserQuestion).toBe(true);
    expect(caps.supportsSettingSources).toBe(true);
    expect(caps.supportsSessionStore).toBe(true);
    expect(caps.supportsEffort).toBe(true);
    expect(caps.supportsHarnessPolicy).toBe(true);
    expect(caps.supportsLedger).toBe(true);
    expect(caps.costTelemetry).toBe('full');
    expect(caps.autonomyLevels).toEqual([
      'bypass',
      'auto-accept',
      'ask',
      'plan',
    ]);
  });

  test('preflight NEVER refuses Claude — bypass without a sandbox is fine', () => {
    expect(() =>
      provider.preflight({
        autonomy: 'bypass',
        osSandboxed: false,
      }),
    ).not.toThrow();
  });

  test('startSession proceeds with an armed Harness policy and a ledger path (#296)', () => {
    const session = provider.startSession(
      {
        sessionId: 100,
        prompt: 'hi',
        model: 'claude-opus-4-8',
        cwd: '/tmp',
        harnessPolicy: ARMED_POLICY,
        ledgerPath: '/tmp/nc-ledger.ndjson',
      },
      () => {},
    );
    expect(session).toBeDefined();
  });

  test('startSession resolves the autonomy precedence: override wins', () => {
    const session = provider.startSession(
      {
        sessionId: 1,
        prompt: 'hi',
        model: 'claude-opus-4-8',
        cwd: '/tmp',
        autonomyOverride: 'plan',
      },
      () => {},
    );
    expect(session.permissionMode).toBe('plan');
  });

  test('startSession falls back to the configured default permission mode', () => {
    const session = provider.startSession(
      { sessionId: 2, prompt: 'hi', model: 'claude-opus-4-8', cwd: '/tmp' },
      () => {},
    );
    expect(session.permissionMode).toBe(CONFIG.permissions.mode);
  });

  test('startSession applies the kind preset default when no override is given', () => {
    // `verify` (review reviewer) defaults to `dontAsk`; no command override here.
    const session = provider.startSession(
      {
        sessionId: 3,
        prompt: 'review',
        model: 'claude-opus-4-8',
        cwd: '/tmp',
        kind: 'review',
      },
      () => {},
    );
    expect(session.permissionMode).toBe('dontAsk');
  });

  test('createProbeSession yields a driveable session handle', () => {
    const probe = provider.createProbeSession();
    expect(typeof probe.listModels).toBe('function');
    expect(typeof probe.probeConfig).toBe('function');
  });
});
