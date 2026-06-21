import { noCrossFeatureImportsRule } from '../../src/rules/no-cross-feature-imports';
import { ruleTester } from '../test-utils/ruleTester';

const FROM = 'apps/web/src/components/board/Board/Board.tsx';

ruleTester.run('no-cross-feature-imports', noCrossFeatureImportsRule, {
  valid: [
    // Same feature via alias.
    {
      code: `import { x } from '@/components/board/TaskCard';`,
      filename: FROM,
    },
    // Same feature via relative path.
    {
      code: `import { TaskCard } from '../TaskCard/TaskCard';`,
      filename: FROM,
    },
    // Shared feature (ui) is importable by all.
    {
      code: `import { Button } from '@/components/ui/Button';`,
      filename: FROM,
    },
    // Type-only cross-feature import is allowed by default.
    {
      code: `import type { ProjectSummary } from '@/components/projects/ProjectCard/ProjectCard.types';`,
      filename: FROM,
    },
    // Non-feature imports (lib, hooks) are fine.
    {
      code: `import { cn } from '@/lib/utils';`,
      filename: FROM,
    },
    {
      code: `import { bridge } from '@/lib/bridge';`,
      filename: FROM,
    },
    {
      code: `import { rules } from '@nightcore/eslint-plugin';`,
      filename: FROM,
    },
    // Files outside any feature are not constrained.
    {
      code: `import { ProjectCard } from '@/components/projects/ProjectCard';`,
      filename: 'apps/web/src/routes/projects.tsx',
    },
  ],
  invalid: [
    // Runtime cross-feature import via alias.
    {
      code: `import { ProjectCard } from '@/components/projects/ProjectCard';`,
      filename: FROM,
      errors: [{ messageId: 'crossFeatureImport' }],
    },
    // Runtime cross-feature import via relative path.
    {
      code: `import { ProjectCard } from '../../projects/ProjectCard/ProjectCard';`,
      filename: FROM,
      errors: [{ messageId: 'crossFeatureImport' }],
    },
    // Type-only import disallowed once allowTypeImports is off.
    {
      code: `import type { ProjectSummary } from '@/components/projects/ProjectCard/ProjectCard.types';`,
      filename: FROM,
      options: [{ allowTypeImports: false }],
      errors: [{ messageId: 'crossFeatureImport' }],
    },
  ],
});
