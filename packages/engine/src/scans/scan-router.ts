/**
 * The scan-orchestration collaborator: owns the five run-based analysis managers
 * (Insight / Harness / Scorecard / PR-review / Issue-triage) and routes their
 * `runId`-keyed `start-*` / `cancel-*` command families to the right manager. Split
 * out of {@link SessionManager} so the session supervisor owns interactive session
 * lifecycle only — adding a scan family (or changing scan dispatch) touches this
 * router, not the supervisor.
 *
 * Every scan family is keyed by `runId` (not a session id), runs its own read-only
 * session(s) — the four batch scans fan out multiple passes; Issue-triage runs a
 * single validation pass — and emits its own `<family>-*` event stream through the
 * shared `emit` sink the constructor is handed.
 */
import type {
  Config,
  NightcoreEvent,
  SurfaceCommand,
} from '@nightcore/contracts';
import type { Logger } from '@nightcore/shared';

import type { ProviderRegistry } from '../providers/provider-factory.js';
import { HarnessManager } from './harness/manager.js';
import { AnalysisManager } from './insight/manager.js';
import { IssueTriageScanManager } from './issue-triage/manager.js';
import { PrReviewScanManager } from './pr-review/manager.js';
import { ScorecardManager } from './scorecard/manager.js';

/** The scan command families this router owns — the `runId`-keyed `start-*` /
 *  `cancel-*` pairs, distinct from the session-id-keyed session commands. This is
 *  the SINGLE source of truth: the {@link ScanCommand} type and the
 *  {@link ScanRouter.handles} membership check both derive from it, so the two can
 *  never drift. `satisfies` pins every entry to a real `SurfaceCommand` type. */
const SCAN_COMMAND_TYPES = [
  'start-analysis',
  'cancel-analysis',
  'start-harness-scan',
  'cancel-harness-scan',
  'start-scorecard',
  'cancel-scorecard',
  'start-pr-review',
  'cancel-pr-review',
  'start-issue-validation',
  'cancel-issue-validation',
] as const satisfies readonly SurfaceCommand['type'][];

type ScanCommandType = (typeof SCAN_COMMAND_TYPES)[number];

/** The scan command families this router owns, narrowed from `SurfaceCommand` by
 *  the {@link SCAN_COMMAND_TYPES} source of truth. */
export type ScanCommand = Extract<SurfaceCommand, { type: ScanCommandType }>;

/** Runtime membership set derived from the same source of truth as the type. */
const SCAN_COMMAND_TYPE_SET: ReadonlySet<string> = new Set(SCAN_COMMAND_TYPES);

export interface ScanRouterOptions {
  config: Config;
  apiKeyFallback: boolean;
  /** The shared engine event sink — every scan manager emits through it. */
  emit: (event: NightcoreEvent) => void;
  /** Parent logger; each manager gets a named child (`analysis`, `harness`, …). */
  logger?: Logger;
  /** Provider registry so scans can use the selected provider (claude or codex) instead of hardcoding the Claude runner. */
  providers: ProviderRegistry;
}

export class ScanRouter {
  private readonly analysis: AnalysisManager;
  private readonly harness: HarnessManager;
  private readonly scorecard: ScorecardManager;
  private readonly prReview: PrReviewScanManager;
  private readonly issueTriage: IssueTriageScanManager;

  constructor(options: ScanRouterOptions) {
    const { config, apiKeyFallback, emit, logger, providers } = options;
    const baseDeps = {
      config,
      apiKeyFallback,
      emit,
      providers,
    };
    this.analysis = new AnalysisManager({
      ...baseDeps,
      ...(logger !== undefined ? { logger: logger.child('analysis') } : {}),
    });
    this.harness = new HarnessManager({
      ...baseDeps,
      ...(logger !== undefined ? { logger: logger.child('harness') } : {}),
    });
    this.scorecard = new ScorecardManager({
      ...baseDeps,
      ...(logger !== undefined ? { logger: logger.child('scorecard') } : {}),
    });
    this.prReview = new PrReviewScanManager({
      ...baseDeps,
      ...(logger !== undefined ? { logger: logger.child('pr-review') } : {}),
    });
    this.issueTriage = new IssueTriageScanManager({
      ...baseDeps,
      ...(logger !== undefined ? { logger: logger.child('issue-triage') } : {}),
    });
  }

  /** Whether `command` belongs to a scan family this router owns. Narrows the type
   *  so the supervisor can delegate then return without a redundant re-check.
   *  Membership comes from the {@link SCAN_COMMAND_TYPES} source of truth the
   *  {@link ScanCommand} type is also derived from. */
  handles(command: SurfaceCommand): command is ScanCommand {
    return SCAN_COMMAND_TYPE_SET.has(command.type);
  }

  /**
   * Route a scan command to its dedicated manager. Precondition: `handles(command)`
   * — the exhaustive switch mirrors the family list so the two can never drift.
   *
   * Insight analysis, Harness convention scans, the Readiness Scorecard, PR Review,
   * and Issue-triage validation are each keyed by `runId` (not a session id): the
   * owning manager runs its own read-only session(s) and emits its `<family>-*` event
   * family (the first four fan out multiple passes; Issue-triage runs a single pass).
   */
  dispatch(command: ScanCommand): void {
    switch (command.type) {
      case 'start-analysis':
        this.analysis.start(command);
        return;
      case 'cancel-analysis':
        this.analysis.cancel(command.runId);
        return;
      case 'start-harness-scan':
        this.harness.start(command);
        return;
      case 'cancel-harness-scan':
        this.harness.cancel(command.runId);
        return;
      case 'start-scorecard':
        this.scorecard.start(command);
        return;
      case 'cancel-scorecard':
        this.scorecard.cancel(command.runId);
        return;
      case 'start-pr-review':
        this.prReview.start(command);
        return;
      case 'cancel-pr-review':
        this.prReview.cancel(command.runId);
        return;
      case 'start-issue-validation':
        this.issueTriage.start(command);
        return;
      case 'cancel-issue-validation':
        this.issueTriage.cancel(command.runId);
        return;
    }
  }
}
