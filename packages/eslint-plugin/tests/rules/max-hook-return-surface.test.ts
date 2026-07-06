import { maxHookReturnSurfaceRule } from '../../src/rules/max-hook-return-surface';
import { ruleTester } from '../test-utils/ruleTester';

const HOOKS = 'apps/web/src/components/board/Board/Board.hooks.ts';

function members(count: number, prefix = 'm'): string {
  return Array.from({ length: count }, (_, i) => `    ${prefix}${i}: ${i},`).join(
    '\n',
  );
}

const twentyMemberReturn = `
export function useBoard() {
  return {
${members(20)}
  };
}
`;

const twentyOneMemberReturn = `
export function useBoard() {
  return {
${members(21)}
  };
}
`;

// The `board: {...}` controller pattern — a small top-level object hiding a
// wide nested one.
const nestedControllerReturn = `
export function useBoard() {
  return {
    board: {
${members(21)}
    },
    status: 'ready',
  };
}
`;

// Spreads count as 1 each: 19 named members + 2 spreads = 21.
const spreadPaddedReturn = `
export function useBoard() {
  const a = {};
  const b = {};
  return {
${members(19)}
    ...a,
    ...b,
  };
}
`;

// Arrow hook with an implicit object return.
const implicitArrowReturn = `
export const useBoard = () => ({
${members(21)}
});
`;

ruleTester.run('max-hook-return-surface', maxHookReturnSurfaceRule, {
  valid: [
    // Exactly the max is fine.
    { code: twentyMemberReturn, filename: HOOKS },
    // 19 members + 1 spread = 20 — at the cap.
    {
      code: `export function useBoard() {\n  const a = {};\n  return {\n${members(19)}\n    ...a,\n  };\n}`,
      filename: HOOKS,
    },
    // A non-exported helper hook is not part of the file's public surface.
    {
      code: `function useInternal() {\n  return {\n${members(25)}\n  };\n}\nexport function useBoard() { return { ok: true }; }`,
      filename: HOOKS,
    },
    // Non-hook exported functions are unconstrained.
    {
      code: `export function buildBoard() {\n  return {\n${members(25)}\n  };\n}`,
      filename: HOOKS,
    },
    // Outside `.hooks.ts` the rule never fires.
    {
      code: twentyOneMemberReturn,
      filename: 'apps/web/src/components/board/Board/Board.queries.ts',
    },
    // Depth 3 is beyond the nested-one-level reach (by design).
    {
      code: `export function useBoard() {\n  return {\n    a: {\n      b: {\n${members(25)}\n      },\n    },\n  };\n}`,
      filename: HOOKS,
    },
    // A raised max permits a wider return.
    { code: twentyOneMemberReturn, filename: HOOKS, options: [{ max: 25 }] },
  ],
  invalid: [
    // 21 top-level members reds the default max of 20.
    {
      code: twentyOneMemberReturn,
      filename: HOOKS,
      errors: [{ messageId: 'returnSurfaceTooWide' }],
    },
    // The nested `board: {...}` controller pattern is caught one level down.
    {
      code: nestedControllerReturn,
      filename: HOOKS,
      errors: [{ messageId: 'returnSurfaceTooWide' }],
    },
    // Spreads count toward the surface (each hides arbitrary members).
    {
      code: spreadPaddedReturn,
      filename: HOOKS,
      errors: [{ messageId: 'returnSurfaceTooWide' }],
    },
    // Implicit arrow returns are measured too.
    {
      code: implicitArrowReturn,
      filename: HOOKS,
      errors: [{ messageId: 'returnSurfaceTooWide' }],
    },
    // Hooks exported via a specifier list are still public surface.
    {
      code: `function useBoard() {\n  return {\n${members(21)}\n  };\n}\nexport { useBoard };`,
      filename: HOOKS,
      errors: [{ messageId: 'returnSurfaceTooWide' }],
    },
    // A lowered max tightens the cap.
    {
      code: twentyMemberReturn,
      filename: HOOKS,
      options: [{ max: 19 }],
      errors: [{ messageId: 'returnSurfaceTooWide' }],
    },
  ],
});
