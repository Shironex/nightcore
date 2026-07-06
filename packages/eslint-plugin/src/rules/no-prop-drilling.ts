import { AST_NODE_TYPES, type TSESTree } from '@typescript-eslint/utils';
import type { JSONSchema4 } from '@typescript-eslint/utils/json-schema';

import { isComponentEntryFile } from '../utils/component-architecture';
import { createRule } from '../utils/createRule';

export const RULE_NAME = 'no-prop-drilling';

export interface NoPropDrillingOptions {
  readonly maxForwarded?: number;
}

type RuleOptions = [NoPropDrillingOptions];
type MessageIds = 'forwardedBundle';

/*
 * The forwarded-bundle tripwire (issue #52). Single-prop pass-through is
 * legitimate leaf forwarding (`onClose`, `className`) — but a BUNDLE of
 * `maxForwarded`-or-more props each forwarded UNCHANGED (`name={name}`) to the
 * SAME child component is prop drilling: the middle component is a wire, not
 * an owner. Composition fixes it — pass a grouped object, render children, or
 * consume a scoped context.
 *
 * Deliberately narrow to keep the signal:
 *  - only component entry files (`<Name>/<Name>.tsx`);
 *  - only props destructured from a `*Props`-annotated parameter;
 *  - a prop qualifies only when EVERY read is the `name={name}` form (any
 *    local use, rename (`foo={bar}`), spread, or `key` forward disqualifies);
 *  - only forwards to a component-typed child (uppercase JSX name).
 */
const DEFAULT_MAX_FORWARDED = 4;

const optionSchema: JSONSchema4 = {
  type: 'object',
  additionalProperties: false,
  properties: {
    maxForwarded: { type: 'integer', minimum: 2 },
  },
};

type ComponentFunction =
  | TSESTree.FunctionDeclaration
  | TSESTree.FunctionExpression
  | TSESTree.ArrowFunctionExpression;

/** The `*Props`-annotated ObjectPattern parameter of a component fn, if any. */
function getPropsPattern(node: ComponentFunction): TSESTree.ObjectPattern | null {
  const param = node.params[0];
  if (param === undefined || param.type !== AST_NODE_TYPES.ObjectPattern) {
    return null;
  }
  const annotation = param.typeAnnotation?.typeAnnotation;
  if (
    annotation === undefined ||
    annotation.type !== AST_NODE_TYPES.TSTypeReference ||
    annotation.typeName.type !== AST_NODE_TYPES.Identifier ||
    !annotation.typeName.name.endsWith('Props')
  ) {
    return null;
  }
  return param;
}

/** Local identifier bindings introduced by the props ObjectPattern. */
function getPropBindingNames(pattern: TSESTree.ObjectPattern): Set<string> {
  const names = new Set<string>();
  for (const property of pattern.properties) {
    if (property.type !== AST_NODE_TYPES.Property) {
      continue; // RestElement: `...rest` spreads are out of scope by design.
    }
    let value: TSESTree.Node = property.value;
    if (value.type === AST_NODE_TYPES.AssignmentPattern) {
      value = value.left; // `{ a = 1 }` binds `a`.
    }
    if (value.type === AST_NODE_TYPES.Identifier) {
      names.add(value.name);
    }
  }
  return names;
}

/**
 * When `id` is an unchanged pass-through (`name={name}` on a component-typed
 * child, not `key`), the child's JSXOpeningElement — otherwise null.
 */
function getForwardTarget(
  id: TSESTree.Identifier,
): TSESTree.JSXOpeningElement | null {
  const container = id.parent;
  if (container.type !== AST_NODE_TYPES.JSXExpressionContainer) {
    return null;
  }
  const attribute = container.parent;
  if (
    attribute.type !== AST_NODE_TYPES.JSXAttribute ||
    attribute.name.type !== AST_NODE_TYPES.JSXIdentifier ||
    attribute.name.name !== id.name ||
    attribute.name.name === 'key'
  ) {
    return null;
  }
  const opening = attribute.parent;
  if (
    opening.type !== AST_NODE_TYPES.JSXOpeningElement ||
    opening.name.type !== AST_NODE_TYPES.JSXIdentifier ||
    !/^[A-Z]/.test(opening.name.name)
  ) {
    return null;
  }
  return opening;
}

export const noPropDrillingRule = createRule<RuleOptions, MessageIds>({
  name: RULE_NAME,
  meta: {
    type: 'suggestion',
    docs: {
      description:
        'A bundle of `maxForwarded`+ (default 4) props each forwarded unchanged (`name={name}`) from the `*Props` param to the same child component is prop drilling. Compose instead.',
    },
    schema: [optionSchema],
    messages: {
      forwardedBundle:
        "{{count}} props ({{props}}) are forwarded unchanged to <{{child}}> — this component is a wire, not an owner. Pass a grouped object, render children, or consume a scoped context instead.",
    },
  },
  defaultOptions: [{ maxForwarded: DEFAULT_MAX_FORWARDED }],
  create(context, [options]) {
    const maxForwarded = options.maxForwarded ?? DEFAULT_MAX_FORWARDED;
    if (!isComponentEntryFile(context.filename)) {
      return {};
    }

    function checkFunction(node: ComponentFunction): void {
      const pattern = getPropsPattern(node);
      if (pattern === null) {
        return;
      }
      const propNames = getPropBindingNames(pattern);
      if (propNames.size === 0) {
        return;
      }

      // childName → forwarded prop names + a representative element to report.
      const bundles = new Map<
        string,
        { props: string[]; node: TSESTree.JSXOpeningElement }
      >();

      for (const variable of context.sourceCode.getDeclaredVariables(node)) {
        if (!propNames.has(variable.name)) {
          continue;
        }
        const reads = variable.references.filter(
          (ref) => ref.isRead() && ref.identifier.type === AST_NODE_TYPES.Identifier,
        );
        if (reads.length === 0) {
          continue;
        }
        const targets = reads.map((ref) =>
          getForwardTarget(ref.identifier as TSESTree.Identifier),
        );
        // EVERY read must be a pass-through — any local use disqualifies.
        if (targets.some((target) => target === null)) {
          continue;
        }
        for (const target of new Set(targets as TSESTree.JSXOpeningElement[])) {
          const childName = (target.name as TSESTree.JSXIdentifier).name;
          const bundle = bundles.get(childName) ?? { props: [], node: target };
          if (!bundle.props.includes(variable.name)) {
            bundle.props.push(variable.name);
          }
          bundles.set(childName, bundle);
        }
      }

      for (const [childName, bundle] of bundles) {
        if (bundle.props.length >= maxForwarded) {
          context.report({
            node: bundle.node,
            messageId: 'forwardedBundle',
            data: {
              count: bundle.props.length,
              props: bundle.props.join(', '),
              child: childName,
            },
          });
        }
      }
    }

    return {
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
    };
  },
});
