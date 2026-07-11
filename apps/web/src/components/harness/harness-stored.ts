/**
 * The persisted → view-model mappers for Harness: they project the on-disk `Stored*`
 * (ts-rs, string-typed) shapes into the union-typed view models the UI renders. Split
 * out of `harness-stream.ts` (which keeps the live wire mappers + the fold) so that
 * file stays under the web-file-size ratchet.
 *
 * The engine guarantees valid enum values on write, so a well-formed store round-trips
 * unchanged. Each string→union narrowing routes through a `safeParse` guard (see
 * `@/lib/scan-run/narrow`) with a documented, least-alarming fallback, so a corrupted
 * store or future enum drift degrades gracefully instead of leaking an invalid union
 * value into the UI. These VMs only feed the DISPLAY — `apply`/convert read the
 * authoritative stored value server-side.
 */
import {
  ArtifactKindSchema,
  ArtifactWriteModeSchema,
  ConventionCategorySchema,
  ConventionKindSchema,
  FindingSeveritySchema,
  HarnessProposalKindSchema,
  RepoPackageRoleSchema,
  WorkspaceToolSchema,
} from '@nightcore/contracts';
import type {
  StoredConventionFinding,
  StoredHarnessProposal,
  StoredProposedArtifact,
  StoredRepoProfile,
} from '@/lib/bridge';
import { enumGuard, narrowOr } from '@/lib/scan-run';

import type {
  ConventionFindingVM,
  HarnessProposalVM,
  ProposedArtifactVM,
  RepoProfileVM,
} from './harness.types';

/** Membership guards for the web-local lifecycle unions (no contract schema),
 *  mirroring `harness.types.ts` exactly. */
const FINDING_STATUS = enumGuard(['open', 'dismissed', 'converted'] as const);
const ARTIFACT_STATUS = enumGuard(['proposed', 'applied', 'dismissed'] as const);
const PROPOSAL_STATUS = enumGuard([
  'proposed',
  'dismissed',
  'converted',
  'applied',
] as const);

/** Map a persisted `StoredConventionFinding` (string-typed) into the view shape,
 *  narrowing the unified wire strings to their unions; a corrupt value degrades to a
 *  documented fallback rather than leaking into the UI. */
export function storedToConventionFinding(
  f: StoredConventionFinding,
): ConventionFindingVM {
  return {
    id: f.id,
    // Fallback `architecture`: the general/first lens for an unrecognized category.
    category: narrowOr(ConventionCategorySchema, f.category, 'architecture'),
    // Fallback `convention`: an observed rule (not the deficit-implying `gap`).
    kind: narrowOr(ConventionKindSchema, f.kind, 'convention'),
    // Fallback `info`: the lowest severity — never over-escalate a bad value.
    severity: narrowOr(FindingSeveritySchema, f.severity, 'info'),
    title: f.title,
    description: f.description,
    rationale: f.rationale,
    evidence: f.evidence,
    suggestion: f.suggestion,
    tags: f.tags,
    confidence: f.confidence,
    fingerprint: f.fingerprint,
    // Fallback `open`: the neutral active lifecycle state.
    status: narrowOr(FINDING_STATUS, f.status, 'open'),
    linkedTaskId: f.linkedTaskId,
  };
}

/** Map a persisted `StoredProposedArtifact` (string-typed) into the view shape,
 *  narrowing the wire strings to their unions and carrying the applied lifecycle. */
export function storedToArtifact(a: StoredProposedArtifact): ProposedArtifactVM {
  return {
    id: a.id,
    // Fallback `tool-config`: the generic standalone-config kind for an
    // unrecognized value.
    kind: narrowOr(ArtifactKindSchema, a.kind, 'tool-config'),
    group: a.group,
    groupTitle: a.groupTitle,
    title: a.title,
    description: a.description,
    rationale: a.rationale,
    targetPath: a.targetPath,
    // Fallback `create`: the non-clobbering write mode (fails if the file exists).
    writeMode: narrowOr(ArtifactWriteModeSchema, a.writeMode, 'create'),
    content: a.content,
    language: a.language,
    sourceFindings: a.sourceFindings,
    dependsOn: a.dependsOn,
    confidence: a.confidence,
    fingerprint: a.fingerprint,
    // Fallback `proposed`: the neutral pre-action lifecycle state.
    status: narrowOr(ARTIFACT_STATUS, a.status, 'proposed'),
    appliedPath: a.appliedPath,
    appliedAt: a.appliedAt,
  };
}

/** Map a persisted `StoredHarnessProposal` (string-typed) into the view shape,
 *  narrowing the wire strings to their unions and carrying the convert lifecycle. */
export function storedToProposal(p: StoredHarnessProposal): HarnessProposalVM {
  return {
    id: p.id,
    // Fallback `agent-task`: the "propose a Build task" path (doesn't imply an
    // artifact bundle to write) for an unrecognized kind.
    kind: narrowOr(HarnessProposalKindSchema, p.kind, 'agent-task'),
    title: p.title,
    description: p.description,
    rationale: p.rationale,
    artifactIds: p.artifactIds,
    prompt: p.prompt,
    verifyCommand: p.verifyCommand,
    harnessCheck: p.harnessCheck,
    confidence: p.confidence,
    fingerprint: p.fingerprint,
    // Fallback `proposed`: the neutral pre-action lifecycle state.
    status: narrowOr(PROPOSAL_STATUS, p.status, 'proposed'),
    linkedTaskId: p.linkedTaskId,
  };
}

/** Map a persisted `StoredRepoProfile` (string-typed enums) into the view shape; a
 *  corrupt enum degrades to a documented fallback rather than leaking into the UI. */
export function storedToProfile(p: StoredRepoProfile): RepoProfileVM {
  return {
    isMonorepo: p.isMonorepo,
    // Fallback `unknown`: the schema's own undetectable member.
    workspaceTool: narrowOr(WorkspaceToolSchema, p.workspaceTool, 'unknown'),
    packages: p.packages.map((pkg) => ({
      name: pkg.name,
      path: pkg.path,
      // Fallback `unknown`: the schema's own undetermined member.
      role: narrowOr(RepoPackageRoleSchema, pkg.role, 'unknown'),
    })),
    languages: p.languages,
    frameworks: p.frameworks,
    hasEslintFlatConfig: p.hasEslintFlatConfig,
    hasLintMeta: p.hasLintMeta,
    hasAgentDocs: p.hasAgentDocs,
    existingPlugins: p.existingPlugins,
  };
}
