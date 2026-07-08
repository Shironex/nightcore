import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { getBasename } from '../utils/component-architecture';
import { createRule } from '../utils/createRule';

const RULE_NAME = 'max-hook-return-surface';

export interface MaxHookReturnSurfaceOptions {
  readonly max?: number;
}

type RuleOptions = [MaxHookReturnSurfaceOptions];
type MessageIds = 'returnSurfaceTooWide';

/*
 * The god-controller guard (issue #53). `max-hooks-per-file` counts exported
 * hooks, so ONE hook returning a 55-member controller object passes every
 * rule while being the definitive "doing too much" shape. This rule caps the
 * RETURN SURFACE of an exported `use*` hook in a `.hooks.ts` file: any object
 * literal it returns — top-level or nested ONE level (the `board: {...}`
 * controller pattern) — may expose at most `max` (default 20) members.
 * Spread elements count as 1 each, though they hide arbitrary surface.
 */
const DEFAULT_MAX = 20;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    max: { type: 'integer', minimum: 1 },
  },
};

type HookFunction =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

function isHookName(name: string | undefined): boolean {
  return name !== undefined && /^use[A-Z]/.test(name);
}

/** Unwrap `as` / `satisfies` wrappers around a returned expression. */
function unwrap(expr: TSESTree.Expression): TSESTree.Expression {
  let current = expr;
  while (
    current.type === AST_NODE_TYPES.TSAsExpression ||
    current.type === AST_NODE_TYPES.TSSatisfiesExpression
  ) {
    current = current.expression;
  }
  return current;
}

export const maxHookReturnSurfaceRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'An exported `use*` hook in a `.hooks.ts` file may return object literals (top-level or nested one level) of at most `max` (default 20) members. Wider returns are god-controllers in the making.',
    },
    schema: [optionSchema],
    messages: {
      returnSurfaceTooWide:
        "'{{hook}}' returns an object exposing {{count}} members (max {{max}}) — a god-controller in the making. Split the hook into focused hooks or return cohesive sub-objects. (Each spread counts as 1 but hides arbitrary extra surface.)",
    },
  },
  defaultOptions: [{ max: DEFAULT_MAX }],
  create(context, [options]) {
    const max = options.max ?? DEFAULT_MAX;
    if (!/\.hooks\.ts$/.test(getBasename(context.filename))) {
      return {};
    }

    /** Tracked top-level hook functions, by function node. */
    const hookFunctions = new Map<HookFunction, string>();
    /** Names surfaced by any `export` construct. */
    const exportedNames = new Set<string>();
    /** Returned expressions per enclosing function node. */
    const returnedExpressions = new Map<HookFunction, TSESTree.Expression[]>();

    function registerVariableHook(node: TSESTree.VariableDeclarator): void {
      if (
        node.id.type === AST_NODE_TYPES.Identifier &&
        isHookName(node.id.name) &&
        node.init !== null &&
        (node.init.type === AST_NODE_TYPES.ArrowFunctionExpression ||
          node.init.type === AST_NODE_TYPES.FunctionExpression)
      ) {
        hookFunctions.set(node.init, node.id.name);
      }
    }

    /** The nearest enclosing function of a return statement (never nested past it). */
    function enclosingFunction(node: TSESTree.Node): HookFunction | null {
      let current: TSESTree.Node | undefined = node.parent;
      while (current !== undefined) {
        if (
          current.type === AST_NODE_TYPES.FunctionDeclaration ||
          current.type === AST_NODE_TYPES.FunctionExpression ||
          current.type === AST_NODE_TYPES.ArrowFunctionExpression
        ) {
          return current;
        }
        current = current.parent;
      }
      return null;
    }

    function checkObject(
      hook: string,
      object: TSESTree.ObjectExpression,
      depth: number,
    ): void {
      const count = object.properties.length; // Property + SpreadElement each = 1.
      if (count > max) {
        context.report({
          node: object,
          messageId: 'returnSurfaceTooWide',
          data: { hook, count, max },
        });
      }
      if (depth >= 2) {
        return;
      }
      // One nested level: the `board: {...}` controller pattern.
      for (const property of object.properties) {
        if (property.type !== AST_NODE_TYPES.Property) {
          continue;
        }
        const value = unwrap(property.value as TSESTree.Expression);
        if (value.type === AST_NODE_TYPES.ObjectExpression) {
          checkObject(hook, value, depth + 1);
        }
      }
    }

    return {
      FunctionDeclaration(node): void {
        if (node.id !== null && isHookName(node.id.name)) {
          hookFunctions.set(node, node.id.name);
          if (node.parent.type === AST_NODE_TYPES.ExportNamedDeclaration) {
            exportedNames.add(node.id.name);
          }
        }
      },
      VariableDeclarator(node): void {
        registerVariableHook(node);
        if (
          node.id.type === AST_NODE_TYPES.Identifier &&
          node.parent.type === AST_NODE_TYPES.VariableDeclaration &&
          node.parent.parent.type === AST_NODE_TYPES.ExportNamedDeclaration
        ) {
          exportedNames.add(node.id.name);
        }
      },
      ExportNamedDeclaration(node): void {
        for (const specifier of node.specifiers) {
          if (
            specifier.type === AST_NODE_TYPES.ExportSpecifier &&
            specifier.local.type === AST_NODE_TYPES.Identifier
          ) {
            exportedNames.add(specifier.local.name);
          }
        }
      },
      ReturnStatement(node): void {
        if (node.argument === null) {
          return;
        }
        const owner = enclosingFunction(node);
        if (owner === null) {
          return;
        }
        const list = returnedExpressions.get(owner) ?? [];
        list.push(node.argument);
        returnedExpressions.set(owner, list);
      },
      'Program:exit'(): void {
        for (const [fn, name] of hookFunctions) {
          if (!exportedNames.has(name)) {
            continue;
          }
          const returns = [...(returnedExpressions.get(fn) ?? [])];
          // Arrow implicit return: `const useX = () => ({ ... })`.
          if (
            fn.type === AST_NODE_TYPES.ArrowFunctionExpression &&
            fn.body.type !== AST_NODE_TYPES.BlockStatement
          ) {
            returns.push(fn.body);
          }
          for (const expr of returns) {
            const value = unwrap(expr);
            if (value.type === AST_NODE_TYPES.ObjectExpression) {
              checkObject(name, value, 1);
            }
          }
        }
      },
    };
  },
});
