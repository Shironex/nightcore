// @ts-check
import { agentContractParityRule } from './rules/agent-contract-parity';
import { codegenDriftRule } from './rules/codegen-drift';
import { layerRankRule } from './rules/layer-rank';
import { noWarnSeverityRule } from './rules/no-warn-severity';
import { packageShapeRule } from './rules/package-shape';
import { testRunnerSegregationRule } from './rules/test-runner-segregation';
import { testWorkspaceEnrollmentRule } from './rules/test-workspace-enrollment';
import { workspaceGraphParityRule } from './rules/workspace-graph-parity';
import type { IMetaRule } from './types';

/**
 * The cross-file / non-JS rules the lint-meta CLI runs. Add new rules here; a
 * `ciCritical` violation fails the gate.
 */
export const META_RULES: IMetaRule[] = [
  codegenDriftRule,
  agentContractParityRule,
  packageShapeRule,
  workspaceGraphParityRule,
  layerRankRule,
  noWarnSeverityRule,
  testWorkspaceEnrollmentRule,
  testRunnerSegregationRule,
];
