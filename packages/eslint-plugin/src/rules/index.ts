import { componentFolderStructureRule } from './component-folder-structure';
import { maxHooksPerFileRule } from './max-hooks-per-file';
import { noCrossFeatureImportsRule } from './no-cross-feature-imports';
import { noStateInComponentBodyRule } from './no-state-in-component-body';

export const rules = {
  // Frontend component architecture: folder-per-component convention under
  // components/<feature>/. Each component folder carries hooks/types/stories/
  // test/index; features stay decoupled; state lives in the colocated hook.
  'component-folder-structure': componentFolderStructureRule,
  'no-state-in-component-body': noStateInComponentBodyRule,
  'no-cross-feature-imports': noCrossFeatureImportsRule,
  'max-hooks-per-file': maxHooksPerFileRule,
};
