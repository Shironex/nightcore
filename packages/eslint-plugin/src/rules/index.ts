import { enforceContextConsumptionRule } from './enforce-context-consumption';

export const rules = {
  // Context lock-in: once a scoped context replaces a drilled prop bundle, keep
  // it replaced. This is the one nightcore rule not yet published to the
  // @noctcore/eslint-plugin-* packages, so it stays local.
  'enforce-context-consumption': enforceContextConsumptionRule,
};
